import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, ResultadoCotacao, TesteResultado } from '@licitapreco/shared';

/**
 * Contrato comum dos adapters de fonte. Cada tipo de fonte (API_REST,
 * SCRAPING, TABELA_REFERENCIA) implementa esta interface; o comportamento é
 * dirigido pela configuração da FonteCotacao, não por código específico.
 */
export interface FonteAdapter {
  slug: string;
  consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoCotacao>;
  testar(config: FonteCotacao, itemAmostra: string): Promise<TesteResultado>;
}

export type { ItemNormalizado, ResultadoCotacao, TesteResultado };
