import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, ResultadoCotacao, TesteResultado } from '@licitapreco/shared';
import { requisitar } from '../../utils/http.js';
import { media } from './calculo.js';
import type { FonteAdapter } from './adapter.js';

const BASE = 'https://pncp.gov.br/api';

interface ContratacaoItem {
  numeroItem?: number;
  descricao?: string;
  valorUnitarioEstimado?: number;
  valorTotal?: number;
  quantidade?: number;
  unidadeMedida?: string;
}

interface Contratacao {
  orgaoEntidade?: { cnpj?: string };
  anoCompra?: number;
  sequencialCompra?: number;
}

function dataFormatada(diasAtras = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
}

async function buscarContratacoes(paginas = 2): Promise<Contratacao[]> {
  const dataFinal = dataFormatada(0);
  const dataInicial = dataFormatada(60);
  const todas: Contratacao[] = [];
  for (let p = 1; p <= paginas; p++) {
    const url =
      `${BASE}/consulta/v1/contratacoes/publicacao` +
      `?dataInicial=${dataInicial}&dataFinal=${dataFinal}` +
      `&codigoModalidadeContratacao=6&pagina=${p}&tamanhoPagina=20`;
    const resp = await requisitar(url, { timeoutMs: 15000, retries: 1 });
    if (!resp.ok) break;
    const body = resp.corpoJson as { data?: Contratacao[] } | null;
    const data = body?.data ?? [];
    todas.push(...data);
    if (data.length < 20) break;
  }
  return todas;
}

async function buscarItensContratacao(
  cnpj: string,
  ano: number,
  seq: number,
): Promise<ContratacaoItem[]> {
  const url = `${BASE}/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/itens?pagina=1&tamanhoPagina=20`;
  const resp = await requisitar(url, { timeoutMs: 12000, retries: 0 });
  if (!resp.ok) return [];
  const body = resp.corpoJson as ContratacaoItem[] | { data?: ContratacaoItem[] } | null;
  if (Array.isArray(body)) return body;
  return (body as { data?: ContratacaoItem[] })?.data ?? [];
}

async function buscarPrecosPorDescricao(
  termos: string[],
  limitePrecos: number,
): Promise<{ precos: number[]; referencia: string | null }> {
  const contratacoes = await buscarContratacoes(3);
  const precos: number[] = [];
  let referencia: string | null = null;

  for (const ct of contratacoes) {
    if (precos.length >= limitePrecos) break;
    const cnpj = ct.orgaoEntidade?.cnpj;
    const ano = ct.anoCompra;
    const seq = ct.sequencialCompra;
    if (!cnpj || !ano || !seq) continue;

    const itens = await buscarItensContratacao(cnpj, ano, seq);
    for (const item of itens) {
      if (!item.descricao || !item.valorUnitarioEstimado) continue;
      const descNorm = normalizar(item.descricao);
      const match = termos.some((t) =>
        normalizar(t)
          .split(' ')
          .filter((w) => w.length > 3)
          .every((w) => descNorm.includes(w)),
      );
      if (match && item.valorUnitarioEstimado > 0) {
        precos.push(item.valorUnitarioEstimado);
        if (!referencia) referencia = `PNCP — ${cnpj} ${ano}/${seq}`;
        if (precos.length >= limitePrecos) break;
      }
    }
  }
  return { precos, referencia };
}

export const pncpAdapter: FonteAdapter = {
  slug: 'pncp',

  async consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoCotacao> {
    const limite = Math.max(config.limiteResultados > 0 ? config.limiteResultados : 5, 3);
    try {
      const { precos, referencia } = await buscarPrecosPorDescricao(item.cascata, limite);
      if (precos.length === 0) {
        return { preco: null, referencia: '', fundamentacaoArtigo: config.fundamentacaoArtigo ?? '', dadosBrutos: null };
      }
      return {
        preco: Math.round(media(precos) * 10000) / 10000,
        referencia: referencia ?? `PNCP — ${new Date().toLocaleDateString('pt-BR')}`,
        fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
        dadosBrutos: { precos, fonte: 'pncp' },
      };
    } catch (e) {
      return {
        preco: null, referencia: '', fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
        dadosBrutos: null, erro: e instanceof Error ? e.message : 'Erro',
      };
    }
  },

  async testar(_config: FonteCotacao, itemAmostra: string): Promise<TesteResultado> {
    const inicio = Date.now();
    try {
      const { precos, referencia } = await buscarPrecosPorDescricao([itemAmostra], 3);
      const latenciaMs = Date.now() - inicio;
      if (precos.length === 0) {
        // Testa ao menos se a API responde corretamente, mesmo sem match de descrição
        const dataFinal = dataFormatada(0);
        const dataInicial = dataFormatada(60);
        const url = `${BASE}/consulta/v1/contratacoes/publicacao?dataInicial=${dataInicial}&dataFinal=${dataFinal}&codigoModalidadeContratacao=6&pagina=1&tamanhoPagina=5`;
        const resp = await requisitar(url, { timeoutMs: 15000, retries: 1 });
        if (!resp.ok) {
          return {
            ok: false, latenciaMs: Date.now() - inicio,
            amostraPreco: null, amostraReferencia: null,
            mensagem: `PNCP respondeu HTTP ${resp.status}.`,
            dadosBrutos: null,
          };
        }
        const body = resp.corpoJson as { data?: unknown[] } | null;
        const count = body?.data?.length ?? 0;
        return {
          ok: count > 0, latenciaMs: Date.now() - inicio,
          amostraPreco: null, amostraReferencia: null,
          mensagem: count > 0
            ? `PNCP acessível (${count} contratações recentes). Nenhum item com "${itemAmostra}" nos últimos 60 dias.`
            : 'PNCP sem contratações recentes no período consultado.',
          dadosBrutos: { contratacoes: count },
        };
      }
      return {
        ok: true, latenciaMs,
        amostraPreco: Math.round(media(precos) * 10000) / 10000,
        amostraReferencia: referencia,
        mensagem: `${precos.length} preço(s) encontrado(s) no PNCP em ${latenciaMs}ms.`,
        dadosBrutos: { precos, fonte: 'pncp' },
      };
    } catch (e) {
      return {
        ok: false, latenciaMs: Date.now() - inicio,
        amostraPreco: null, amostraReferencia: null,
        mensagem: e instanceof Error ? `Falha: ${e.message}` : 'Falha de conexão.',
        dadosBrutos: null,
      };
    }
  },
};
