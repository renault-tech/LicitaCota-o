import { PrismaClient } from '@prisma/client';
import {
  FonteSlug,
  FUNDAMENTACAO_ARTIGO,
  TEXTOS_LEGAIS,
} from '@licitapreco/shared';

const prisma = new PrismaClient();

/**
 * Seed do banco: configuração singleton, fontes oficiais, dicionário de
 * sinônimos e artigos de ajuda essenciais.
 *
 * As fontes são semeadas como INATIVAS / NAO_TESTADA: conforme a regra do
 * motor de cotação, nenhuma fonte entra no fluxo sem passar no auto-teste.
 * O administrador testa e ativa cada uma no primeiro acesso (onboarding).
 */

async function seedConfiguracao(): Promise<void> {
  await prisma.configuracaoSistema.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      municipio: null,
      uf: null,
      metodoCalculo: 'MEDIA',
      limiteOutlierPercentual: 30,
      minFontesCompleta: 2,
      itemAmostraTeste: 'caneta esferográfica azul',
      textosFundamentacao: { ...TEXTOS_LEGAIS },
      canalSuporte: { email: 'suporte@licitapreco.local', url: '' },
    },
  });
}

async function seedFontes(): Promise<void> {
  const fontes = [
    {
      slug: FonteSlug.COMPRAS_GOV,
      nome: 'Compras.gov.br',
      tipo: 'API_REST' as const,
      ordem: 1,
      endpointBase:
        'https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial',
      metodoHttp: 'GET',
      parametrosTemplate: { pagina: '1', tamanhoPagina: '10', descricao: '{descricaoItem}' },
      headers: {},
      mapeamentoCampos: {
        listaResultados: 'resultado',
        preco: ['valorUnitario', 'precoUnitario'],
        referencia: ['idCompra', 'descricao'],
      },
      fundamentacaoArtigo: FUNDAMENTACAO_ARTIGO.comprasGov,
      limiteResultados: 5,
    },
    {
      slug: FonteSlug.PNCP,
      nome: 'PNCP',
      tipo: 'API_REST' as const,
      ordem: 2,
      endpointBase: 'https://pncp.gov.br/api/pncp/v1/contratacoes/publicacoes',
      metodoHttp: 'GET',
      parametrosTemplate: { q: '{descricaoItem}', pagina: '1', tamanhoPagina: '10' },
      headers: {},
      mapeamentoCampos: {
        listaResultados: 'data',
        preco: ['valorTotalEstimado', 'valorUnitarioEstimado'],
        referencia: ['numeroControlePNCP'],
      },
      fundamentacaoArtigo: FUNDAMENTACAO_ARTIGO.pncp,
      limiteResultados: 5,
    },
    {
      slug: FonteSlug.MERCADO_PUBLICO,
      nome: 'Mercado Público',
      tipo: 'SCRAPING' as const,
      ordem: 3,
      endpointBase: 'https://www.mercadopublico.com.br/busca?q={descricaoItem}',
      metodoHttp: 'GET',
      parametrosTemplate: {},
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LicitaPrecoBot/1.0)' },
      mapeamentoCampos: {},
      regexValor: 'R\\$\\s?\\d{1,3}(?:\\.\\d{3})*,\\d{2}',
      fundamentacaoArtigo: FUNDAMENTACAO_ARTIGO.mercadoPublico,
      limiteResultados: 10,
    },
  ];

  for (const f of fontes) {
    await prisma.fonteCotacao.upsert({
      where: { slug: f.slug },
      update: {},
      create: {
        ...f,
        ativo: false,
        statusValidacao: 'NAO_TESTADA',
        timeoutMs: 15000,
        pausaMs: 1200,
        retries: 2,
      },
    });
  }
}

async function seedDicionario(): Promise<void> {
  const termos = [
    { termo: 'caneta esferografica', sinonimos: ['caneta', 'esferografica'], expansoes: ['azul', 'unidade'] },
    { termo: 'papel a4', sinonimos: ['papel sulfite', 'sulfite a4'], expansoes: ['75g', 'resma', '500 folhas'] },
    { termo: 'cadeira escritorio', sinonimos: ['cadeira giratoria', 'poltrona escritorio'], expansoes: ['ergonomica'] },
    { termo: 'computador', sinonimos: ['desktop', 'microcomputador', 'pc'], expansoes: [] },
    { termo: 'notebook', sinonimos: ['laptop', 'computador portatil'], expansoes: [] },
    { termo: 'detergente', sinonimos: ['detergente liquido'], expansoes: ['neutro', '500ml'] },
    { termo: 'agua sanitaria', sinonimos: ['alvejante', 'cloro'], expansoes: ['1 litro'] },
    { termo: 'cartucho impressora', sinonimos: ['toner', 'cartucho tinta'], expansoes: [] },
    { termo: 'pneu', sinonimos: ['pneumatico'], expansoes: [] },
    { termo: 'medicamento', sinonimos: ['remedio', 'farmaco'], expansoes: [] },
  ];
  for (const t of termos) {
    await prisma.dicionarioSinonimo.upsert({
      where: { termo: t.termo },
      update: {},
      create: { termo: t.termo, sinonimos: t.sinonimos, expansoes: t.expansoes, ativo: true },
    });
  }
}

async function seedAjuda(): Promise<void> {
  const artigos = [
    {
      categoria: 'Primeiros passos',
      slug: 'primeiros-passos',
      titulo: 'Primeiros passos no LicitaPreço',
      ordem: 1,
      conteudoMarkdown: `# Primeiros passos\n\nBem-vindo ao **LicitaPreço**. Este sistema automatiza a pesquisa de preços para licitações conforme a Lei 14.133/2021 e a IN SEGES/ME 65/2021.\n\n## Roteiro inicial (administrador)\n\n1. Preencha os **dados do município** em Configurações.\n2. Em **Fontes**, teste e ative ao menos uma fonte de cotação.\n3. Cadastre os **usuários operadores** que farão as pesquisas.\n\n## Roteiro do operador\n\n1. Acesse **Nova pesquisa**.\n2. Envie a planilha de itens ou cole a lista.\n3. Confira o mapeamento de colunas e confirme.\n4. Acompanhe o processamento e baixe a planilha pronta.`,
    },
    {
      categoria: 'Como fazer uma pesquisa',
      slug: 'como-fazer-pesquisa',
      titulo: 'Como fazer uma pesquisa de preços',
      ordem: 2,
      conteudoMarkdown: `# Como fazer uma pesquisa\n\nVocê pode iniciar uma pesquisa de duas formas:\n\n- **Upload de planilha** (.xlsx): arraste o arquivo para a área indicada.\n- **Colagem de lista**: copie as células da sua planilha e cole diretamente.\n\nO sistema detecta as colunas automaticamente. Confira o **preview do mapeamento** antes de confirmar. Apenas *Nome/Descrição* e *Quantidade* são obrigatórios; as demais colunas são preservadas na saída.`,
    },
    {
      categoria: 'Entendendo a planilha',
      slug: 'entendendo-a-planilha',
      titulo: 'Entendendo a planilha gerada',
      ordem: 3,
      conteudoMarkdown: `# Entendendo a planilha gerada\n\nA planilha de saída tem duas abas:\n\n- **Banco de Preços**: suas colunas originais + uma coluna de cotação e referência por fonte consultada + preço de referência, total, status e fundamentação.\n- **Metodologia**: documento formal para juntar ao processo, com as fontes, o método de cálculo e a fundamentação legal.\n\nA linha de **cobertura auditável** registra quantos itens foram processados, cotados, sem resultado e com erro.`,
    },
    {
      categoria: 'Fundamentação legal',
      slug: 'fundamentacao-legal',
      titulo: 'Fundamentação legal da pesquisa',
      ordem: 4,
      conteudoMarkdown: `# Fundamentação legal\n\nA pesquisa observa:\n\n- **Lei Federal nº 14.133/2021**, art. 23.\n- **IN SEGES/ME nº 65/2021**, especialmente o art. 5º (fontes) e o art. 7º (cálculo).\n\n${TEXTOS_LEGAIS.cabecalhoPesquisa}`,
    },
    {
      categoria: 'Gestão de fontes',
      slug: 'gestao-de-fontes',
      titulo: 'Gestão de fontes de cotação',
      ordem: 5,
      conteudoMarkdown: `# Gestão de fontes\n\nFontes são plugáveis: o administrador adiciona novas fontes apenas por configuração.\n\n**Regra de ouro:** nenhuma fonte entra no fluxo sem passar no **auto-teste**. Use o botão *Testar fonte* — ele consulta o item de amostra e verifica se um valor numérico válido foi extraído. Só fontes **VÁLIDAS** podem ser ativadas.`,
    },
    {
      categoria: 'FAQ',
      slug: 'faq',
      titulo: 'Perguntas frequentes',
      ordem: 6,
      conteudoMarkdown: `# Perguntas frequentes\n\n**Posso fechar a aba durante o processamento?**\nSim. O processamento continua no servidor e você recebe um e-mail ao concluir.\n\n**E se um item não retornar em nenhuma fonte?**\nEle é marcado como *Pesquisa manual necessária* e você pode usar a **Cotação direta** com fornecedores.\n\n**Quantas fontes preciso para a pesquisa ser completa?**\nO mínimo é configurável (padrão: 2 fontes com preço).`,
    },
  ];

  for (const a of artigos) {
    await prisma.artigoAjuda.upsert({
      where: { slug: a.slug },
      update: {},
      create: { ...a, publicado: true },
    });
  }
}

async function main(): Promise<void> {
  await seedConfiguracao();
  await seedFontes();
  await seedDicionario();
  await seedAjuda();
  // eslint-disable-next-line no-console
  console.log('Seed concluído: configuração, fontes, dicionário e ajuda.');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('Erro no seed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
