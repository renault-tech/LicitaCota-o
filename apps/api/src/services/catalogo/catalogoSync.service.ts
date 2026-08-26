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
 * IMPORTANTE — validar antes de confiar no resultado: o formato exato do CSV
 * (nomes de coluna) foi implementado com base na documentação pública do
 * Portal de Dados Abertos de Compras Governamentais, mas não pôde ser
 * testado contra o arquivo real neste ambiente de desenvolvimento (sem
 * acesso à internet). `sincronizarCatalogo` registra quantas linhas foram
 * importadas — se vier zero com HTTP 200, o formato mudou; ajuste apenas
 * `detectarColunas`/`parseLinha` abaixo.
 */

const URL_MATERIAIS = 'http://compras.dados.gov.br/materiais/v1/materiais.csv';
const URL_SERVICOS = 'http://compras.dados.gov.br/servicos/v1/servicos.csv';

/** Parser de CSV tolerante a campos entre aspas contendo vírgula. */
function parseCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let dentroAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else { dentroAspas = false; }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === ',') {
      linha.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo);
      if (linha.some((v) => v.trim() !== '')) linhas.push(linha);
      linha = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo !== '' || linha.length > 0) {
    linha.push(campo);
    if (linha.some((v) => v.trim() !== '')) linhas.push(linha);
  }
  return linhas;
}

interface LinhaCatalogo {
  codigo: number;
  descricao: string;
  grupo: string | null;
  classe: string | null;
  pdm: string | null;
  ativo: boolean;
}

/** Aceita as variações de nome de coluna conhecidas para cada campo. */
function indiceColuna(cabecalho: string[], candidatos: string[]): number {
  const normalizados = cabecalho.map((c) => c.trim().toLowerCase());
  for (const cand of candidatos) {
    const i = normalizados.indexOf(cand);
    if (i >= 0) return i;
  }
  return -1;
}

function interpretarLinhas(linhas: string[][]): LinhaCatalogo[] {
  if (linhas.length < 2) return [];
  const [cabecalho, ...resto] = linhas;

  const iCodigo = indiceColuna(cabecalho, ['id', 'codigo', 'código', 'codigo_item']);
  const iDescricao = indiceColuna(cabecalho, ['material', 'servico', 'serviço', 'descricao', 'descrição', 'nome']);
  const iGrupo = indiceColuna(cabecalho, ['grupo', 'codigo_grupo']);
  const iClasse = indiceColuna(cabecalho, ['classe', 'codigo_classe']);
  const iPdm = indiceColuna(cabecalho, ['pdm', 'codigo_pdm']);
  const iStatus = indiceColuna(cabecalho, ['status', 'situacao', 'situação']);

  if (iCodigo < 0 || iDescricao < 0) {
    logger.warn('Catálogo oficial: colunas esperadas não encontradas no CSV', { cabecalho });
    return [];
  }

  const resultado: LinhaCatalogo[] = [];
  for (const l of resto) {
    const codigo = Number.parseInt(l[iCodigo]?.trim() ?? '', 10);
    const descricao = l[iDescricao]?.trim() ?? '';
    if (!Number.isFinite(codigo) || !descricao) continue;
    const statusTexto = (iStatus >= 0 ? l[iStatus] : '')?.trim().toLowerCase() ?? '';
    resultado.push({
      codigo,
      descricao,
      grupo: iGrupo >= 0 ? (l[iGrupo]?.trim() || null) : null,
      classe: iClasse >= 0 ? (l[iClasse]?.trim() || null) : null,
      pdm: iPdm >= 0 ? (l[iPdm]?.trim() || null) : null,
      // "inativo".includes('ativ') também é true — não dá pra testar
      // presença de "ativ", tem que ser ausência de "inativ".
      ativo: statusTexto === '' || !statusTexto.includes('inativ'),
    });
  }
  return resultado;
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

async function sincronizarUm(tipo: 'MATERIAL' | 'SERVICO', url: string): Promise<number> {
  const resp = await requisitar(url, { timeoutMs: 120000, retries: 1, pausaMs: 3000 });
  if (!resp.ok) {
    throw new Error(`Catálogo oficial (${tipo}) respondeu HTTP ${resp.status} ao baixar CSV.`);
  }
  const linhas = interpretarLinhas(parseCsv(resp.corpoTexto));
  if (linhas.length === 0) {
    logger.warn(`Catálogo oficial (${tipo}): CSV baixado mas nenhuma linha reconhecida — confira o formato.`);
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

/** Sincroniza CATMAT e CATSER. Falha em um não impede o outro. */
export async function sincronizarCatalogo(): Promise<ResultadoSincronizacao> {
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
  return { materiais, servicos, erro: erros.length > 0 ? erros.join(' | ') : null };
}

export async function catalogoEstaVazio(): Promise<boolean> {
  const total = await prisma.catalogoOficialItem.count();
  return total === 0;
}
