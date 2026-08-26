import { prisma } from '../../config/prisma.js';
import { requisitar } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';

/**
 * Sincronização do catálogo oficial CATMAT/CATSER (SIASG/Compras.gov.br).
 *
 * Baixa o CSV público em lote (não item a item) e grava localmente — a
 * resolução de código por descrição roda inteiramente contra o banco local
 * depois disso, sem nenhuma chamada externa por cotação. O catálogo muda
 * pouco (o governo publica atualizações periódicas, não em tempo real), por
 * isso uma sincronização mensal é suficiente.
 *
 * IMPORTANTE — validar antes de confiar no resultado: os nomes de campo
 * exatos do JSON de resposta foram implementados com base na documentação
 * pública da API (Manual do Usuário — API do Compras.gov.br), mas não
 * puderam ser confirmados contra a resposta real neste ambiente de
 * desenvolvimento (sem acesso à internet). `sincronizarCatalogo` registra
 * quantos itens foram importados — se vier zero com HTTP 200, o formato
 * mudou; ajuste apenas `extrairLinha`/`extrairArray` abaixo.
 *
 * Histórico: a primeira versão baixava um CSV em lote de
 * compras.dados.gov.br (portal de dados abertos legado) — esse domínio
 * respondeu HTTP 404 em produção (path descontinuado). Trocado para as
 * mesmas rotas paginadas da API de consulta usadas pelos outros adapters
 * (dadosabertos.compras.gov.br), que já sabemos ser alcançáveis.
 */

const URL_MATERIAIS = 'https://dadosabertos.compras.gov.br/modulo-material/4_consultarItemMaterial';
const URL_SERVICOS = 'https://dadosabertos.compras.gov.br/modulo-servico/6_consultarItemServico';
const TAMANHO_PAGINA_API = 500;
const MAX_PAGINAS = 400; // teto de segurança: 400×500 = 200 mil itens

interface LinhaCatalogo {
  codigo: number;
  descricao: string;
  grupo: string | null;
  classe: string | null;
  pdm: string | null;
  ativo: boolean;
}

type ObjetoBruto = Record<string, unknown>;

function primeiroValor(obj: ObjetoBruto, chaves: string[]): unknown {
  for (const chave of chaves) {
    if (obj[chave] !== undefined && obj[chave] !== null) return obj[chave];
  }
  return undefined;
}

/** A API embrulha a lista de formas diferentes conforme o endpoint. */
function extrairArray(corpo: unknown): ObjetoBruto[] {
  if (Array.isArray(corpo)) return corpo as ObjetoBruto[];
  const obj = corpo as ObjetoBruto | null;
  if (!obj) return [];
  if (Array.isArray(obj.resultado)) return obj.resultado as ObjetoBruto[];
  if (Array.isArray(obj.content)) return obj.content as ObjetoBruto[];
  if (Array.isArray(obj._embedded)) return obj._embedded as ObjetoBruto[];
  if (Array.isArray(obj.data)) return obj.data as ObjetoBruto[];
  return [];
}

function extrairLinha(obj: ObjetoBruto): LinhaCatalogo | null {
  const codigoRaw = primeiroValor(obj, ['codigoItem', 'codigo', 'id']);
  const codigo = Number.parseInt(String(codigoRaw ?? ''), 10);
  const descricao = String(primeiroValor(obj, ['descricaoItem', 'descricao', 'nomeItem', 'nome']) ?? '').trim();
  if (!Number.isFinite(codigo) || !descricao) return null;

  const statusTexto = String(primeiroValor(obj, ['situacao', 'status', 'situacaoItem']) ?? '').toLowerCase();
  const grupoRaw = primeiroValor(obj, ['codigoGrupo', 'grupo']);
  const classeRaw = primeiroValor(obj, ['codigoClasse', 'classe']);
  const pdmRaw = primeiroValor(obj, ['codigoPdm', 'pdm']);

  return {
    codigo,
    descricao,
    grupo: grupoRaw !== undefined ? String(grupoRaw) : null,
    classe: classeRaw !== undefined ? String(classeRaw) : null,
    pdm: pdmRaw !== undefined ? String(pdmRaw) : null,
    // "inativo".includes('ativ') também é true — não dá pra testar
    // presença de "ativ", tem que ser ausência de "inativ".
    ativo: statusTexto === '' || !statusTexto.includes('inativ'),
  };
}

/** Pagina até a API devolver uma página vazia/menor que o pedido, ou até o teto de segurança. */
async function buscarTodasPaginas(urlBase: string): Promise<LinhaCatalogo[]> {
  const linhas: LinhaCatalogo[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const url = `${urlBase}?pagina=${pagina}&tamanhoPagina=${TAMANHO_PAGINA_API}`;
    const resp = await requisitar(url, { timeoutMs: 20000, retries: 1, pausaMs: 1000 });
    if (!resp.ok) throw new Error(`Catálogo oficial respondeu HTTP ${resp.status} (página ${pagina}).`);

    const brutos = extrairArray(resp.corpoJson);
    if (brutos.length === 0) break;
    for (const b of brutos) {
      const linha = extrairLinha(b);
      if (linha) linhas.push(linha);
    }
    if (brutos.length < TAMANHO_PAGINA_API) break;
  }
  return linhas;
}

const TAMANHO_LOTE = 500;

async function gravarLote(tipo: 'MATERIAL' | 'SERVICO', itens: LinhaCatalogo[]): Promise<void> {
  for (let i = 0; i < itens.length; i += TAMANHO_LOTE) {
    const lote = itens.slice(i, i + TAMANHO_LOTE);
    await prisma.$transaction(
      lote.map((item) =>
        prisma.catalogoOficialItem.upsert({
          where: { tipo_codigo: { tipo, codigo: item.codigo } },
          update: {
            descricao: item.descricao,
            grupo: item.grupo,
            classe: item.classe,
            pdm: item.pdm,
            ativo: item.ativo,
          },
          create: { tipo, ...item },
        }),
      ),
    );
  }
}

async function garantirIndiceTrigram(): Promise<void> {
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS catalogo_oficial_item_descricao_trgm_idx ' +
    'ON "CatalogoOficialItem" USING gin (descricao gin_trgm_ops)',
  );
}

async function sincronizarUm(tipo: 'MATERIAL' | 'SERVICO', urlBase: string): Promise<number> {
  const linhas = await buscarTodasPaginas(urlBase);
  if (linhas.length === 0) {
    logger.warn(`Catálogo oficial (${tipo}): resposta recebida mas nenhum item reconhecido — confira o formato do JSON.`);
    return 0;
  }
  await gravarLote(tipo, linhas);
  return linhas.length;
}

export interface ResultadoSincronizacao {
  materiais: number;
  servicos: number;
  erro: string | null;
}

/**
 * Status em memória da sincronização — instância única (Render), mesmo
 * padrão do progressStore usado pelo processamento de pesquisas. Não
 * persiste em banco: reinicia ao reiniciar o servidor, mas isso é aceitável
 * porque o dado relevante para o usuário ("quando terminou", "quantos itens
 * tem hoje") continua vindo direto da tabela via `obterEstatisticasCatalogo`.
 */
interface StatusSincronizacao {
  emAndamento: boolean;
  iniciadoEm: string | null;
  concluidoEm: string | null;
  ultimoResultado: ResultadoSincronizacao | null;
}

const statusAtual: StatusSincronizacao = {
  emAndamento: false,
  iniciadoEm: null,
  concluidoEm: null,
  ultimoResultado: null,
};

export function obterStatusSincronizacao(): StatusSincronizacao {
  return { ...statusAtual };
}

/** Sincroniza CATMAT e CATSER. Falha em um não impede o outro. */
export async function sincronizarCatalogo(): Promise<ResultadoSincronizacao> {
  statusAtual.emAndamento = true;
  statusAtual.iniciadoEm = new Date().toISOString();

  await garantirIndiceTrigram();

  let materiais = 0;
  let servicos = 0;
  const erros: string[] = [];

  try {
    materiais = await sincronizarUm('MATERIAL', URL_MATERIAIS);
  } catch (e) {
    erros.push(e instanceof Error ? e.message : String(e));
    logger.error('Falha ao sincronizar CATMAT', e);
  }

  try {
    servicos = await sincronizarUm('SERVICO', URL_SERVICOS);
  } catch (e) {
    erros.push(e instanceof Error ? e.message : String(e));
    logger.error('Falha ao sincronizar CATSER', e);
  }

  logger.info(`Catálogo oficial sincronizado: ${materiais} materiais, ${servicos} serviços.`);
  const resultado = { materiais, servicos, erro: erros.length > 0 ? erros.join(' | ') : null };

  statusAtual.emAndamento = false;
  statusAtual.concluidoEm = new Date().toISOString();
  statusAtual.ultimoResultado = resultado;

  return resultado;
}

/** Dispara a sincronização em segundo plano — não faz nada se já houver uma em andamento. */
export function dispararSincronizacaoEmBackground(): boolean {
  if (statusAtual.emAndamento) return false;
  sincronizarCatalogo().catch((e) => logger.error('Falha na sincronização do catálogo oficial', e));
  return true;
}

export async function catalogoEstaVazio(): Promise<boolean> {
  const total = await prisma.catalogoOficialItem.count();
  return total === 0;
}

export interface EstatisticasCatalogo {
  materiais: number;
  servicos: number;
  ultimaAtualizacao: string | null;
}

export async function obterEstatisticasCatalogo(): Promise<EstatisticasCatalogo> {
  const [materiais, servicos, ultimo] = await Promise.all([
    prisma.catalogoOficialItem.count({ where: { tipo: 'MATERIAL' } }),
    prisma.catalogoOficialItem.count({ where: { tipo: 'SERVICO' } }),
    prisma.catalogoOficialItem.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
  ]);
  return { materiais, servicos, ultimaAtualizacao: ultimo?.updatedAt.toISOString() ?? null };
}
