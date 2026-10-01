import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado } from '@licitapreco/shared';

const { requisitar, materiais, servicos } = vi.hoisted(() => ({
  requisitar: vi.fn(),
  materiais: vi.fn(),
  servicos: vi.fn(),
}));
vi.mock('../../../utils/http.js', () => ({ requisitar }));
vi.mock('../../catalogo/catalogoMatch.service.js', () => ({
  resolverCandidatosCatalogoComFallback: materiais,
  resolverCandidatosCatalogo: servicos,
  melhorCandidatoBruto: vi.fn().mockResolvedValue(null),
}));

const { comprasGovAdapter } = await import('../comprasGov.adapter.js');

const hoje = new Date().toISOString().slice(0, 10);
const linha = (orgao: string, preco: number, descricaoItem: string, data = hoje) => ({
  codigoItemCatalogo: 443990,
  precoUnitario: preco,
  descricaoItem,
  nomeOrgao: orgao,
  estado: 'MG',
  dataResultado: data,
  siglaUnidadeFornecimento: 'UN',
});
const ok = (resultado: unknown[]) => ({ ok: true, status: 200, corpoJson: { resultado, totalRegistros: resultado.length }, corpoTexto: '', latenciaMs: 1 });

const item: ItemNormalizado = {
  nome: 'Caneta esferográfica azul',
  descricao: 'Caneta esferográfica azul',
  descricaoNormalizada: 'caneta esferografica azul',
  cascata: [],
  quantidade: 10,
  unidadeMedida: 'UN',
  uf: 'MG',
};
const config = { limiteResultados: 3, fundamentacaoArtigo: 'IN 65/2021, art. 5º, I' } as unknown as FonteCotacao;

const candidato = { codigo: 443990, tipo: 'MATERIAL', descricaoCatalogo: 'CANETA ESFEROGRÁFICA, COR AZUL', score: 0.8, origem: 'LOCAL', pdm: '5080' };

beforeEach(() => {
  requisitar.mockReset();
  materiais.mockReset().mockResolvedValue([candidato]);
  servicos.mockReset().mockResolvedValue([]);
});

describe('comprasGovAdapter.consultar', () => {
  it('usa o contrato atual da API (tipo+codigo, estado) e devolve preços de órgãos distintos', async () => {
    requisitar.mockResolvedValue(ok([
      linha('Órgão A', 2.5, 'CANETA ESFEROGRÁFICA AZUL'),
      linha('Órgão B', 2.7, 'CANETA ESFEROGRÁFICA AZUL'),
      linha('Órgão C', 2.9, 'CANETA ESFEROGRÁFICA AZUL'),
    ]));
    const r = await comprasGovAdapter.consultar(item, config);
    expect(r.erro).toBeUndefined();
    expect(r.pontos.map((p) => p.preco)).toEqual([2.5, 2.7, 2.9]);
    const url = requisitar.mock.calls[0][0] as string;
    expect(url).toContain('1_consultarMaterial');
    expect(url).toContain('tipo=codigoItemCatalogo');
    expect(url).toContain('codigo=443990');
    expect(url).toContain('estado=MG');
    expect(url).not.toContain('codigoItemCatalogo=443990');
    expect(r.pontos[0].fundamentacaoArtigo).toBe('IN 65/2021, art. 5º, I');
  });

  it('descarta compras com mais de 12 meses', async () => {
    requisitar.mockResolvedValue(ok([linha('Órgão A', 2.5, 'CANETA', '2020-01-01')]));
    const r = await comprasGovAdapter.consultar(item, config);
    expect(r.pontos).toHaveLength(0);
    expect(r.diagnostico).toContain('12 meses');
  });

  it('cai para a família PDM quando o código exato nunca foi comprado, filtrando por descrição', async () => {
    requisitar.mockImplementation(async (url: string) => {
      if (url.includes('tipo=codigoPdm')) {
        return ok([
          linha('Órgão X', 3.1, 'CANETA ESFEROGRÁFICA, COR AZUL, PONTA MÉDIA'),
          linha('Órgão Y', 99, 'CARGA PARA CANETA TINTEIRO'),
          linha('Órgão Z', 3.3, 'CANETA ESFEROGRÁFICA AZUL CORPO TRANSPARENTE'),
        ]);
      }
      return { ok: false, status: 404, corpoJson: null, corpoTexto: '', latenciaMs: 1 };
    });
    const r = await comprasGovAdapter.consultar(item, config);
    expect(r.pontos.map((p) => p.preco).sort()).toEqual([3.1, 3.3]);
  });

  it('usa a rota de serviço quando o catálogo de serviços corresponde melhor', async () => {
    materiais.mockResolvedValue([]);
    servicos.mockResolvedValue([{ ...candidato, codigo: 24325, tipo: 'SERVICO', pdm: null }]);
    requisitar.mockResolvedValue(ok([linha('TRE/MG', 200, 'SERVIÇO DE JARDINAGEM')]));
    const r = await comprasGovAdapter.consultar({ ...item, descricaoNormalizada: 'servico de jardinagem' }, config);
    expect(r.pontos).toHaveLength(1);
    expect(requisitar.mock.calls[0][0]).toContain('3_consultarServico?');
    expect(requisitar.mock.calls[0][0]).toContain('codigoItemCatalogo=24325');
  });

  it('reporta erro (não "sem preço") quando a API falha', async () => {
    requisitar.mockResolvedValue({ ok: false, status: 503, corpoJson: null, corpoTexto: '', latenciaMs: 1 });
    const r = await comprasGovAdapter.consultar(item, config);
    expect(r.erro).toContain('503');
  });
});
