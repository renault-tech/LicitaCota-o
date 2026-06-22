import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center py-20 text-center"
    >
      <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-zinc-400" strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">{title}</h3>
      {description && <p className="text-sm text-zinc-500 mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}
