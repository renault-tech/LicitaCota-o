import { motion } from 'framer-motion';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export default function ErrorState({ title = 'Não foi possível carregar', message, onRetry }: ErrorStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center py-20 text-center"
    >
      <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center mb-4">
        <AlertTriangle className="w-7 h-7 text-red-500" strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">{title}</h3>
      {message && <p className="text-sm text-zinc-500 mt-1 max-w-xs">{message}</p>}
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost text-xs px-3 py-1.5 mt-5 inline-flex items-center gap-1.5">
          <RotateCw className="w-3.5 h-3.5" />
          Tentar novamente
        </button>
      )}
    </motion.div>
  );
}
