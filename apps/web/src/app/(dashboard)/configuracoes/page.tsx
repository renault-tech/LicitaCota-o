'use client';
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Save, Calculator, Mail, HelpCircle, Globe } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useConfig, useUpdateConfig } from '@/lib/queries';
import type { MetodoCalculo } from '@/types/api';

const schema = z.object({
  municipio: z.string().optional(),
  uf: z.string().max(2).optional(),
  responsavelTecnico: z.string().optional(),
  metodoCalculo: z.enum(['MEDIA', 'MEDIANA', 'MENOR_PRECO']),
  limiteOutlierPercentual: z.coerce.number().min(0).max(100),
  minFontesCompleta: z.coerce.number().min(1).max(10),
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().optional(),
  smtpUser: z.string().optional(),
  smtpFrom: z.string().optional(),
  suporteEmail: z.string().optional(),
  suporteWhatsapp: z.string().optional(),
});
type Form = z.infer<typeof schema>;

const METODOS: { value: MetodoCalculo; label: string; desc: string }[] = [
  { value: 'MEDIA', label: 'Média', desc: 'Média aritmética dos preços coletados' },
  { value: 'MEDIANA', label: 'Mediana', desc: 'Valor central após ordenação (recomendado)' },
  { value: 'MENOR_PRECO', label: 'Menor preço', desc: 'O menor preço válido encontrado' },
];

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-5 pb-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
          <Icon className="w-4 h-4 text-blue-500" />
        </div>
        <h3 className="font-semibold text-sm text-zinc-900 dark:text-white">{title}</h3>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export default function ConfiguracoesPage() {
  const { data: config, isLoading } = useConfig();
  const update = useUpdateConfig();

  const { register, handleSubmit, control, reset, formState: { errors, isDirty, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { metodoCalculo: 'MEDIANA', limiteOutlierPercentual: 30, minFontesCompleta: 3 },
  });

  useEffect(() => {
    if (!config) return;
    const smtp = config.smtpConfig as Record<string, unknown> | null ?? {};
    const suporte = config.canalSuporte as Record<string, unknown> | null ?? {};
    reset({
      municipio: config.municipio ?? '',
      uf: config.uf ?? '',
      responsavelTecnico: config.responsavelTecnico ?? '',
      metodoCalculo: config.metodoCalculo,
      limiteOutlierPercentual: config.limiteOutlierPercentual,
      minFontesCompleta: config.minFontesCompleta,
      smtpHost: (smtp.host as string) ?? '',
      smtpPort: (smtp.port as number) ?? 587,
      smtpUser: (smtp.user as string) ?? '',
      smtpFrom: (smtp.from as string) ?? '',
      suporteEmail: (suporte.email as string) ?? '',
      suporteWhatsapp: (suporte.whatsapp as string) ?? '',
    });
  }, [config, reset]);

  async function onSubmit(values: Form) {
    try {
      await update.mutateAsync({
        municipio: values.municipio,
        uf: values.uf,
        responsavelTecnico: values.responsavelTecnico,
        metodoCalculo: values.metodoCalculo,
        limiteOutlierPercentual: values.limiteOutlierPercentual,
        minFontesCompleta: values.minFontesCompleta,
        smtpConfig: {
          host: values.smtpHost,
          port: values.smtpPort,
          user: values.smtpUser,
          from: values.smtpFrom,
        },
        canalSuporte: {
          email: values.suporteEmail,
          whatsapp: values.suporteWhatsapp,
        },
      });
      toast.success('Configurações salvas');
      reset(values);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        {[0, 1, 2].map((i) => <div key={i} className="card animate-pulse h-40" />)}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Configurações</h2>
          <p className="text-sm text-zinc-500 mt-0.5">Parâmetros globais do sistema</p>
        </div>
        <button type="submit" disabled={!isDirty || isSubmitting} className="btn-primary gap-2">
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar
        </button>
      </div>

      {/* Geral */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Section icon={Globe} title="Identificação do órgão">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="label">Município</label>
              <input {...register('municipio')} className="input" placeholder="Nome do município" />
            </div>
            <div>
              <label className="label">UF</label>
              <input {...register('uf')} className="input" placeholder="SP" maxLength={2} />
            </div>
          </div>
          <div>
            <label className="label">Responsável técnico</label>
            <input {...register('responsavelTecnico')} className="input" placeholder="Nome do servidor responsável" />
          </div>
        </Section>
      </motion.div>

      {/* Cálculo */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <Section icon={Calculator} title="Metodologia de cálculo">
          <div>
            <label className="label">Método padrão (Art. 23, Lei 14.133/2021)</label>
            <Controller
              name="metodoCalculo"
              control={control}
              render={({ field }) => (
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {METODOS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => field.onChange(m.value)}
                      className={`rounded-xl border-2 p-3 text-left transition-all ${
                        field.value === m.value
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'
                      }`}
                    >
                      <p className={`text-xs font-semibold ${field.value === m.value ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-700 dark:text-zinc-300'}`}>{m.label}</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5 leading-tight">{m.desc}</p>
                    </button>
                  ))}
                </div>
              )}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Limite outlier (%)</label>
              <input
                {...register('limiteOutlierPercentual')}
                type="number"
                min={0}
                max={100}
                className="input"
                placeholder="30"
              />
              {errors.limiteOutlierPercentual && (
                <p className="mt-1 text-xs text-red-500">{errors.limiteOutlierPercentual.message}</p>
              )}
              <p className="text-[10px] text-zinc-400 mt-1">Preços acima deste % da mediana são descartados</p>
            </div>
            <div>
              <label className="label">Fontes mín. para cobertura</label>
              <input
                {...register('minFontesCompleta')}
                type="number"
                min={1}
                max={10}
                className="input"
                placeholder="3"
              />
              {errors.minFontesCompleta && (
                <p className="mt-1 text-xs text-red-500">{errors.minFontesCompleta.message}</p>
              )}
              <p className="text-[10px] text-zinc-400 mt-1">Mínimo de fontes para item ser considerado completo</p>
            </div>
          </div>
        </Section>
      </motion.div>

      {/* E-mail */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Section icon={Mail} title="Configuração de e-mail (SMTP)">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="label">Host SMTP</label>
              <input {...register('smtpHost')} className="input" placeholder="smtp.municipio.gov.br" />
            </div>
            <div>
              <label className="label">Porta</label>
              <input {...register('smtpPort')} type="number" className="input" placeholder="587" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Usuário</label>
              <input {...register('smtpUser')} className="input" placeholder="noreply@municipio.gov.br" />
            </div>
            <div>
              <label className="label">Remetente (From)</label>
              <input {...register('smtpFrom')} className="input" placeholder="LicitaPreço &lt;noreply@…&gt;" />
            </div>
          </div>
        </Section>
      </motion.div>

      {/* Suporte */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <Section icon={HelpCircle} title="Canal de suporte">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">E-mail de suporte</label>
              <input {...register('suporteEmail')} type="email" className="input" placeholder="suporte@municipio.gov.br" />
            </div>
            <div>
              <label className="label">WhatsApp</label>
              <input {...register('suporteWhatsapp')} className="input" placeholder="+55 (00) 90000-0000" />
            </div>
          </div>
        </Section>
      </motion.div>

      <div className="flex justify-end pb-8">
        <button type="submit" disabled={!isDirty || isSubmitting} className="btn-primary gap-2 px-8">
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar configurações
        </button>
      </div>
    </form>
  );
}
