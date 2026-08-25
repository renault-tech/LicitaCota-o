import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado } from '@licitapreco/shared';

const { requisitar } = vi.hoisted(() => ({ requisitar: vi.fn() }));
vi.mock('../../../utils/http.js', () => ({ requisitar }));

// Import depois do mock — pncp.adapter.ts importa requisitar no topo do módulo.
const { pncpAdapter } = await import('../pncp.adapter.js');

function respostaOk(json: unknown) {
  return { ok: true, status: 200, corpoTexto: JSON.stringify(json), corpoJson: json, latenciaMs: 5 };
}
function respostaErro(status: number) {
  return { ok: false, status, corpoTexto: '', corpoJson: null, latenciaMs: 5 };
}

const item: ItemNormalizado = {
  nome: 'Caneta esferográfica azul',
  descricao: 'Caneta esferográfica, tinta azul, ponta 1.0mm',
  descricaoNormalizada: 'caneta esferografica azul 1.0mm',
  cascata: ['caneta esferografica azul 1.0mm', 'caneta esferografica azul', 'caneta azul'],
  quantidade: 10,
  unidadeMedida: 'UN',
};

const config = { limiteResultados: 3, fundamentacaoArtigo: 'Art. 23' } as unknown as FonteCotacao;

const contrato = (cnpj: string, seq: number) => ({
  orgaoEntidade: { cnpj, razaoSocial: `Órgão ${cnpj}` },
  anoCompra: 2026,
  sequencialCompra: seq,
  dataPublicacaoPncp: '2026-06-01',
});

beforeEach(() => {
  requisitar.mockReset();
});

describe('pncpAdapter.consultar', () => {
  it('devolve UM PONTO POR CONTRATO — não agrega em um único preço', async () => {
    const janelasVistas = new Set<string>();
    requisitar.mockImplementation(async (url: string) => {
      if (url.includes('/contratacoes/publicacao')) {
        const chave = url.split('&pagina=')[0];
        const primeiraVezNestaJanela = !janelasVistas.has(chave);
        janelasVistas.add(chave);
        const indice = [...janelasVistas].indexOf(chave);
        if (indice === 0) {
          return respostaOk({ totalPaginas: 1, data: [contrato('11111111000100', 1), contrato('22222222000100', 2)] });
        }
        void primeiraVezNestaJanela;
        return respostaOk({ totalPaginas: 1, data: [] });
      }
      if (url.includes('/itens')) {
        const preco = url.includes('11111111000100') ? 2.5 : 2.7;
        return respostaOk([{ descricao: 'Caneta esferográfica azul 1.0mm', valorUnitario: preco }]);
      }
      throw new Error(`URL inesperada no teste: ${url}`);
    });

    const resultado = await pncpAdapter.consultar(item, config);

    expect(resultado.erro).toBeUndefined();
    expect(resultado.pontos).toHaveLength(2);
    expect(resultado.pontos.map((p) => p.preco).sort()).toEqual([2.5, 2.7]);
    // Cada ponto carrega sua própria referência (fonte distinta) — é isso
    // que permite ao cálculo tratar como 2 cotações reais, não 1 média.
    expect(new Set(resultado.pontos.map((p) => p.referencia)).size).toBe(2);
  });

  it('descarta itens cuja descrição não bate o suficiente (evita falso positivo)', async () => {
    requisitar.mockImplementation(async (url: string) => {
      if (url.includes('/contratacoes/publicacao')) return respostaOk({ totalPaginas: 1, data: [contrato('11111111000100', 1)] });
      if (url.includes('/itens')) return respostaOk([{ descricao: 'Cadeira de escritório giratória', valorUnitario: 350 }]);
      throw new Error('URL inesperada');
    });

    const resultado = await pncpAdapter.consultar(item, config);
    expect(resultado.erro).toBeUndefined();
    expect(resultado.pontos).toHaveLength(0);
  });

  it('sinaliza ERRO (não "sem resultado") quando a fonte está indisponível', async () => {
    requisitar.mockImplementation(async (url: string) => {
      if (url.includes('/contratacoes/publicacao')) return respostaErro(503);
      throw new Error('não deveria buscar itens sem listar contratações');
    });

    const resultado = await pncpAdapter.consultar(item, config);
    expect(resultado.pontos).toHaveLength(0);
    expect(resultado.erro).toBeTruthy();
  });

  it('não propaga erro se ALGUMA janela funcionou, mesmo que outra falhe', async () => {
    let chamadas = 0;
    requisitar.mockImplementation(async (url: string) => {
      if (url.includes('/contratacoes/publicacao')) {
        chamadas++;
        if (chamadas === 1) return respostaOk({ totalPaginas: 1, data: [contrato('11111111000100', 1)] });
        return respostaErro(500);
      }
      if (url.includes('/itens')) return respostaOk([{ descricao: 'Caneta esferográfica azul 1.0mm', valorUnitario: 3 }]);
      throw new Error('URL inesperada');
    });

    const resultado = await pncpAdapter.consultar(item, config);
    expect(resultado.erro).toBeUndefined();
    expect(resultado.pontos).toHaveLength(1);
  });
});
