'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, AlertTriangle, Building2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface DadosCotacaoPublica {
  fornecedor: string;
  item: { nome: string; descricao: string; quantidade: number; unidadeMedida: string | null };
  pesquisaTitulo: string;
  municipio: string | null;
  uf: string | null;
  status: 'ENVIADA' | 'RESPONDIDA' | 'RECUSADA';
  jaRespondida: boolean;
  precoEnviado: string | null;
}

/**
 * Página pública (sem login) para o fornecedor responder a uma solicitação
 * de cotação direta disparada automaticamente pelo sistema. Acesso é pelo
 * token da URL — é o link enviado por e-mail.
 */
export default function CotarPublicoPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [dados, setDados] = useState<DadosCotacaoPublica | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [preco, setPreco] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState<'preco' | 'recusa' | null>(null);

  useEffect(() => {
    apiFetch<DadosCotacaoPublica>(`/api/cotar/${token}`, { skipAuth: true })
      .then(setDados)
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não foi possível carregar esta cotação.'))
      .finally(() => setCarregando(false));
  }, [token]);

  async function enviarPreco() {
    const valor = Number(preco.replace(/\./g, '').replace(',', '.'));
    if (!valor || valor <= 0) { setErro('Informe um preço válido.'); return; }
    setEnviando(true);
    setErro(null);
    try {
      await apiFetch(`/api/cotar/${token}`, { method: 'POST', skipAuth: true, body: JSON.stringify({ preco: valor }) });
      setConcluido('preco');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao enviar. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  async function recusar() {
    setEnviando(true);
    setErro(null);
    try {
      await apiFetch(`/api/cotar/${token}`, { method: 'POST', skipAuth: true, body: JSON.stringify({ recusar: true }) });
      setConcluido('recusa');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao registrar. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6"
      >
        <div className="flex items-center gap-2 mb-6 text-zinc-400">
          <Building2 className="w-4 h-4" />
          <span className="text-xs font-medium tracking-wide uppercase">LicitaPreço — Cotação de preço</span>
        </div>

        {carregando ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>
        ) : !dados ? (
          <div className="text-center py-8">
            <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-amber-500" />
            <p className="font-medium text-zinc-700 dark:text-zinc-200">Link inválido ou expirado</p>
            <p className="text-sm text-zinc-400 mt-1">{erro ?? 'Entre em contato com quem solicitou a cotação.'}</p>
          </div>
        ) : concluido || dados.jaRespondida ? (
          <div className="text-center py-8">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-500" />
            <p className="font-medium text-zinc-800 dark:text-zinc-100">
              {concluido === 'recusa' || dados.status === 'RECUSADA' ? 'Registramos que você não deseja cotar este item.' : 'Cotação recebida — obrigado!'}
            </p>
            {dados.precoEnviado && (
              <p className="text-sm text-zinc-400 mt-1">Preço informado: R$ {Number(dados.precoEnviado).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-zinc-500 mb-1">Olá, <strong>{dados.fornecedor}</strong></p>
            <p className="text-sm text-zinc-500 mb-4">
              Solicitação de cotação para a pesquisa <strong>{dados.pesquisaTitulo}</strong>
              {dados.municipio ? ` — ${dados.municipio}/${dados.uf}` : ''}.
            </p>

            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4 mb-5 space-y-1.5">
              <p className="font-medium text-zinc-900 dark:text-white">{dados.item.nome}</p>
              <p className="text-sm text-zinc-500">{dados.item.descricao}</p>
              <p className="text-sm text-zinc-400">Quantidade: {dados.item.quantidade} {dados.item.unidadeMedida ?? ''}</p>
            </div>

            <label className="label">Preço unitário (R$)</label>
            <input
              value={preco}
              onChange={(e) => setPreco(e.target.value)}
              className="input mb-1"
              placeholder="0,00"
              inputMode="decimal"
              disabled={enviando}
            />
            {erro && <p className="text-xs text-red-500 mb-2">{erro}</p>}

            <div className="flex gap-3 mt-4">
              <button onClick={recusar} disabled={enviando} className="btn-secondary flex-1">
                Não vou cotar
              </button>
              <button onClick={enviarPreco} disabled={enviando} className="btn-primary flex-1">
                {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enviar preço'}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
