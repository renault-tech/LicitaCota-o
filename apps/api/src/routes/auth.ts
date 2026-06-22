import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { hashSenha, conferirSenha, senhaForte } from '../utils/senha.js';
import { autenticar } from '../middleware/auth.js';
import { NaoAutorizadoError, NaoEncontradoError, ValidacaoError } from '../utils/errors.js';
import { registrarAuditoria } from '../services/auditoria.service.js';

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
