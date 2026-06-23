import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { hashSenha, conferirSenha, senhaForte } from '../utils/senha.js';
import { autenticar } from '../middleware/auth.js';
import { NaoAutorizadoError, NaoEncontradoError, ValidacaoError } from '../utils/errors.js';
import { registrarAuditoria } from '../services/auditoria.service.js';
import { enviarEmail } from '../services/email.service.js';
import { logger } from '../utils/logger.js';

const router: Router = Router();

function gerarTokens(userId: string, role: string) {
  const access = jwt.sign(
    { sub: userId, role, tipo: 'access' },
    env.JWT_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES as jwt.SignOptions['expiresIn'] },
  );
  const refresh = jwt.sign(
    { sub: userId, tipo: 'refresh' },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES as jwt.SignOptions['expiresIn'] },
  );
  return { access, refresh };
}

const selectUsuarioPublico = {
  id: true, email: true, nome: true, cargo: true, setor: true,
  municipio: true, uf: true, role: true, ativo: true,
  prefNotifEmail: true, prefNotifInApp: true,
} as const;

// POST /api/auth/cadastro — registro público de novo usuário
router.post('/cadastro', async (req, res, next) => {
  try {
    const dados = z.object({
      nome: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
      email: z.string().email('E-mail inválido'),
      senha: z.string().min(8, 'Mínimo 8 caracteres'),
      municipio: z.string().optional(),
      uf: z.string().length(2).optional(),
      cargo: z.string().optional(),
    }).parse(req.body);

    if (!senhaForte(dados.senha)) {
      throw new ValidacaoError('A senha deve ter ao menos 8 caracteres, com letras e números.');
    }

    const existe = await prisma.user.findUnique({ where: { email: dados.email } });
    if (existe) throw new ValidacaoError('Este e-mail já está cadastrado.');

    const user = await prisma.user.create({
      data: {
        email: dados.email,
        nome: dados.nome,
        cargo: dados.cargo,
        municipio: dados.municipio,
        uf: dados.uf,
        role: 'OPERADOR',
        ativo: true,
        passwordHash: await hashSenha(dados.senha),
      },
    });

    await enviarEmail({
      para: user.email,
      assunto: 'Bem-vindo ao LicitaPreço!',
      html: `
        <div style="font-family:Inter,Arial,sans-serif;color:#1F3864;max-width:520px;">
          <h2>Conta criada com sucesso!</h2>
          <p>Olá, ${user.nome}.</p>
          <p>Sua conta no LicitaPreço foi criada. Você já pode fazer login com o e-mail <strong>${user.email}</strong>.</p>
          <p style="margin:24px 0;">
            <a href="${env.FRONTEND_URL}/login" style="background:#2E75B6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">
              Acessar o sistema
            </a>
          </p>
          <hr style="border:none;border-top:1px solid #eee;margin:16px 0;"/>
          <small style="color:#999;">LicitaPreço — Pesquisa de Preços para Licitações</small>
        </div>`,
    }).catch((e) => logger.warn('Falha ao enviar e-mail de boas-vindas', e));

    await registrarAuditoria({ userId: user.id, acao: 'CADASTRO', ip: req.ip });
    res.status(201).json({ ok: true, mensagem: 'Conta criada com sucesso. Faça login.' });
  } catch (e) { next(e); }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, senha } = z.object({
      email: z.string().email(),
      senha: z.string().min(1),
    }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.ativo || !user.passwordHash) {
      throw new NaoAutorizadoError('E-mail ou senha incorretos.');
    }
    if (!(await conferirSenha(senha, user.passwordHash))) {
      throw new NaoAutorizadoError('E-mail ou senha incorretos.');
    }

    const { access, refresh } = gerarTokens(user.id, user.role);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken: refresh } });
    await registrarAuditoria({ userId: user.id, acao: 'LOGIN', ip: req.ip });

    res.json({
      accessToken: access,
      refreshToken: refresh,
      usuario: { id: user.id, email: user.email, nome: user.nome, role: user.role, cargo: user.cargo, municipio: user.municipio, uf: user.uf },
    });
  } catch (e) { next(e); }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
    } catch {
      throw new NaoAutorizadoError('Refresh token inválido ou expirado.');
    }
    if (payload['tipo'] !== 'refresh') throw new NaoAutorizadoError();

    const user = await prisma.user.findUnique({ where: { id: payload['sub'] as string } });
    if (!user || !user.ativo || user.refreshToken !== refreshToken) {
      throw new NaoAutorizadoError('Sessão inválida. Faça login novamente.');
    }

    const { access, refresh } = gerarTokens(user.id, user.role);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken: refresh } });
    res.json({ accessToken: access, refreshToken: refresh });
  } catch (e) { next(e); }
});

// POST /api/auth/logout
router.post('/logout', autenticar, async (req, res, next) => {
  try {
    await prisma.user.update({ where: { id: req.usuario.id }, data: { refreshToken: null } });
    await registrarAuditoria({ userId: req.usuario.id, acao: 'LOGOUT', ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/auth/me
router.get('/me', autenticar, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.usuario.id },
      select: selectUsuarioPublico,
    });
    if (!user) throw new NaoEncontradoError();
    res.json(user);
  } catch (e) { next(e); }
});

// PUT /api/auth/me — atualização de perfil próprio
router.put('/me', autenticar, async (req, res, next) => {
  try {
    const data = z.object({
      nome: z.string().min(2).optional(),
      cargo: z.string().optional(),
      setor: z.string().optional(),
      municipio: z.string().optional(),
      uf: z.string().length(2).optional(),
      prefNotifEmail: z.boolean().optional(),
      prefNotifInApp: z.boolean().optional(),
    }).parse(req.body);

    const user = await prisma.user.update({
      where: { id: req.usuario.id },
      data,
      select: selectUsuarioPublico,
    });
    res.json(user);
  } catch (e) { next(e); }
});

// PUT /api/auth/senha — troca de senha autenticado
router.put('/senha', autenticar, async (req, res, next) => {
  try {
    const { senhaAtual, novaSenha } = z.object({
      senhaAtual: z.string(),
      novaSenha: z.string().min(8),
    }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.usuario.id } });
    if (!user?.passwordHash) throw new NaoAutorizadoError();
    if (!(await conferirSenha(senhaAtual, user.passwordHash))) {
      throw new NaoAutorizadoError('Senha atual incorreta.');
    }
    if (!senhaForte(novaSenha)) {
      throw new ValidacaoError('A nova senha deve ter ao menos 8 caracteres.');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashSenha(novaSenha), refreshToken: null },
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/auth/esqueci-senha — gera JWT de reset e envia por e-mail
router.post('/esqueci-senha', async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const resposta = { ok: true, mensagem: 'Se o e-mail estiver cadastrado, você receberá um link em breve.' };

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.ativo) { res.json(resposta); return; }

    // JWT stateless: não requer colunas novas no banco.
    const token = jwt.sign(
      { sub: user.id, tipo: 'reset_senha' },
      env.JWT_SECRET,
      { expiresIn: '1h' },
    );

    const link = `${env.FRONTEND_URL}/redefinir-senha?token=${encodeURIComponent(token)}`;
    await enviarEmail({
      para: user.email,
      assunto: 'Redefinição de senha — LicitaPreço',
      html: `
        <div style="font-family:Inter,Arial,sans-serif;color:#1F3864;max-width:520px;">
          <h2>Redefinição de senha</h2>
          <p>Olá, ${user.nome}.</p>
          <p>Recebemos uma solicitação para redefinir a senha da sua conta no LicitaPreço.</p>
          <p>Clique no botão abaixo para criar uma nova senha. O link é válido por <strong>1 hora</strong>.</p>
          <p style="margin:24px 0;">
            <a href="${link}" style="background:#2E75B6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">
              Redefinir minha senha
            </a>
          </p>
          <p style="font-size:12px;color:#666;">Se você não solicitou isso, ignore este e-mail.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:16px 0;"/>
          <small style="color:#999;">LicitaPreço — Pesquisa de Preços para Licitações</small>
        </div>`,
    }).catch((e) => logger.warn('Falha ao enviar e-mail de reset', e));

    res.json(resposta);
  } catch (e) { next(e); }
});

// POST /api/auth/redefinir-senha — valida JWT e aplica nova senha
router.post('/redefinir-senha', async (req, res, next) => {
  try {
    const { token, senha } = z.object({
      token: z.string().min(1),
      senha: z.string().min(8),
    }).parse(req.body);

    if (!senhaForte(senha)) throw new ValidacaoError('A senha deve ter ao menos 8 caracteres.');

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    } catch {
      throw new NaoAutorizadoError('Link de redefinição inválido ou expirado.');
    }
    if (payload['tipo'] !== 'reset_senha') throw new NaoAutorizadoError('Link inválido.');

    const user = await prisma.user.findUnique({ where: { id: payload['sub'] as string } });
    if (!user || !user.ativo) throw new NaoAutorizadoError('Usuário não encontrado.');

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashSenha(senha), refreshToken: null },
    });

    await registrarAuditoria({ userId: user.id, acao: 'RESET_SENHA', ip: req.ip });
    res.json({ ok: true, mensagem: 'Senha redefinida com sucesso. Faça login.' });
  } catch (e) { next(e); }
});

// POST /api/auth/definir-senha — primeiro acesso via link de convite
router.post('/definir-senha', async (req, res, next) => {
  try {
    const { conviteToken, senha } = z.object({
      conviteToken: z.string().uuid(),
      senha: z.string().min(8),
    }).parse(req.body);

    if (!senhaForte(senha)) throw new ValidacaoError('A senha deve ter ao menos 8 caracteres.');

    const user = await prisma.user.findUnique({ where: { conviteToken } });
    if (!user || !user.conviteExpiraEm || new Date() > user.conviteExpiraEm) {
      throw new NaoAutorizadoError('Link de convite inválido ou expirado.');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashSenha(senha), conviteToken: null, conviteExpiraEm: null },
    });
    res.json({ ok: true, mensagem: 'Senha definida com sucesso. Faça login.' });
  } catch (e) { next(e); }
});

export default router;
