import { motion } from 'framer-motion';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export default function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex items-start justify-between mb-6 gap-4"
    >
      <div>
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">{title}</h2>
        {description && <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </motion.div>
  );
}
