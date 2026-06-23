import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export async function hashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, ROUNDS);
}

export async function conferirSenha(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}

/** Senha válida: >= 8 caracteres, ao menos uma letra e um número. */
export function senhaForte(senha: string): boolean {
  return (
    typeof senha === 'string' &&
    senha.length >= 8 &&
    /[a-zA-Z]/.test(senha) &&
    /[0-9]/.test(senha)
  );
}
