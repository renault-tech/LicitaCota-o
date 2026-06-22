/**
 * Erros padronizados da aplicação. Cada erro carrega um código rastreável
 * (exibido ao usuário) e um status HTTP. Nunca expor stack trace cru.
 */

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly codigo: string;
  public readonly detalhes?: unknown;

  constructor(mensagem: string, statusCode = 400, codigo = 'ERRO_GENERICO', detalhes?: unknown) {
    super(mensagem);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export class NaoAutorizadoError extends AppError {
  constructor(mensagem = 'Credenciais inválidas ou sessão expirada.') {
    super(mensagem, 401, 'NAO_AUTORIZADO');
  }
}

export class ProibidoError extends AppError {
  constructor(mensagem = 'Você não tem permissão para esta ação.') {
    super(mensagem, 403, 'PROIBIDO');
  }
}

export class NaoEncontradoError extends AppError {
  constructor(mensagem = 'Recurso não encontrado.') {
    super(mensagem, 404, 'NAO_ENCONTRADO');
  }
}

export class ValidacaoError extends AppError {
  constructor(mensagem = 'Dados inválidos.', detalhes?: unknown) {
    super(mensagem, 422, 'VALIDACAO', detalhes);
  }
}

export class ConflitoError extends AppError {
  constructor(mensagem = 'Conflito com o estado atual do recurso.') {
    super(mensagem, 409, 'CONFLITO');
  }
}
