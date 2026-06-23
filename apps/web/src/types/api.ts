export type Role = 'ADMIN' | 'OPERADOR' | 'VISUALIZADOR';
export type StatusPesquisa = 'AGUARDANDO' | 'PROCESSANDO' | 'CONCLUIDA' | 'ERRO';
export type StatusItem = 'PENDENTE' | 'COTADO' | 'SEM_RESULTADO' | 'ERRO';
export type TipoFonte = 'API_REST' | 'SCRAPING' | 'TABELA_REFERENCIA';
export type StatusValidacaoFonte = 'VALIDA' | 'INVALIDA' | 'NAO_TESTADA';
export type MetodoCalculo = 'MEDIA' | 'MEDIANA' | 'MENOR_PRECO';
export type TipoNotificacao = 'PESQUISA_CONCLUIDA' | 'FONTE_FALHOU' | 'VARIACAO_PRECO' | 'SISTEMA';
export type StatusCotacaoDireta = 'ENVIADA' | 'RESPONDIDA' | 'RECUSADA';

export interface Usuario {
  id: string;
  email: string;
  nome: string;
  cargo: string | null;
  setor: string | null;
  municipio: string | null;
  uf: string | null;
  role: Role;
  ativo: boolean;
  prefNotifEmail: boolean;
  prefNotifInApp: boolean;
  createdAt: string;
}

export interface Pesquisa {
  id: string;
  titulo: string;
  descricao: string | null;
  status: StatusPesquisa;
  userId: string;
  totalItens: number;
  itensComCotacao: number;
  itensSemCotacao: number;
  itensComErro: number;
  resumoCobertura: string | null;
  arquivoEntradaUrl: string | null;
  arquivoSaidaUrl: string | null;
  compartilhada: boolean;
  linkCompartilhamento: string | null;
  municipio: string | null;
  uf: string | null;
  fundamentacaoLegal: string | null;
  valorTotalEstimado: string | null;
  erroProcessamento: string | null;
  jobId: string | null;
  concluidaEm: string | null;
  createdAt: string;
  updatedAt: string;
  itens?: ItemPesquisa[];
  user?: { nome: string; email: string };
}

export interface ItemPesquisa {
  id: string;
  pesquisaId: string;
  sequencia: number;
  nome: string;
  descricao: string;
  descricaoNormalizada: string | null;
  quantidade: string;
  unidadeMedida: string | null;
  cidade: string | null;
  uf: string | null;
  camposExtras: Record<string, unknown> | null;
  precoReferencia: string | null;
  precoTotal: string | null;
  statusItem: StatusItem;
  observacao: string | null;
  cotacoes?: Cotacao[];
  cotacoesDiretas?: CotacaoDireta[];
}

export interface Cotacao {
  id: string;
  itemPesquisaId: string;
  fonte: string;
  preco: string | null;
  referencia: string | null;
  fundamentacaoArtigo: string | null;
  dataConsulta: string;
  erro: string | null;
  editadaManualmente: boolean;
}

export interface CotacaoDireta {
  id: string;
  itemPesquisaId: string;
  fornecedorId: string;
  preco: string | null;
  status: StatusCotacaoDireta;
  justificativa: string;
  outlier: boolean;
  dataSolicitacao: string;
  dataResposta: string | null;
  fornecedor?: Fornecedor;
}

export interface FonteCotacao {
  id: string;
  nome: string;
  slug: string;
  tipo: TipoFonte;
  ativo: boolean;
  ordem: number;
  endpointBase: string | null;
  fundamentacaoArtigo: string | null;
  limiteResultados: number;
  timeoutMs: number;
  pausaMs: number;
  retries: number;
  statusValidacao: StatusValidacaoFonte;
  ultimoTesteEm: string | null;
  ultimoTesteResultado: unknown;
  createdAt: string;
}

export interface Fornecedor {
  id: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string;
  contatoNome: string | null;
  email: string | null;
  telefone: string | null;
  endereco: string | null;
  municipio: string | null;
  uf: string | null;
  ativo: boolean;
  createdAt: string;
}

export interface Notificacao {
  id: string;
  userId: string;
  tipo: TipoNotificacao;
  titulo: string;
  mensagem: string;
  lida: boolean;
  link: string | null;
  createdAt: string;
}

export interface ConfiguracaoSistema {
  id: string;
  municipio: string | null;
  uf: string | null;
  brasaoUrl: string | null;
  responsavelTecnico: string | null;
  metodoCalculo: MetodoCalculo;
  limiteOutlierPercentual: number;
  minFontesCompleta: number;
  itemAmostraTeste: string;
  textosFundamentacao: unknown;
  smtpConfig: unknown;
  canalSuporte: unknown;
  updatedAt: string;
}

export interface LogAuditoria {
  id: string;
  userId: string | null;
  acao: string;
  entidade: string | null;
  entidadeId: string | null;
  detalhe: unknown;
  ip: string | null;
  createdAt: string;
  user?: { nome: string; email: string } | null;
}

export interface ProgressoPesquisa {
  pesquisaId: string;
  status: StatusPesquisa;
  totalItens: number;
  processados: number;
  itensComCotacao: number;
  itensSemCotacao: number;
  itensComErro: number;
  itemAtual?: { sequencia: number; nome: string; statusItem: StatusItem } | null;
  tempoEstimadoSegundos?: number | null;
  resumoCobertura?: string | null;
}

export interface ItemPlanilhaEntrada {
  sequencia: number;
  nome: string;
  descricao: string;
  quantidade: number;
  unidadeMedida: string;
  cidade?: string;
  uf?: string;
  camposExtras: Record<string, string | number | null>;
}

export interface ResultadoLeitura {
  colunas: Array<{ campo: string; tituloOriginal: string; indice: number }>;
  itens: ItemPlanilhaEntrada[];
  colunasExtras: string[];
  linhaCabecalho: number;
}

export interface TesteResultado {
  ok: boolean;
  latenciaMs: number;
  amostraPreco: number | null;
  amostraReferencia: string | null;
  mensagem: string;
}

export interface PaginatedResponse<T> {
  total: number;
  pagina: number;
  limite: number;
  data: T[];
}
