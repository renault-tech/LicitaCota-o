import type { FonteCotacao } from '@prisma/client';
import type { ItemNormalizado, ResultadoConsultaFonte, TesteResultado } from '@licitapreco/shared';

/**
 * Contrato comum dos adapters de fonte. Cada tipo de fonte (API_REST,
 * SCRAPING, TABELA_REFERENCIA) implementa esta interface; o comportamento é
 * dirigido pela configuração da FonteCotacao, não por código específico.
 *
 * `consultar` devolve TODOS os pontos de preço distintos que a fonte
 * encontrou para o item (não apenas um agregado): cada ponto vira sua
 * própria cotação persistida, entrando individualmente no cálculo do preço
 * de referência. Isso é o que permite que uma única fonte (ex.: PNCP)
 * satisfaça, por si só, o mínimo de cotações de fontes distintas exigido
 * pelo art. 23 da Lei 14.133/2021 quando encontra vários contratos
 * comparáveis — em vez de pré-calcular uma média que esconde a dispersão
 * real dos preços do próprios cálculo de outliers.
 */
export interface FonteAdapter {
  slug: string;
  consultar(item: ItemNormalizado, config: FonteCotacao): Promise<ResultadoConsultaFonte>;
  testar(config: FonteCotacao, itemAmostra: string): Promise<TesteResultado>;
}

export type { ItemNormalizado, ResultadoConsultaFonte, TesteResultado };
