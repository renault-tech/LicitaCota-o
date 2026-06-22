'use client';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import ProgressoSSE from '@/components/pesquisas/ProgressoSSE';
import { usePesquisa } from '@/lib/queries';

export default function ProcessarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: pesquisa } = usePesquisa(id);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <button onClick={() => router.back()} className="btn-ghost w-8 h-8 p-0">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Processando pesquisa</h2>
          {pesquisa && <p className="text-sm text-zinc-500">{pesquisa.titulo}</p>}
        </div>
      </div>

      <ProgressoSSE pesquisaId={id} />
    </div>
  );
}
