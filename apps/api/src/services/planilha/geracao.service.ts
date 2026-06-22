import ExcelJS from 'exceljs';
import { TEXTOS_LEGAIS } from '@licitapreco/shared';
import { prisma } from '../../config/prisma.js';
import { NaoEncontradoError } from '../../utils/errors.js';

/**
 * Geração da planilha de saída (adaptativa). Aba 1 "Banco de Preços" com as
 * colunas originais do solicitante + um par (Cotação/Referência) por fonte que
 * participou + colunas de fechamento. Aba 2 "Metodologia" formal.
 */

const COR = {
  tituloFundo: 'FF1F3864',
  cabecalhoFundo: 'FF2E75B6',
  branco: 'FFFFFFFF',
  precoRef: 'FFFCE4C8',
  linhaPar: 'FFF2F2F2',
  linhaImpar: 'FFFFFFFF',
  neutro: 'FFF2F2F2',
};

// Paleta de pares de fonte (ciclada quando houver muitas fontes).
const PARES_FONTE: Array<[string, string]> = [
  ['FFD9E1F2', 'FFE8EEFB'],
  ['FFE2EFDA', 'FFEEF6E8'],
  ['FFFFF2CC', 'FFFFF8E0'],
  ['FFFCE4FF', 'FFF7EAFB'],
  ['FFE0F2F1', 'FFEAF8F7'],
];

const FORMATO_MOEDA = 'R$ #,##0.00';

function preencher(cell: ExcelJS.Cell, cor: string): void {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } };
}

export async function gerarPlanilha(pesquisaId: string): Promise<Buffer> {
  const pesquisa = await prisma.pesquisa.findUnique({
    where: { id: pesquisaId },
    include: {
      itens: { orderBy: { sequencia: 'asc' }, include: { cotacoes: true } },
    },
  });
  if (!pesquisa) throw new NaoEncontradoError('Pesquisa não encontrada.');

  const config = await prisma.configuracaoSistema.findUnique({ where: { id: 'singleton' } });

  // Fontes que participaram (slugs presentes nas cotações), ordenadas pelo registry.
  const slugsParticipantes = new Set<string>();
  for (const item of pesquisa.itens) {
    for (const c of item.cotacoes) slugsParticipantes.add(c.fonte);
  }
  const fontes = await prisma.fonteCotacao.findMany({
    where: { slug: { in: [...slugsParticipantes] } },
    orderBy: { ordem: 'asc' },
  });
  // Inclui cotação manual como "fonte" virtual, se houver.
  const fontesOrdenadas = fontes.map((f) => ({ slug: f.slug, nome: f.nome }));
  if (slugsParticipantes.has('manual') && !fontesOrdenadas.find((f) => f.slug === 'manual')) {
    fontesOrdenadas.push({ slug: 'manual', nome: 'Cotação Manual' });
  }

  // Colunas extras (preservadas) — coleta a partir do primeiro item que tiver.
  const colunasExtras: string[] = [];
  for (const item of pesquisa.itens) {
    const extras = (item.camposExtras ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(extras)) if (!colunasExtras.includes(k)) colunasExtras.push(k);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'LicitaPreço';
  wb.created = new Date();

  // ----------------------------------------------------------------------
  // Aba 1 — Banco de Preços
  // ----------------------------------------------------------------------
  const ws = wb.addWorksheet('Banco de Preços', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  // Definição dinâmica de colunas.
  interface ColDef {
    titulo: string;
    largura: number;
    tipo: 'solicitante' | 'fonte-preco' | 'fonte-ref' | 'fechamento-valor' | 'fechamento-texto';
    corPar?: string;
    chave: string;
  }

  const defs: ColDef[] = [];
  defs.push({ titulo: 'Nº', largura: 6, tipo: 'solicitante', chave: 'sequencia' });
  defs.push({ titulo: 'Descrição', largura: 44, tipo: 'solicitante', chave: 'descricao' });
  defs.push({ titulo: 'Unidade', largura: 12, tipo: 'solicitante', chave: 'unidade' });
  defs.push({ titulo: 'Quantidade', largura: 12, tipo: 'solicitante', chave: 'quantidade' });
  for (const ex of colunasExtras) {
    defs.push({ titulo: ex, largura: 18, tipo: 'solicitante', chave: `extra:${ex}` });
  }
  fontesOrdenadas.forEach((f, i) => {
    const [a, b] = PARES_FONTE[i % PARES_FONTE.length];
    defs.push({ titulo: `Cotação - ${f.nome}`, largura: 16, tipo: 'fonte-preco', corPar: a, chave: `cot:${f.slug}` });
    defs.push({ titulo: `Referência - ${f.nome}`, largura: 30, tipo: 'fonte-ref', corPar: b, chave: `ref:${f.slug}` });
  });
  defs.push({ titulo: 'Preço de Referência Unit.', largura: 18, tipo: 'fechamento-valor', chave: 'precoRef' });
  defs.push({ titulo: 'Preço Total Estimado', largura: 18, tipo: 'fechamento-valor', chave: 'precoTotal' });
  defs.push({ titulo: 'Status', largura: 16, tipo: 'fechamento-texto', chave: 'status' });
  defs.push({ titulo: 'Fundamentação Legal', largura: 36, tipo: 'fechamento-texto', chave: 'fundamentacao' });

  const totalColunas = defs.length;

  // Linha 1 — título mesclado.
  const dataFmt = new Date().toLocaleDateString('pt-BR');
  const muni = pesquisa.municipio ?? config?.municipio ?? '—';
  const uf = pesquisa.uf ?? config?.uf ?? '—';
  ws.mergeCells(1, 1, 1, totalColunas);
  const titulo = ws.getCell(1, 1);
  titulo.value = `BANCO DE PREÇOS - PESQUISA DE PREÇOS PARA LICITAÇÃO | Município: ${muni}/${uf} | Data: ${dataFmt} | Pesquisa: ${pesquisa.titulo} | Fundamentação: Lei 14.133/2021 + IN SEGES/ME 65/2021`;
  titulo.font = { bold: true, color: { argb: COR.branco }, size: 11 };
  preencher(titulo, COR.tituloFundo);
  titulo.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  ws.getRow(1).height = 36;

  // Linha 2 — cabeçalhos.
  const headerRow = ws.getRow(2);
  defs.forEach((d, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = d.titulo;
    cell.font = { bold: true, color: { argb: COR.branco }, size: 9 };
    preencher(cell, COR.cabecalhoFundo);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    ws.getColumn(i + 1).width = d.largura;
  });
  headerRow.height = 28;

  // Mapa slug -> cotação por item.
  let linha = 3;
  for (const item of pesquisa.itens) {
    const cotPorFonte = new Map<string, { preco: number | null; referencia: string | null }>();
    for (const c of item.cotacoes) {
      cotPorFonte.set(c.fonte, { preco: c.preco ? Number(c.preco) : null, referencia: c.referencia });
    }
    const extras = (item.camposExtras ?? {}) as Record<string, unknown>;
    const row = ws.getRow(linha);
    const corLinha = linha % 2 === 0 ? COR.linhaPar : COR.linhaImpar;

    defs.forEach((d, i) => {
      const cell = row.getCell(i + 1);
      switch (d.chave) {
        case 'sequencia':
          cell.value = item.sequencia;
          break;
        case 'descricao':
          cell.value = item.descricao || item.nome;
          break;
        case 'unidade':
          cell.value = item.unidadeMedida ?? '';
          break;
        case 'quantidade':
          cell.value = Number(item.quantidade);
          break;
        case 'precoRef':
          cell.value = item.precoReferencia ? Number(item.precoReferencia) : null;
          cell.numFmt = FORMATO_MOEDA;
          break;
        case 'precoTotal':
          cell.value = item.precoTotal ? Number(item.precoTotal) : null;
          cell.numFmt = FORMATO_MOEDA;
          break;
        case 'status':
          cell.value = traduzStatus(item.statusItem);
          break;
        case 'fundamentacao':
          cell.value = item.observacao ?? montarFundamentacao(item.cotacoes);
          break;
        default:
          if (d.chave.startsWith('extra:')) {
            const k = d.chave.slice(6);
            const v = extras[k];
            cell.value = v == null ? '' : String(v);
          } else if (d.chave.startsWith('cot:')) {
            const slug = d.chave.slice(4);
            const preco = cotPorFonte.get(slug)?.preco ?? null;
            cell.value = preco;
            cell.numFmt = FORMATO_MOEDA;
          } else if (d.chave.startsWith('ref:')) {
            const slug = d.chave.slice(4);
            cell.value = cotPorFonte.get(slug)?.referencia ?? '';
          }
      }

      // Cor de fundo por tipo.
      if (d.tipo === 'fechamento-valor') preencher(cell, COR.precoRef);
      else if (d.corPar) preencher(cell, d.corPar);
      else preencher(cell, corLinha);

      cell.font = { size: 9, ...(d.tipo === 'fechamento-valor' ? { bold: true } : {}) };
      cell.alignment = { vertical: 'middle', wrapText: d.largura >= 30 };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } } };
    });
    linha++;
  }

  // Linha TOTAL GERAL com fórmula somando a coluna Preço Total.
  const colPrecoTotal = defs.findIndex((d) => d.chave === 'precoTotal') + 1;
  const primeiraDados = 3;
  const ultimaDados = linha - 1;
  const totalRow = ws.getRow(linha);
  if (colPrecoTotal > 1) {
    const labelCell = totalRow.getCell(1);
    ws.mergeCells(linha, 1, linha, colPrecoTotal - 1);
    labelCell.value = 'TOTAL GERAL';
    labelCell.font = { bold: true, size: 10 };
    labelCell.alignment = { horizontal: 'right', vertical: 'middle' };
    preencher(labelCell, COR.precoRef);
    const totalCell = totalRow.getCell(colPrecoTotal);
    totalCell.value =
      ultimaDados >= primeiraDados
        ? { formula: `SUM(${cellRef(colPrecoTotal, primeiraDados)}:${cellRef(colPrecoTotal, ultimaDados)})` }
        : 0;
    totalCell.numFmt = FORMATO_MOEDA;
    totalCell.font = { bold: true, size: 10 };
    preencher(totalCell, COR.precoRef);
  }
  linha++;

  // Linha de auditoria de cobertura.
  ws.mergeCells(linha, 1, linha, totalColunas);
  const cobertura = ws.getCell(linha, 1);
  cobertura.value =
    pesquisa.resumoCobertura ??
    `${pesquisa.totalItens} itens | ${pesquisa.itensComCotacao} cotados | ${pesquisa.itensSemCotacao} sem resultado | ${pesquisa.itensComErro} com erro`;
  cobertura.font = { italic: true, size: 9 };
  preencher(cobertura, COR.precoRef);
  cobertura.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

  // ----------------------------------------------------------------------
  // Aba 2 — Metodologia
  // ----------------------------------------------------------------------
  const wsm = wb.addWorksheet('Metodologia');
  wsm.getColumn(1).width = 110;
  const textos = (config?.textosFundamentacao ?? TEXTOS_LEGAIS) as typeof TEXTOS_LEGAIS;

  const linhasMetodologia: Array<{ texto: string; titulo?: boolean }> = [
    { texto: 'METODOLOGIA DA PESQUISA DE PREÇOS', titulo: true },
    { texto: `Município: ${muni}/${uf}` },
    { texto: `Pesquisa: ${pesquisa.titulo}` },
    { texto: `Data de emissão: ${dataFmt}` },
    { texto: config?.responsavelTecnico ? `Responsável técnico: ${config.responsavelTecnico}` : '' },
    { texto: '' },
    { texto: '1. FUNDAMENTAÇÃO LEGAL', titulo: true },
    { texto: textos.cabecalhoPesquisa },
    { texto: '' },
    { texto: '2. CRITÉRIO DE CÁLCULO', titulo: true },
    { texto: textos.criterioCalculo },
    { texto: `Método aplicado: ${traduzMetodo(config?.metodoCalculo ?? 'MEDIA')}.` },
    { texto: '' },
    { texto: '3. FONTES CONSULTADAS', titulo: true },
  ];

  for (const f of fontes) {
    linhasMetodologia.push({ texto: `• ${f.nome}: ${f.fundamentacaoArtigo ?? ''}` });
  }
  if (slugsParticipantes.has('manual')) {
    linhasMetodologia.push({ texto: `• Cotação Manual: registrada por servidor responsável com justificativa.` });
  }

  linhasMetodologia.push({ texto: '' });
  linhasMetodologia.push({ texto: '4. DECLARAÇÃO DE COBERTURA', titulo: true });
  linhasMetodologia.push({
    texto:
      pesquisa.resumoCobertura ??
      `${pesquisa.totalItens} itens processados | ${pesquisa.itensComCotacao} cotados | ${pesquisa.itensSemCotacao} sem resultado | ${pesquisa.itensComErro} com erro`,
  });

  let lm = 1;
  for (const l of linhasMetodologia) {
    const cell = wsm.getCell(lm, 1);
    cell.value = l.texto;
    cell.alignment = { wrapText: true, vertical: 'top' };
    if (l.titulo) {
      cell.font = { bold: true, size: 12, color: { argb: COR.tituloFundo } };
    } else {
      cell.font = { size: 10 };
    }
    wsm.getRow(lm).height = l.texto.length > 90 ? 48 : 18;
    lm++;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function cellRef(col: number, row: number): string {
  let s = '';
  let c = col;
  while (c > 0) {
    const mod = (c - 1) % 26;
    s = String.fromCharCode(65 + mod) + s;
    c = Math.floor((c - 1) / 26);
  }
  return `${s}${row}`;
}

function traduzStatus(status: string): string {
  const mapa: Record<string, string> = {
    COTADO: 'Cotado',
    SEM_RESULTADO: 'Sem resultado',
    ERRO: 'Erro',
    PENDENTE: 'Pendente',
  };
  return mapa[status] ?? status;
}

function traduzMetodo(metodo: string): string {
  const mapa: Record<string, string> = {
    MEDIA: 'média aritmética simples',
    MEDIANA: 'mediana',
    MENOR_PRECO: 'menor preço',
  };
  return mapa[metodo] ?? metodo;
}

function montarFundamentacao(cotacoes: Array<{ fundamentacaoArtigo: string | null; preco: unknown }>): string {
  const arts = new Set<string>();
  for (const c of cotacoes) {
    if (c.preco != null && c.fundamentacaoArtigo) arts.add(c.fundamentacaoArtigo);
  }
  return [...arts].join(' | ');
}
