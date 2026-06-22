import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PrismaClient } from '@prisma/client';
import { hashSenha, senhaForte } from '../utils/senha.js';

/**
 * Cria (ou promove) o primeiro usuário ADMIN.
 * Uso não interativo:
 *   ADMIN_EMAIL=a@b.com ADMIN_NOME="Fulano" ADMIN_SENHA=segredo123 pnpm create-admin
 * Ou interativo (sem variáveis): solicita os dados no terminal.
 */

const prisma = new PrismaClient();

async function perguntar(rl: readline.Interface, label: string, oculto = false): Promise<string> {
  if (!oculto) return (await rl.question(label)).trim();
  // Entrada "oculta" simples (sem eco perfeito, mas evita exibir em claro).
  stdout.write(label);
  return new Promise((resolve) => {
    const onData = (buf: Buffer) => {
      const linha = buf.toString().replace(/[\r\n]/g, '');
      stdin.off('data', onData);
      resolve(linha.trim());
    };
    stdin.once('data', onData);
  });
}

async function main(): Promise<void> {
  let email = process.env.ADMIN_EMAIL ?? '';
  let nome = process.env.ADMIN_NOME ?? '';
  let senha = process.env.ADMIN_SENHA ?? '';

  if (!email || !nome || !senha) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    if (!email) email = await perguntar(rl, 'E-mail do administrador: ');
    if (!nome) nome = await perguntar(rl, 'Nome completo: ');
    if (!senha) senha = await perguntar(rl, 'Senha (mín. 8 caracteres): ', true);
    rl.close();
  }

  email = email.toLowerCase().trim();
  if (!email.includes('@')) throw new Error('E-mail inválido.');
  if (!nome) throw new Error('Nome é obrigatório.');
  if (!senhaForte(senha)) throw new Error('Senha deve ter ao menos 8 caracteres.');

  const passwordHash = await hashSenha(senha);
  const user = await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN', ativo: true, passwordHash, nome },
    create: { email, nome, role: 'ADMIN', ativo: true, passwordHash },
  });

  // eslint-disable-next-line no-console
  console.log(`Administrador pronto: ${user.email} (id ${user.id})`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('Erro ao criar administrador:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
