import ExcelJS from 'exceljs';
import { prisma } from '../../config/prisma.js';
import { normalizarChave } from '../../utils/texto.js';
import { logger } from '../../utils/logger.js';

/**
 * Importa o catálogo oficial a partir de um arquivo único (CSV ou XLSX) em
 * vez de centenas de chamadas paginadas na API. Mesmo destino (tabela
 * CatalogoOficialItem), mesmo efeito na resolução de código e na cotação —
 * só muda como o dado chega até lá.
 *
 * O download automático usa os arquivos CSV publicados em
 * repositorio.dados.gov.br (confirmado com amostra real colada pelo
 * usuário — cabeçalho `codigoGrupo\tnomeGrupo\tcodigoClasse\tnomeClasse\t
 * codigoPdm\tnomePdm\tcodigoItem\tdescricaoItem\tcodigoNcm\t
 * aplicaMargemPreferencia\tdataHoraAtualizacao`, separado por TAB apesar da
 * extensão .csv — as descrições têm vírgulas, então vírgula não serviria
 * como delimitador). Essa é uma URL diferente da página
 * `www.gov.br/compras/.../planilha-catmat-catser`, que exige login
 * ("Conteúdo Restrito") e por isso nunca foi usada com sucesso aqui.
 *
 * O upload manual de .xlsx (usado como alternativa) tem exatamente os
 * mesmos nomes de coluna (confirmado com uma amostra real do .xlsx colada
 * pelo usuário) — por isso os dois caminhos reaproveitam a mesma lista de
 * sinônimos abaixo.
 */

const URL_CSV_MATERIAIS = 'https://repositorio.dados.gov.br/seges/comprasgov/catalogo_cnbs/catmat.csv';
const URL_CSV_SERVICOS = 'https://repositorio.dados.gov.br/seges/comprasgov/catalogo_cnbs/catser.csv';

type Campo = 'codigo' | 'descricao' | 'grupo' | 'classe' | 'pdm' | 'status';

const SINONIMOS_COLUNA: Record<Campo, string[]> = {
  codigo: ['codigo', 'codigo catmat', 'codigo catser', 'codigo do item', 'id', 'codigoItem'],
  descricao: ['descricao', 'descricao oficial', 'descricao do item', 'nome', 'material', 'servico', 'descricaoItem'],
  grupo: ['grupo', 'codigo do grupo', 'codigo grupo', 'codigoGrupo'],
  classe: ['classe', 'codigo da classe', 'codigo classe', 'codigoClasse'],
  pdm: ['pdm', 'codigo pdm', 'codigoPdm'],
  status: ['status', 'situacao'],
};

function classificarColuna(titulo: string): Campo | null {
  const norm = normalizarChave(titulo);
  if (!norm) return null;
  for (const [campo, lista] of Object.entries(SINONIMOS_COLUNA)) {
    if (lista.some((s) => normalizarChave(s) === norm)) return campo as Campo;
  }
  return null;
}

function celulaTexto(valor: ExcelJS.CellValue): string {
  if (valor == null) return '';
  if (typeof valor === 'object') {
    const obj = valor as { text?: string; result?: unknown; richText?: Array<{ text: string }> };
    if (typeof obj.text === 'string') return obj.text.trim();
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text).join('').trim();
    if (obj.result != null) return String(obj.result).trim();
    return '';
  }
  return String(valor).trim();
}

interface LinhaImportada {
  codigo: number;
  descricao: string;
  grupo: string | null;
  classe: string | null;
  pdm: string | null;
  ativo: boolean;
}

async function gravarLote(tipo: 'MATERIAL' | 'SERVICO', itens: LinhaImportada[]): Promise<void> {
  if (itens.length === 0) return;
  await prisma.$transaction(
    itens.map((item) =>
      prisma.catalogoOficialItem.upsert({
        where: { tipo_codigo: { tipo, codigo: item.codigo } },
        update: { descricao: item.descricao, grupo: item.grupo, classe: item.classe, pdm: item.pdm, ativo: item.ativo },
        create: { tipo, ...item },
      }),
    ),
  );
}

const TAMANHO_LOTE = 500;

export interface ProgressoImportacao {
  linhaAtual: number;
  processados: number;
  totalEstimado: number;
}

/**
 * Lê um workbook .xlsx já carregado e grava no catálogo. Usada tanto pelo
 * download automático quanto pelo upload manual — mesmo parser para os dois
 * caminhos, para não divergir formato de coluna entre eles.
 */
export async function importarWorkbook(
  tipo: 'MATERIAL' | 'SERVICO',
  buffer: Buffer,
  aoProgredir?: (p: ProgressoImportacao) => void,
): Promise<number> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const planilha = workbook.worksheets[0];
  if (!planilha) throw new Error('Planilha vazia ou formato não reconhecido.');

  // Acha a linha de cabeçalho: primeira linha com pelo menos "codigo" e "descricao" reconhecidos.
  let linhaCabecalho = -1;
  let colunas: Record<Campo, number> = { codigo: -1, descricao: -1, grupo: -1, classe: -1, pdm: -1, status: -1 };
  for (let i = 1; i <= Math.min(20, planilha.rowCount); i++) {
    const linha = planilha.getRow(i);
    const encontradas: Partial<Record<Campo, number>> = {};
    linha.eachCell({ includeEmpty: false }, (cell, col) => {
      const campo = classificarColuna(celulaTexto(cell.value));
      if (campo) encontradas[campo] = col;
    });
    if (encontradas.codigo && encontradas.descricao) {
      linhaCabecalho = i;
      colunas = { codigo: -1, descricao: -1, grupo: -1, classe: -1, pdm: -1, status: -1, ...encontradas };
      break;
    }
  }
  if (linhaCabecalho < 0) throw new Error('Não encontrei as colunas de código/descrição na planilha — confira o formato.');

  const totalEstimado = Math.max(0, planilha.rowCount - linhaCabecalho);
  let lote: LinhaImportada[] = [];
  let processados = 0;

  for (let i = linhaCabecalho + 1; i <= planilha.rowCount; i++) {
    const linha = planilha.getRow(i);
    const codigoTexto = celulaTexto(linha.getCell(colunas.codigo).value);
    const codigo = Number.parseInt(codigoTexto, 10);
    const descricao = celulaTexto(linha.getCell(colunas.descricao).value);
    if (!Number.isFinite(codigo) || !descricao) continue;

    const statusTexto = colunas.status > 0 ? celulaTexto(linha.getCell(colunas.status).value).toLowerCase() : '';
    lote.push({
      codigo,
      descricao,
      grupo: colunas.grupo > 0 ? (celulaTexto(linha.getCell(colunas.grupo).value) || null) : null,
      classe: colunas.classe > 0 ? (celulaTexto(linha.getCell(colunas.classe).value) || null) : null,
      pdm: colunas.pdm > 0 ? (celulaTexto(linha.getCell(colunas.pdm).value) || null) : null,
      // "inativo".includes('ativ') também é true — precisa checar ausência de "inativ".
      ativo: statusTexto === '' || !statusTexto.includes('inativ'),
    });

    if (lote.length >= TAMANHO_LOTE) {
      await gravarLote(tipo, lote);
      processados += lote.length;
      aoProgredir?.({ linhaAtual: i, processados, totalEstimado });
      lote = [];
    }
  }
  if (lote.length > 0) {
    await gravarLote(tipo, lote);
    processados += lote.length;
    aoProgredir?.({ linhaAtual: planilha.rowCount, processados, totalEstimado });
  }

  if (processados === 0) {
    logger.warn(`Catálogo oficial (${tipo}): planilha carregada mas nenhuma linha reconhecida — confira as colunas.`);
  }
  return processados;
}

/**
 * Lê o texto de um CSV/TSV já baixado e grava no catálogo — mesma detecção
 * de coluna por sinônimo usada em `importarWorkbook`, mas lendo linhas de
 * texto em vez de um `ExcelJS.Worksheet`. Separador confirmado como TAB
 * (ver comentário no topo do arquivo).
 */
export async function importarCsvTexto(
  tipo: 'MATERIAL' | 'SERVICO',
  texto: string,
  aoProgredir?: (p: ProgressoImportacao) => void,
): Promise<number> {
  // Remove BOM (comum em exports de governo) e divide em linhas, tolerando
  // \r\n e \n; descarta linhas totalmente vazias (ex.: linha final do arquivo).
  const linhas = texto
    .replace(/^﻿/, '')
    .split(/\r\n|\n/)
    .filter((l) => l.length > 0);
  if (linhas.length === 0) throw new Error('Arquivo CSV vazio.');

  const cabecalho = linhas[0].split('\t').map((c) => c.trim());
  const colunas: Record<Campo, number> = { codigo: -1, descricao: -1, grupo: -1, classe: -1, pdm: -1, status: -1 };
  cabecalho.forEach((titulo, idx) => {
    const campo = classificarColuna(titulo);
    if (campo) colunas[campo] = idx;
  });
  if (colunas.codigo < 0 || colunas.descricao < 0) {
    throw new Error('Não encontrei as colunas de código/descrição no CSV — confira o formato.');
  }

  const totalEstimado = Math.max(0, linhas.length - 1);
  let lote: LinhaImportada[] = [];
  let processados = 0;

  for (let i = 1; i < linhas.length; i++) {
    const campos = linhas[i].split('\t');
    const codigo = Number.parseInt((campos[colunas.codigo] ?? '').trim(), 10);
    const descricao = (campos[colunas.descricao] ?? '').trim();
    if (!Number.isFinite(codigo) || !descricao) continue;

    const statusTexto = colunas.status >= 0 ? (campos[colunas.status] ?? '').trim().toLowerCase() : '';
    lote.push({
      codigo,
      descricao,
      grupo: colunas.grupo >= 0 ? ((campos[colunas.grupo] ?? '').trim() || null) : null,
      classe: colunas.classe >= 0 ? ((campos[colunas.classe] ?? '').trim() || null) : null,
      pdm: colunas.pdm >= 0 ? ((campos[colunas.pdm] ?? '').trim() || null) : null,
      ativo: statusTexto === '' || !statusTexto.includes('inativ'),
    });

    if (lote.length >= TAMANHO_LOTE) {
      await gravarLote(tipo, lote);
      processados += lote.length;
      aoProgredir?.({ linhaAtual: i + 1, processados, totalEstimado });
      lote = [];
    }
  }
  if (lote.length > 0) {
    await gravarLote(tipo, lote);
    processados += lote.length;
    aoProgredir?.({ linhaAtual: linhas.length, processados, totalEstimado });
  }

  if (processados === 0) {
    logger.warn(`Catálogo oficial (${tipo}): CSV carregado mas nenhuma linha reconhecida — confira as colunas.`);
  }
  return processados;
}

// requisitar() (utils/http.ts) sempre lê a resposta como texto, então serve
// para o CSV — mas usamos fetch cru mesmo assim para ter timeout próprio e
// não duplicar leitura do corpo.
async function baixarTexto(url: string, timeoutMs = 60000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LicitaPrecoBot/1.0; +https://licitapreco.gov.br)' },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Download do CSV respondeu HTTP ${resp.status}.`);
    return await resp.text();
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error(`Tempo de resposta excedido (timeout de ${timeoutMs}ms) ao baixar o CSV.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function importarCatalogoAutomatico(
  tipo: 'MATERIAL' | 'SERVICO',
  aoProgredir?: (p: ProgressoImportacao) => void,
): Promise<number> {
  const url = tipo === 'MATERIAL' ? URL_CSV_MATERIAIS : URL_CSV_SERVICOS;
  const texto = await baixarTexto(url);
  return importarCsvTexto(tipo, texto, aoProgredir);
}
