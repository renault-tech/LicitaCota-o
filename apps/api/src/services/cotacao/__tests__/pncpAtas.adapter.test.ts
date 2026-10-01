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
}));

const { pncpAtasAdapter } = await import('../pncpAtas.adapter.js');

const ata = (n: string, valorUnitario: number, extra: Record<string, unknown> = {}) => ({
  numeroAtaRegistroPreco: n,
  numeroControlePncpAta: `46068425000133-1-001057/2025-0000${n}`,
  codigoItem: 443990,
  descricaoItem: 'CLIPE USO CIRÚRGICO',
  tipoItem: 'Material',
  valorUnitario,
  nomeUnidadeGerenciadora: `UG ${n}`,
  dataAssinatura: '2026-09-30T00:00:00',
  itemExcluido: false,
  ...extra,
});

const item = (): ItemNormalizado => ({
  nome: 'Clipe cirúrgico', descricao: 'Clipe cirúrgico titânio', descricaoNormalizada: 'clipe cirurgico titanio',
  cascata: [], quantidade: 1, unidadeMedida: 'UN',
});
const config = { limiteResultados: 3, fundamentacaoArtigo: 'Art. 82' } as unknown as FonteCotacao;

beforeEach(() => {
  requisitar.mockReset();
  materiais.mockReset().mockResolvedValue([{ codigo: 443990, tipo: 'MATERIAL', descricaoCatalogo: 'CLIPE', score: 0.9, origem: 'LOCAL', pdm: '5080' }]);
  servicos.mockReset().mockResolvedValue([]);
});

describe('pncpAtasAdapter.consultar', () => {
  it('consulta atas por código com a janela de vigência obrigatória e ignora itens excluídos', async () => {
    requisitar.mockResolvedValue({
      ok: true, status: 200, corpoTexto: '', latenciaMs: 1,
      corpoJson: { resultado: [ata('1', 29.7), ata('2', 18), ata('3', 50, { itemExcluido: true }), ata('4', 22)] },
    });
    const r = await pncpAtasAdapter.consultar(item(), config);
    expect(r.pontos.map((p) => p.preco).sort((a, b) => a - b)).toEqual([18, 22, 29.7]);
    const url = requisitar.mock.calls[0][0] as string;
    expect(url).toContain('modulo-arp/2_consultarARPItem');
    expect(url).toContain('codigoItem=443990');
    expect(url).toMatch(/dataVigenciaInicialMin=\d{4}-\d{2}-\d{2}/);
    expect(r.pontos[0].referencia).toContain('PNCP');
    expect(r.pontos[0].fundamentacaoArtigo).toBe('Art. 82');
  });

  it('diferencia "sem ata" de falha da API', async () => {
    requisitar.mockResolvedValue({ ok: true, status: 200, corpoJson: { resultado: [] }, corpoTexto: '', latenciaMs: 1 });
    const vazio = await pncpAtasAdapter.consultar(item(), config);
    expect(vazio.erro).toBeUndefined();
    expect(vazio.diagnostico).toContain('nenhuma ata');

    requisitar.mockResolvedValue({ ok: false, status: 502, corpoJson: null, corpoTexto: '', latenciaMs: 1 });
    const falha = await pncpAtasAdapter.consultar(item(), config);
    expect(falha.erro).toContain('502');
  });
});
