import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export async function hashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, ROUNDS);
}

export async function conferirSenha(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}

/** Validação mínima de senha (>= 8 caracteres). */
export function senhaForte(senha: string): boolean {
  return typeof senha === 'string' && senha.length >= 8;
}
