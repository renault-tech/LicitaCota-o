/**
 * Conteúdo legal fixo (Lei 14.133/2021 + IN SEGES/ME 65/2021).
 * Usado literalmente na planilha gerada e nos textos padrão do sistema.
 * Os textos de fundamentação são editáveis via ConfiguracaoSistema.textosFundamentacao,
 * tendo estes valores como defaults restauráveis.
 */

export const TEXTOS_LEGAIS = {
  cabecalhoPesquisa:
    'A presente pesquisa de preços foi realizada em conformidade com o art. 23 da Lei Federal nº 14.133, de 1º de abril de 2021, e com a Instrução Normativa SEGES/ME nº 65, de 7 de julho de 2021, que disciplina os procedimentos para a realização de pesquisa de preços para a aquisição de bens e contratação de serviços em geral.',
  criterioCalculo:
    'O preço de referência foi obtido pela média aritmética simples dos preços coletados nas fontes consultadas, em consonância com o art. 7º da IN SEGES/ME 65/2021. Foram desconsiderados valores que não refletissem condições de mercado ou que apresentassem variação superior a 30% em relação aos demais preços pesquisados.',
  fonteComprasGov:
    'Preços praticados no âmbito da Administração Pública Federal nos últimos 12 (doze) meses, extraídos do sistema Compras.gov.br, nos termos do art. 5º, inciso I, da IN SEGES/ME 65/2021.',
  fontePncp:
    'Contratações públicas registradas no Portal Nacional de Contratações Públicas (PNCP), nos termos do art. 174 da Lei 14.133/2021 e do art. 5º, inciso I, da IN SEGES/ME 65/2021.',
  fonteWeb:
    'Preços obtidos em sítios eletrônicos especializados em compras públicas, nos termos do art. 5º, incisos II e III, da IN SEGES/ME 65/2021, utilizados como referência complementar.',
  cotacaoDireta:
    'Pesquisa direta com fornecedores, mediante solicitação formal de cotação, nos termos do art. 5º, incisos II e III, da IN SEGES/ME 65/2021, observado o mínimo de 3 (três) fornecedores consultados.',
} as const;

export const FUNDAMENTACAO_ARTIGO = {
  comprasGov: 'IN SEGES/ME 65/2021, art. 5º, inciso I',
  pncp: 'Lei 14.133/2021, art. 23, § 1º; IN 65/2021, art. 5º, I',
  mercadoPublico: 'IN SEGES/ME 65/2021, art. 5º, incisos II e III',
  cotacaoDireta: 'IN SEGES/ME 65/2021, art. 5º, incisos II e III',
} as const;

export const MENSAGENS_STATUS = {
  pesquisaIncompleta: 'Pesquisa incompleta - IN 65/2021, art. 7º',
  pesquisaManualNecessaria: 'Pesquisa manual necessária - IN 65/2021, art. 5º',
} as const;
