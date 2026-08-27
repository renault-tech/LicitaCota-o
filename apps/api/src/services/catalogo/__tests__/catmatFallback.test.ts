import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requisitar, envMock } = vi.hoisted(() => ({
  requisitar: vi.fn(),
  envMock: { CATMAT_FALLBACK_HABILITADO: 'false' },
}));
vi.mock('../../../utils/http.js', () => ({ requisitar }));
vi.mock('../../../config/env.js', () => ({ env: envMock }));

const { buscarCandidatoExterno } = await import('../catmatFallback.service.js');

function respostaOk(json: unknown) {
  return { ok: true, status: 200, corpoTexto: JSON.stringify(json), corpoJson: json, latenciaMs: 5 };
}
function respostaErro(status: number) {
  return { ok: false, status, corpoTexto: '', corpoJson: null, latenciaMs: 5 };
}

beforeEach(() => {
  requisitar.mockReset();
  envMock.CATMAT_FALLBACK_HABILITADO = 'false';
});

describe('buscarCandidatoExterno', () => {
  it('nunca chama a rede quando a flag está desligada (padrão)', async () => {
    const resultado = await buscarCandidatoExterno('caneta esferográfica azul');
    expect(resultado).toBeNull();
    expect(requisitar).not.toHaveBeenCalled();
  });

  it('devolve o candidato quando a flag está ligada e a resposta é válida (formato real confirmado — embrulho em "hits")', async () => {
    envMock.CATMAT_FALLBACK_HABILITADO = 'true';
    // Amostra real da API, colada pelo usuário a partir de uma chamada de verdade.
    requisitar.mockResolvedValue(respostaOk({
      total: 2857,
      hits: [
        {
          id: 'ouhM6Z0B2NBq6uGFQF0h',
          score: 252.58571,
          codigo_item: 279313,
          descricao_item: 'CANETA MARCA-TEXTO, MATERIAL:PLÁSTICO, TIPO PONTA:FLUORESCENTE, COR:AMARELA',
          nome_grupo: 'UTENSÍLIOS DE ESCRITÓRIO E MATERIAL DE EXPEDIENTE',
          nome_classe: 'ARTIGOS PARA ESCRITÓRIO',
          nome_pdm: 'CANETA MARCA-TEXTO',
          codigo_pdm: 18075,
          codigo_ncm: null,
          likes: 0,
        },
      ],
    }));

    const resultado = await buscarCandidatoExterno('caneta');
    expect(resultado).toEqual({
      codigo: 279313,
      descricaoCatalogo: 'CANETA MARCA-TEXTO, MATERIAL:PLÁSTICO, TIPO PONTA:FLUORESCENTE, COR:AMARELA',
    });
  });

  it('devolve null em HTTP não-2xx', async () => {
    envMock.CATMAT_FALLBACK_HABILITADO = 'true';
    requisitar.mockResolvedValue(respostaErro(500));

    const resultado = await buscarCandidatoExterno('caneta esferográfica azul');
    expect(resultado).toBeNull();
  });

  it('devolve null quando requisitar lança (timeout/erro de rede) — nunca propaga', async () => {
    envMock.CATMAT_FALLBACK_HABILITADO = 'true';
    requisitar.mockRejectedValue(new Error('Tempo de resposta excedido (timeout de 5000ms)'));

    await expect(buscarCandidatoExterno('caneta esferográfica azul')).resolves.toBeNull();
  });

  it('devolve null com formato de resposta inesperado', async () => {
    envMock.CATMAT_FALLBACK_HABILITADO = 'true';
    requisitar.mockResolvedValue(respostaOk({ mensagem: 'ok mas sem itens' }));

    const resultado = await buscarCandidatoExterno('caneta esferográfica azul');
    expect(resultado).toBeNull();
  });

  it('devolve null quando o item não tem código ou descrição válidos', async () => {
    envMock.CATMAT_FALLBACK_HABILITADO = 'true';
    requisitar.mockResolvedValue(respostaOk({ resultado: [{ codigo_item: null, descricao_item: '' }] }));

    const resultado = await buscarCandidatoExterno('caneta esferográfica azul');
    expect(resultado).toBeNull();
  });
});
