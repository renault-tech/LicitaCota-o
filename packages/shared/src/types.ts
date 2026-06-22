import type {
  MetodoCalculo,
  Role,
  StatusItem,
  StatusPesquisa,
  StatusValidacaoFonte,
  TipoFonte,
} from './enums.js';

/** Item normalizado entregue aos adapters de cotação. */
export interface ItemNormalizado {
  nome: string;
  descricao: string;
  descricaoNormalizada: string;
  /** Variações de busca em cascata, da mais completa para a mais curta. */
  cascata: string[];
  quantidade: number;
  unidadeMedida: string;
  cidade?: string;
  uf?: string;
}

/** Resultado de uma consulta de cotação a uma fonte. */
export interface ResultadoCotacao {
  preco: number | null;
  referencia: string;
  fundamentacaoArtigo: string;
  dadosBrutos: unknown;
  erro?: string;
}

/** Resultado do auto-teste de uma fonte. */
export interface TesteResultado {
  ok: boolean;
  latenciaMs: number;
  amostraPreco: number | null;
  amostraReferencia: string | null;
  mensagem: string;
  dadosBrutos: unknown;
}

/** Mapeamento de campos (caminhos tipo JSONPath) na resposta de uma API_REST. */
export interface MapeamentoCampos {
  /** Caminho para a lista de resultados na resposta (ex.: "resultado" ou "data.items"). */
  listaResultados?: string;
  /** Caminhos candidatos para o preço (testados em ordem). */
  preco: string[];
  /** Caminhos candidatos para a referência (testados em ordem). */
  referencia: string[];
}

/** Template de parâmetros com placeholders, ex.: { descricao: "{descricaoItem}" }. */
export type ParametrosTemplate = Record<string, string>;

/** Resumo público de uma pesquisa (listagens e dashboard). */
export interface PesquisaResumo {
  id: string;
  titulo: string;
  status: StatusPesquisa;
  totalItens: number;
  itensComCotacao: number;
  itensSemCotacao: number;
  itensComErro: number;
  resumoCobertura: string | null;
  valorTotalEstimado: string | null;
  createdAt: string;
  concluidaEm: string | null;
}

/** Mapeamento de coluna detectado na leitura adaptativa de planilha. */
export interface ColunaDetectada {
  campo: 'nome' | 'descricao' | 'quantidade' | 'unidadeMedida' | 'cidade' | 'uf' | 'extra';
  tituloOriginal: string;
  indice: number;
}

/** Item extraído da planilha de entrada (preview antes de confirmar). */
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

/** Resultado da leitura adaptativa de planilha. */
export interface ResultadoLeitura {
  colunas: ColunaDetectada[];
  itens: ItemPlanilhaEntrada[];
  /** Títulos originais das colunas extras preservadas, na ordem da planilha. */
  colunasExtras: string[];
  linhaCabecalho: number;
}

/** Payload de progresso emitido durante o processamento. */
export interface ProgressoPesquisa {
  pesquisaId: string;
  status: StatusPesquisa;
  totalItens: number;
  processados: number;
  itensComCotacao: number;
  itensSemCotacao: number;
  itensComErro: number;
  itemAtual?: { sequencia: number; nome: string; statusItem: StatusItem };
  tempoEstimadoSegundos?: number;
}

/** Usuário autenticado exposto ao frontend (sem dados sensíveis). */
export interface UsuarioPublico {
  id: string;
  email: string;
  nome: string;
  cargo: string | null;
  setor: string | null;
  municipio: string | null;
  uf: string | null;
  role: Role;
  ativo: boolean;
}

/** Configuração de cálculo aplicada a uma pesquisa. */
export interface ParametrosCalculo {
  metodoCalculo: MetodoCalculo;
  limiteOutlierPercentual: number;
  minFontesCompleta: number;
}

/** Diagnóstico resumido de saúde de uma fonte. */
export interface SaudeFonte {
  slug: string;
  nome: string;
  tipo: TipoFonte;
  ativo: boolean;
  statusValidacao: StatusValidacaoFonte;
  ultimoTesteEm: string | null;
  latenciaMs: number | null;
  taxaSucesso: number | null;
}
