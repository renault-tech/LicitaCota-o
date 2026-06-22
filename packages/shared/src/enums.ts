/**
 * Enums compartilhados entre API e Web.
 * Mantidos como `const` objects + union types para uso seguro tanto em runtime
 * quanto em tipagem, espelhando os enums do schema Prisma.
 */

export const Role = {
  ADMIN: 'ADMIN',
  OPERADOR: 'OPERADOR',
  VISUALIZADOR: 'VISUALIZADOR',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const StatusPesquisa = {
  AGUARDANDO: 'AGUARDANDO',
  PROCESSANDO: 'PROCESSANDO',
  CONCLUIDA: 'CONCLUIDA',
  ERRO: 'ERRO',
} as const;
export type StatusPesquisa = (typeof StatusPesquisa)[keyof typeof StatusPesquisa];

export const StatusItem = {
  PENDENTE: 'PENDENTE',
  COTADO: 'COTADO',
  SEM_RESULTADO: 'SEM_RESULTADO',
  ERRO: 'ERRO',
} as const;
export type StatusItem = (typeof StatusItem)[keyof typeof StatusItem];

export const TipoFonte = {
  API_REST: 'API_REST',
  SCRAPING: 'SCRAPING',
  TABELA_REFERENCIA: 'TABELA_REFERENCIA',
} as const;
export type TipoFonte = (typeof TipoFonte)[keyof typeof TipoFonte];

export const StatusValidacaoFonte = {
  VALIDA: 'VALIDA',
  INVALIDA: 'INVALIDA',
  NAO_TESTADA: 'NAO_TESTADA',
} as const;
export type StatusValidacaoFonte = (typeof StatusValidacaoFonte)[keyof typeof StatusValidacaoFonte];

export const MetodoCalculo = {
  MEDIA: 'MEDIA',
  MEDIANA: 'MEDIANA',
  MENOR_PRECO: 'MENOR_PRECO',
} as const;
export type MetodoCalculo = (typeof MetodoCalculo)[keyof typeof MetodoCalculo];

export const TipoNotificacao = {
  PESQUISA_CONCLUIDA: 'PESQUISA_CONCLUIDA',
  FONTE_FALHOU: 'FONTE_FALHOU',
  VARIACAO_PRECO: 'VARIACAO_PRECO',
  SISTEMA: 'SISTEMA',
} as const;
export type TipoNotificacao = (typeof TipoNotificacao)[keyof typeof TipoNotificacao];

export const StatusCotacaoDireta = {
  ENVIADA: 'ENVIADA',
  RESPONDIDA: 'RESPONDIDA',
  RECUSADA: 'RECUSADA',
} as const;
export type StatusCotacaoDireta = (typeof StatusCotacaoDireta)[keyof typeof StatusCotacaoDireta];

/** Slugs das fontes oficiais semeadas no banco (seeds). */
export const FonteSlug = {
  COMPRAS_GOV: 'compras-gov',
  PNCP: 'pncp',
  MERCADO_PUBLICO: 'mercado-publico',
} as const;
export type FonteSlug = (typeof FonteSlug)[keyof typeof FonteSlug];
