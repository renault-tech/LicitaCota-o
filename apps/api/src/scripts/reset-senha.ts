import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PrismaClient } from '@prisma/client';
import { hashSenha, senhaForte } from '../utils/senha.js';

/**
 * Redefine a senha de um usuário pelo e-mail.
 * Uso não interativo:
 *   RESET_EMAIL=a@b.com RESET_SENHA=novaSenha123 pnpm reset-senha
 * Ou interativo.
 */

const prisma = new PrismaClient();

async function main(): Promise<void> {
  let email = process.env.RESET_EMAIL ?? '';
  let senha = process.env.RESET_SENHA ?? '';

  if (!email || !senha) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    if (!email) email = (await rl.question('E-mail do usuário: ')).trim();
    if (!senha) senha = (await rl.question('Nova senha (mín. 8 caracteres): ')).trim();
    rl.close();
  }

  email = email.toLowerCase().trim();
  if (!senhaForte(senha)) throw new Error('Senha deve ter ao menos 8 caracteres.');

  const usuario = await prisma.user.findUnique({ where: { email } });
  if (!usuario) throw new Error(`Usuário não encontrado: ${email}`);

  const passwordHash = await hashSenha(senha);
  await prisma.user.update({
    where: { email },
    data: { passwordHash, refreshToken: null },
  });

  // eslint-disable-next-line no-console
  console.log(`Senha redefinida para ${email}. Sessões anteriores foram invalidadas.`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('Erro ao redefinir senha:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
