import type { ItemNormalizado } from '@licitapreco/shared';
import {
  resolverCandidatosCatalogo,
  resolverCandidatosCatalogoComFallback,
  type CodigoCatalogoResolvido,
} from '../catalogo/catalogoMatch.service.js';
import { textosParaCatalogo } from './normalizacao.service.js';
import { tokensSignificativos } from '../../utils/matching.js';

export type TipoCatalogo = 'MATERIAL' | 'SERVICO';

export interface ItemResolvido {
  rota: TipoCatalogo;
  candidatos: CodigoCatalogoResolvido[];
  /** Texto que casou com o catálogo — reutilizado para filtrar linhas de
   * preço por descrição com o mesmo critério. */
  texto: string;
}

/**
 * Em descrições de compra o primeiro termo é o objeto ("acetona ...",
 * "caneta ...", "serviço de ..."), e o catálogo oficial também começa pelo
 * nome do item. Exigir esse termo no candidato evita o falso positivo mais
 * perigoso visto com dado real: "acetona removedor de esmaltes" casando com
 * "REMOVEDOR" genérico (removedor de solda) só por compartilhar "removedor".
 * Sem candidato com o núcleo, o item fica sem preço — melhor que preço de
 * outro produto.
 */
export function contemNucleo(textoItem: string, descricaoCandidata: string): boolean {
  const nucleo = tokensSignificativos(textoItem)[0];
  if (!nucleo) return true;
  return tokensSignificativos(descricaoCandidata).includes(nucleo);
}

async function escolherCatalogo(descricao: string): Promise<{ rota: TipoCatalogo; candidatos: CodigoCatalogoResolvido[] }> {
  const [todosMateriais, todosServicos] = await Promise.all([
    resolverCandidatosCatalogoComFallback(descricao, 'MATERIAL'),
    resolverCandidatosCatalogo(descricao, 'SERVICO'),
  ]);
  // O fallback externo (catmat.com.br, score -1) já é uma sugestão por
  // nome de produto; não passa pelo filtro de núcleo.
  const materiais = todosMateriais.filter((c) => c.origem !== 'LOCAL' || contemNucleo(descricao, c.descricaoCatalogo));
  const servicos = todosServicos.filter((c) => contemNucleo(descricao, c.descricaoCatalogo));
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
