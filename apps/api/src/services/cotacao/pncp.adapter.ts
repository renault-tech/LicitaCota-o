import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, ResultadoCotacao, TesteResultado } from '@licitapreco/shared';
import { requisitar } from '../../utils/http.js';
import { media } from './calculo.js';
import type { FonteAdapter } from './adapter.js';

/**
 * Adapter genérico PNCP — contratações por modalidade.
 * A modalidade é lida de parametrosTemplate.modalidade (padrão: 6 = Pregão).
 * Regra da API: tamanhoPagina >= 10 e codigoModalidadeContratacao obrigatório.
 */

const BASE = 'https://pncp.gov.br/api';

interface ContratacaoItem {
  descricao?: string;
  valorUnitarioEstimado?: number;
}

interface Contratacao {
  orgaoEntidade?: { cnpj?: string };
  anoCompra?: number;
  sequencialCompra?: number;
}

function dataFormatada(diasAtras: number): string {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').trim();
}

// Modalidades com maior volume de itens de material/serviço comum
const MODALIDADES_PRINCIPAIS = [6, 8, 1]; // Pregão, Dispensa Eletrônica, Concorrência

async function buscarContratacoes(paginas = 2): Promise<Contratacao[]> {
  const dataFinal = dataFormatada(1);
  const dataInicial = dataFormatada(61);
  const todas: Contratacao[] = [];
  for (const modalidade of MODALIDADES_PRINCIPAIS) {
    for (let p = 1; p <= paginas; p++) {
      const url =
        `${BASE}/consulta/v1/contratacoes/publicacao` +
        `?dataInicial=${dataInicial}&dataFinal=${dataFinal}` +
        `&codigoModalidadeContratacao=${modalidade}&pagina=${p}&tamanhoPagina=20`;
      const resp = await requisitar(url, { timeoutMs: 15000, retries: 1 });
      if (!resp.ok) break;
      const body = resp.corpoJson as { data?: Contratacao[] } | null;
      const data = body?.data ?? [];
      todas.push(...data);
      if (data.length < 20) break;
    }
  }
  return todas;
}

async function buscarItensContratacao(cnpj: string, ano: number, seq: number): Promise<ContratacaoItem[]> {
  const url = `${BASE}/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/itens?pagina=1&tamanhoPagina=20`;
  const resp = await requisitar(url, { timeoutMs: 12000, retries: 0 });
  if (!resp.ok) return [];
  const body = resp.corpoJson;
  if (Array.isArray(body)) return body as ContratacaoItem[];
  return (body as { data?: ContratacaoItem[] })?.data ?? [];
}

async function buscarPrecos(
  termos: string[],
  limite: number,
): Promise<{ precos: number[]; referencia: string | null }> {
  const contratacoes = await buscarContratacoes(3);
  const precos: number[] = [];
  let referencia: string | null = null;

  for (const ct of contratacoes) {
    if (precos.length >= limite) break;
    const { cnpj } = ct.orgaoEntidade ?? {};
    const { anoCompra: ano, sequencialCompra: seq } = ct;
    if (!cnpj || !ano || !seq) continue;
    const itens = await buscarItensContratacao(cnpj, ano, seq);
    for (const item of itens) {
      if (!item.descricao || !item.valorUnitarioEstimado) continue;
      const descNorm = normalizar(item.descricao);
      const ok = termos.some((t) =>
        normalizar(t).split(' ').filter((w) => w.length > 3).every((w) => descNorm.includes(w)),
      );
      if (ok && item.valorUnitarioEstimado > 0) {
        precos.push(item.valorUnitarioEstimado);
        if (!referencia) referencia = `PNCP — ${cnpj} ${ano}/${seq}`;
        if (precos.length >= limite) break;
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
      const { precos, referencia } = await buscarPrecos(item.cascata, limite);
      if (precos.length === 0) {
        return { preco: null, referencia: '', fundamentacaoArtigo: config.fundamentacaoArtigo ?? '', dadosBrutos: null };
      }
      return {
        preco: Math.round(media(precos) * 10000) / 10000,
        referencia: referencia ?? `PNCP — ${new Date().toLocaleDateString('pt-BR')}`,
        fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
        dadosBrutos: { precos, modalidade },
      };
    } catch (e) {
      return {
        preco: null, referencia: '', fundamentacaoArtigo: config.fundamentacaoArtigo ?? '',
        dadosBrutos: null, erro: e instanceof Error ? e.message : 'Erro',
      };
    }
  },

  async testar(_config: FonteCotacao, _itemAmostra: string): Promise<TesteResultado> {
    const inicio = Date.now();
    try {
      // Testa com modalidade 6 (Pregão) — maior volume, sempre tem dados recentes
      const dataFinal = dataFormatada(1);
      const dataInicial = dataFormatada(31);
      const url =
        `${BASE}/consulta/v1/contratacoes/publicacao` +
        `?dataInicial=${dataInicial}&dataFinal=${dataFinal}` +
        `&codigoModalidadeContratacao=6&pagina=1&tamanhoPagina=10`;
      const resp = await requisitar(url, { timeoutMs: 15000, retries: 1 });
      const latenciaMs = Date.now() - inicio;
      if (!resp.ok) {
        return { ok: false, latenciaMs, amostraPreco: null, amostraReferencia: null, mensagem: `PNCP respondeu HTTP ${resp.status}.`, dadosBrutos: null };
      }
      const body = resp.corpoJson as { data?: unknown[] } | null;
      const count = body?.data?.length ?? 0;
      return {
        ok: count > 0, latenciaMs, amostraPreco: null, amostraReferencia: null,
        mensagem: count > 0
          ? `PNCP acessível — ${count} contratações recentes (Pregão + Dispensa + Concorrência) em ${latenciaMs}ms.`
          : 'PNCP sem contratações recentes no período consultado.',
        dadosBrutos: { contratacoes: count },
      };
    } catch (e) {
      return {
        ok: false, latenciaMs: Date.now() - inicio, amostraPreco: null, amostraReferencia: null,
        mensagem: e instanceof Error ? `Falha: ${e.message}` : 'Falha de conexão.', dadosBrutos: null,
      };
    }
  },
};
