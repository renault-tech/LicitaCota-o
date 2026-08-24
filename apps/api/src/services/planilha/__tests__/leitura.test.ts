import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { lerPlanilha, lerListaColada, parseNumeroBr } from '../leitura.service.js';

async function planilhaCom(linhas: Array<Array<string | number>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Itens');
  for (const l of linhas) ws.addRow(l);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('parseNumeroBr', () => {
  it('lê decimal com vírgula', () => expect(parseNumeroBr('120,5')).toBe(120.5));
  it('lê milhar com ponto e decimal com vírgula', () =>
    expect(parseNumeroBr('1.234,56')).toBe(1234.56));
  it('lê milhar com ponto sem decimal', () => expect(parseNumeroBr('1.500')).toBe(1500));
  it('preserva ponto decimal quando não é agrupamento de milhar', () =>
    expect(parseNumeroBr('120.5')).toBe(120.5));
  it('devolve 0 para texto não numérico', () => expect(parseNumeroBr('abc')).toBe(0));
});

describe('lerPlanilha', () => {
  it('preserva quantidades decimais vindas de células numéricas', async () => {
    const buf = await planilhaCom([
      ['Item', 'Especificação', 'Unidade', 'Quantidade'],
      ['Papel A4', 'Resma 500 folhas', 'RESMA', 120.5],
      ['Cabo de rede', 'UTP cat6', 'M', 2.75],
    ]);
    const { itens } = await lerPlanilha(buf);
    expect(itens.map((i) => i.quantidade)).toEqual([120.5, 2.75]);
  });

  it('detecta o cabeçalho abaixo de linhas de título', async () => {
    const buf = await planilhaCom([
      ['PREFEITURA MUNICIPAL — TERMO DE REFERÊNCIA'],
      [],
      ['Item', 'Especificação', 'Quantidade'],
      ['Caneta azul', 'Esferográfica 1.0mm', 500],
    ]);
    const r = await lerPlanilha(buf);
    expect(r.linhaCabecalho).toBe(3);
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0].quantidade).toBe(500);
  });

  it('preserva colunas não reconhecidas em camposExtras', async () => {
    const buf = await planilhaCom([
      ['Item', 'Quantidade', 'Centro de Custo'],
      ['Caneta azul', 10, 'Educação'],
    ]);
    const { itens } = await lerPlanilha(buf);
    expect(itens[0].camposExtras).toEqual({ 'Centro de Custo': 'Educação' });
  });

  it('recusa planilha sem as colunas essenciais', async () => {
    const buf = await planilhaCom([['Coluna A', 'Coluna B'], ['x', 'y']]);
    await expect(lerPlanilha(buf)).rejects.toThrow(/colunas essenciais/i);
  });
});

describe('lerListaColada', () => {
  it('lê TSV preservando decimais em pt-BR', () => {
    const { itens } = lerListaColada('Item\tQuantidade\nPapel A4\t120,5');
    expect(itens[0].quantidade).toBe(120.5);
  });

  it('recusa texto sem linha de dados', () => {
    expect(() => lerListaColada('Item\tQuantidade')).toThrow();
  });
});
