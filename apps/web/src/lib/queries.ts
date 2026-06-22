import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';
import type {
  Pesquisa, FonteCotacao, Usuario, Fornecedor, Notificacao,
  ConfiguracaoSistema, LogAuditoria, ItemPesquisa,
} from '@/types/api';

// ─── Pesquisas ──────────────────────────────────────────────────────────────

export function usePesquisas(pagina = 1, status?: string) {
  return useQuery({
    queryKey: ['pesquisas', pagina, status],
    queryFn: () => {
      const params = new URLSearchParams({ pagina: String(pagina), limite: '12' });
      if (status) params.set('status', status);
      return apiFetch<{ total: number; pagina: number; limite: number; pesquisas: Pesquisa[] }>(
        `/api/pesquisas?${params}`,
      );
    },
  });
}

export function usePesquisa(id: string) {
  return useQuery({
    queryKey: ['pesquisa', id],
    queryFn: () => apiFetch<Pesquisa>(`/api/pesquisas/${id}`),
    enabled: !!id,
  });
}

export function useCreatePesquisa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { titulo: string; descricao?: string; municipio?: string; uf?: string }) =>
      apiFetch<Pesquisa>('/api/pesquisas', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pesquisas'] }),
  });
}

export function useUpdatePesquisa(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Pesquisa>) =>
      apiFetch<Pesquisa>(`/api/pesquisas/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pesquisa', id] });
      qc.invalidateQueries({ queryKey: ['pesquisas'] });
    },
  });
}

export function useDeletePesquisa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/pesquisas/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pesquisas'] }),
  });
}

export function useProcessarPesquisa(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; jobId: string }>(`/api/pesquisas/${id}/processar`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pesquisa', id] }),
  });
}

export function useUpdateItem(pesquisaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: { observacao?: string; precoManual?: number; referenciaManual?: string } }) =>
      apiFetch<ItemPesquisa>(`/api/pesquisas/${pesquisaId}/itens/${itemId}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pesquisa', pesquisaId] }),
  });
}

// ─── Fontes ─────────────────────────────────────────────────────────────────

export function useFontes() {
  return useQuery({
    queryKey: ['fontes'],
    queryFn: () => apiFetch<FonteCotacao[]>('/api/fontes'),
  });
}

export function useCreateFonte() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<FonteCotacao>) =>
      apiFetch<FonteCotacao>('/api/fontes', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fontes'] }),
  });
}

export function useUpdateFonte() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FonteCotacao> }) =>
      apiFetch<FonteCotacao>(`/api/fontes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fontes'] }),
  });
}

export function useDeleteFonte() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/fontes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fontes'] }),
  });
}

export function useTestarFonte() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ resultado: { ok: boolean; latenciaMs: number; amostraPreco: number | null; amostraReferencia: string | null; mensagem: string } }>(
        `/api/fontes/${id}/testar`,
        { method: 'POST' },
      ),
  });
}

export function useAtivarFonte() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      apiFetch<FonteCotacao>(`/api/fontes/${id}/ativar`, { method: 'PUT', body: JSON.stringify({ ativo }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fontes'] }),
  });
}

// ─── Usuários ────────────────────────────────────────────────────────────────

export function useUsuarios(pagina = 1) {
  return useQuery({
    queryKey: ['usuarios', pagina],
    queryFn: () =>
      apiFetch<{ total: number; pagina: number; limite: number; usuarios: Usuario[] }>(
        `/api/usuarios?pagina=${pagina}&limite=20`,
      ),
  });
}

export function useConvidarUsuario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { email: string; nome: string; role?: string; cargo?: string; setor?: string }) =>
      apiFetch<Usuario>('/api/usuarios', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['usuarios'] }),
  });
}

export function useUpdateUsuario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Usuario> }) =>
      apiFetch<Usuario>(`/api/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['usuarios'] }),
  });
}

// ─── Fornecedores ───────────────────────────────────────────────────────────

export function useFornecedores(busca = '', pagina = 1) {
  return useQuery({
    queryKey: ['fornecedores', busca, pagina],
    queryFn: () => {
      const p = new URLSearchParams({ pagina: String(pagina), limite: '20' });
      if (busca) p.set('busca', busca);
      return apiFetch<{ total: number; pagina: number; limite: number; fornecedores: Fornecedor[] }>(`/api/fornecedores?${p}`);
    },
  });
}

export function useCreateFornecedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { razaoSocial: string; cnpj: string; contatoNome?: string; email?: string; telefone?: string }) =>
      apiFetch<Fornecedor>('/api/fornecedores', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fornecedores'] }),
  });
}

// ─── Notificações ────────────────────────────────────────────────────────────

export function useNotificacoes() {
  return useQuery({
    queryKey: ['notificacoes'],
    queryFn: () =>
      apiFetch<{ notificacoes: Notificacao[]; totalNaoLidas: number }>('/api/notificacoes?limite=20'),
    refetchInterval: 30_000,
  });
}

export function useMarcarLida() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/notificacoes/${id}/ler`, { method: 'PUT' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notificacoes'] }),
  });
}

export function useMarcarTodasLidas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>('/api/notificacoes/ler-todas', { method: 'PUT' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notificacoes'] }),
  });
}

// ─── Configuração ─────────────────────────────────────────────────────────────

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => apiFetch<ConfiguracaoSistema>('/api/config'),
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<ConfiguracaoSistema>) =>
      apiFetch<ConfiguracaoSistema>('/api/config', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });
}

// ─── Auditoria ───────────────────────────────────────────────────────────────

export function useAuditoria(pagina = 1, acao?: string) {
  return useQuery({
    queryKey: ['auditoria', pagina, acao],
    queryFn: () => {
      const p = new URLSearchParams({ pagina: String(pagina), limite: '30' });
      if (acao) p.set('acao', acao);
      return apiFetch<{ total: number; pagina: number; limite: number; logs: LogAuditoria[] }>(`/api/auditoria?${p}`);
    },
  });
}
