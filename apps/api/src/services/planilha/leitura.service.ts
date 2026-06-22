import ExcelJS from 'exceljs';
import type { ColunaDetectada, ItemPlanilhaEntrada, ResultadoLeitura } from '@licitapreco/shared';
import { ValidacaoError } from '../../utils/errors.js';
import { normalizarChave } from '../../utils/texto.js';

/**
 * Leitura adaptativa de planilha: detecta a linha de cabeçalho automaticamente
 * e mapeia colunas por correspondência flexível (acento/caixa/ordem). Preserva
 * as colunas extras enviadas pelo solicitante em camposExtras.
 */

const SINONIMOS: Record<Exclude<ColunaDetectada['campo'], 'extra'>, string[]> = {
  nome: ['nome', 'item', 'produto', 'objeto', 'descricao do item'],
  descricao: ['descricao', 'especificacao', 'detalhamento', 'especificacoes'],
  quantidade: ['quantidade', 'qtd', 'qtde', 'quant'],
  unidadeMedida: ['unidade de medida', 'unidade', 'unid', 'un', 'medida'],
  cidade: ['cidade', 'municipio'],
  uf: ['uf', 'estado'],
};

function classificarColuna(titulo: string): ColunaDetectada['campo'] {
  const norm = normalizarChave(titulo);
  if (!norm) return 'extra';
  for (const [campo, lista] of Object.entries(SINONIMOS)) {
    if (lista.some((s) => normalizarChave(s) === norm)) {
      return campo as ColunaDetectada['campo'];
    }
  }
  // Correspondência por inclusão (ex.: "descrição detalhada do objeto").
  for (const [campo, lista] of Object.entries(SINONIMOS)) {
    if (lista.some((s) => norm.includes(normalizarChave(s)))) {
      return campo as ColunaDetectada['campo'];
    }
  }
  return 'extra';
}

/** Converte valor de célula em texto limpo. */
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

function celulaNumero(valor: ExcelJS.CellValue): number {
  const txt = celulaTexto(valor).replace(/\./g, '').replace(',', '.');
  const n = Number(txt);
  return Number.isFinite(n) ? n : 0;
}

/** Detecta a linha de cabeçalho: a primeira linha que contém >= 2 títulos conhecidos. */
function detectarCabecalho(sheet: ExcelJS.Worksheet): number {
  const limite = Math.min(sheet.rowCount, 15);
  let melhorLinha = 1;
  let melhorPontuacao = -1;
  for (let r = 1; r <= limite; r++) {
    const row = sheet.getRow(r);
    let conhecidas = 0;
    let preenchidas = 0;
    row.eachCell({ includeEmpty: false }, (cell) => {
      preenchidas++;
      if (classificarColuna(celulaTexto(cell.value)) !== 'extra') conhecidas++;
    });
    const pontuacao = conhecidas * 10 + preenchidas;
    if (conhecidas >= 1 && pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhorLinha = r;
    }
  }
  return melhorLinha;
}

export async function lerPlanilha(buffer: Buffer): Promise<ResultadoLeitura> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ValidacaoError('Não foi possível ler o arquivo. Envie um .xlsx válido.');
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount === 0) {
    throw new ValidacaoError('A planilha está vazia.');
  }

  const linhaCabecalho = detectarCabecalho(sheet);
  const headerRow = sheet.getRow(linhaCabecalho);

  const colunas: ColunaDetectada[] = [];
  const colunasExtras: string[] = [];
  const usados = new Set<ColunaDetectada['campo']>();

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const titulo = celulaTexto(cell.value);
    if (!titulo) return;
    let campo = classificarColuna(titulo);
    // Cada campo essencial mapeia uma única coluna; repetições viram "extra".
    if (campo !== 'extra' && usados.has(campo)) campo = 'extra';
    if (campo !== 'extra') usados.add(campo);
    if (campo === 'extra') colunasExtras.push(titulo);
    colunas.push({ campo, tituloOriginal: titulo, indice: colNumber });
  });

  const temNomeOuDescricao = colunas.some((c) => c.campo === 'nome' || c.campo === 'descricao');
  const temQuantidade = colunas.some((c) => c.campo === 'quantidade');

  if (!temNomeOuDescricao || !temQuantidade) {
    const encontradas = colunas.map((c) => c.tituloOriginal).join(', ') || '(nenhuma)';
    throw new ValidacaoError(
      'Não foi possível identificar as colunas essenciais (Nome/Descrição e Quantidade). ' +
        `Colunas encontradas: ${encontradas}. Baixe o modelo de planilha e ajuste os títulos.`,
      { encontradas: colunas.map((c) => c.tituloOriginal), esperadas: ['Nome/Descrição', 'Quantidade'] },
    );
  }

  const idx = (campo: ColunaDetectada['campo']): number =>
    colunas.find((c) => c.campo === campo)?.indice ?? -1;
  const iNome = idx('nome');
  const iDescricao = idx('descricao');
  const iQtd = idx('quantidade');
  const iUnid = idx('unidadeMedida');
  const iCidade = idx('cidade');
  const iUf = idx('uf');

  const itens: ItemPlanilhaEntrada[] = [];
  let sequencia = 0;
  for (let r = linhaCabecalho + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const nome = iNome > 0 ? celulaTexto(row.getCell(iNome).value) : '';
    const descricao = iDescricao > 0 ? celulaTexto(row.getCell(iDescricao).value) : '';
    const quantidade = iQtd > 0 ? celulaNumero(row.getCell(iQtd).value) : 0;

    // Pula linhas totalmente vazias.
    if (!nome && !descricao && quantidade === 0) continue;

    const camposExtras: Record<string, string | number | null> = {};
    for (const col of colunas) {
      if (col.campo === 'extra') {
        camposExtras[col.tituloOriginal] = celulaTexto(row.getCell(col.indice).value) || null;
      }
    }

    sequencia++;
    itens.push({
      sequencia,
      nome: nome || descricao,
      descricao: descricao || nome,
      quantidade: quantidade > 0 ? quantidade : 1,
      unidadeMedida: iUnid > 0 ? celulaTexto(row.getCell(iUnid).value) : '',
      cidade: iCidade > 0 ? celulaTexto(row.getCell(iCidade).value) : undefined,
      uf: iUf > 0 ? celulaTexto(row.getCell(iUf).value) : undefined,
      camposExtras,
    });
  }

  if (itens.length === 0) {
    throw new ValidacaoError('Nenhum item válido foi encontrado na planilha.');
  }

  return { colunas, itens, colunasExtras, linhaCabecalho };
}

/**
 * Leitura a partir de texto colado (TSV/CSV das células de uma planilha aberta).
 * Primeira linha tratada como cabeçalho.
 */
export function lerListaColada(texto: string): ResultadoLeitura {
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '');
  if (linhas.length < 2) {
    throw new ValidacaoError('Cole ao menos uma linha de cabeçalho e uma de dados.');
  }

  const separador = linhas[0].includes('\t') ? '\t' : ';';
  const titulos = linhas[0].split(separador).map((t) => t.trim());

  const colunas: ColunaDetectada[] = [];
  const colunasExtras: string[] = [];
  const usados = new Set<ColunaDetectada['campo']>();
  titulos.forEach((titulo, i) => {
    let campo = classificarColuna(titulo);
    if (campo !== 'extra' && usados.has(campo)) campo = 'extra';
    if (campo !== 'extra') usados.add(campo);
    if (campo === 'extra') colunasExtras.push(titulo);
    colunas.push({ campo, tituloOriginal: titulo, indice: i });
  });

  const temNomeOuDescricao = colunas.some((c) => c.campo === 'nome' || c.campo === 'descricao');
  const temQuantidade = colunas.some((c) => c.campo === 'quantidade');
  if (!temNomeOuDescricao || !temQuantidade) {
    throw new ValidacaoError(
      'Não foi possível identificar as colunas essenciais (Nome/Descrição e Quantidade) no texto colado.',
      { encontradas: titulos },
    );
  }

  const idx = (campo: ColunaDetectada['campo']): number =>
    colunas.find((c) => c.campo === campo)?.indice ?? -1;
  const iNome = idx('nome');
  const iDescricao = idx('descricao');
  const iQtd = idx('quantidade');
  const iUnid = idx('unidadeMedida');
  const iCidade = idx('cidade');
  const iUf = idx('uf');

  const parseNum = (s: string): number => {
    const n = Number((s ?? '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };

  const itens: ItemPlanilhaEntrada[] = [];
  let sequencia = 0;
  for (let r = 1; r < linhas.length; r++) {
    const cols = linhas[r].split(separador);
    const nome = iNome >= 0 ? (cols[iNome] ?? '').trim() : '';
    const descricao = iDescricao >= 0 ? (cols[iDescricao] ?? '').trim() : '';
    const quantidade = iQtd >= 0 ? parseNum(cols[iQtd] ?? '') : 0;
    if (!nome && !descricao && quantidade === 0) continue;

    const camposExtras: Record<string, string | number | null> = {};
    for (const col of colunas) {
      if (col.campo === 'extra') camposExtras[col.tituloOriginal] = (cols[col.indice] ?? '').trim() || null;
    }

    sequencia++;
    itens.push({
      sequencia,
      nome: nome || descricao,
      descricao: descricao || nome,
      quantidade: quantidade > 0 ? quantidade : 1,
      unidadeMedida: iUnid >= 0 ? (cols[iUnid] ?? '').trim() : '',
      cidade: iCidade >= 0 ? (cols[iCidade] ?? '').trim() : undefined,
      uf: iUf >= 0 ? (cols[iUf] ?? '').trim() : undefined,
      camposExtras,
    });
  }

  if (itens.length === 0) throw new ValidacaoError('Nenhum item válido encontrado no texto colado.');
  return { colunas, itens, colunasExtras, linhaCabecalho: 1 };
}
