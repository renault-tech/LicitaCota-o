import type { ItemNormalizado } from '@licitapreco/shared';
import {
  resolverCandidatosCatalogo,
  resolverCandidatosCatalogoComFallback,
  type CodigoCatalogoResolvido,
} from '../catalogo/catalogoMatch.service.js';
import { textosParaCatalogo } from './normalizacao.service.js';

export type TipoCatalogo = 'MATERIAL' | 'SERVICO';

export interface ItemResolvido {
  rota: TipoCatalogo;
  candidatos: CodigoCatalogoResolvido[];
  /** Texto que casou com o catálogo — reutilizado para filtrar linhas de
   * preço por descrição com o mesmo critério. */
  texto: string;
}

async function escolherCatalogo(descricao: string): Promise<{ rota: TipoCatalogo; candidatos: CodigoCatalogoResolvido[] }> {
  const [materiais, servicos] = await Promise.all([
    resolverCandidatosCatalogoComFallback(descricao, 'MATERIAL'),
    resolverCandidatosCatalogo(descricao, 'SERVICO'),
  ]);
  const melhorMaterial = materiais[0]?.score ?? 0;
  const melhorServico = servicos[0]?.score ?? 0;
  // Serviço só ganha com margem clara — descrições de material costumam
  // ter alguma sobreposição com nomes de serviço ("manutenção de X").
  if (servicos.length > 0 && melhorServico > melhorMaterial + 0.1) {
    return { rota: 'SERVICO', candidatos: servicos };
  }
  return { rota: 'MATERIAL', candidatos: materiais };
}

/**
 * Resolve o item para códigos CATMAT/CATSER, do texto mais completo ao
 * núcleo ("caneta esferografica"), parando no primeiro que casar. Memoizado
 * por item — as fontes que buscam por código (Painel de Preços, Atas)
 * consultam em paralelo e não devem repetir a mesma busca no catálogo.
 */
const cache = new WeakMap<ItemNormalizado, Promise<ItemResolvido>>();

export function resolverItemNoCatalogo(item: ItemNormalizado): Promise<ItemResolvido> {
  const existente = cache.get(item);
  if (existente) return existente;
  const promessa = (async () => {
    const textos = textosParaCatalogo(item.nome, item.descricao);
    if (textos.length === 0) textos.push(item.descricaoNormalizada);
    for (const texto of textos) {
      const r = await escolherCatalogo(texto);
      if (r.candidatos.length > 0) return { ...r, texto };
    }
    return { rota: 'MATERIAL' as const, candidatos: [], texto: textos[0] };
  })();
  cache.set(item, promessa);
  promessa.catch(() => cache.delete(item));
  return promessa;
}
