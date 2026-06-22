import { cn } from '@/lib/utils';
import type { StatusPesquisa, StatusItem, StatusValidacaoFonte } from '@/types/api';

const STATUS_PESQUISA: Record<StatusPesquisa, { label: string; cls: string }> = {
  AGUARDANDO:   { label: 'Aguardando',   cls: 'bg-zinc-100  text-zinc-600  dark:bg-zinc-800  dark:text-zinc-400' },
  PROCESSANDO:  { label: 'Processando',  cls: 'bg-blue-50   text-blue-600  dark:bg-blue-900/30 dark:text-blue-400' },
  CONCLUIDA:    { label: 'Concluída',    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  ERRO:         { label: 'Erro',         cls: 'bg-red-50    text-red-600   dark:bg-red-900/30  dark:text-red-400' },
};

const STATUS_ITEM: Record<StatusItem, { label: string; cls: string }> = {
  PENDENTE:     { label: 'Pendente',     cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
  COTADO:       { label: 'Cotado',       cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  SEM_RESULTADO:{ label: 'Sem resultado',cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  ERRO:         { label: 'Erro',         cls: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
};

const STATUS_FONTE: Record<StatusValidacaoFonte, { label: string; cls: string }> = {
  VALIDA:      { label: 'Válida',      cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  INVALIDA:    { label: 'Inválida',    cls: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
  NAO_TESTADA: { label: 'Não testada', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
};

export function PesquisaBadge({ status, className }: { status: StatusPesquisa; className?: string }) {
  const s = STATUS_PESQUISA[status];
  return <span className={cn('inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full', s.cls, className)}>{s.label}</span>;
}

export function ItemBadge({ status }: { status: StatusItem }) {
  const s = STATUS_ITEM[status];
  return <span className={cn('inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full', s.cls)}>{s.label}</span>;
}

export function FonteBadge({ status }: { status: StatusValidacaoFonte }) {
  const s = STATUS_FONTE[status];
  return <span className={cn('inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full', s.cls)}>{s.label}</span>;
}
