/**
 * Teste ponta a ponta das fontes automáticas contra as APIs reais e o
 * catálogo oficial completo. Uso (com DATABASE_URL apontando para um banco
 * descartável): `tsx src/scripts/e2e-fontes.ts`.
 */
import type { FonteCotacao } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { importarCatalogoAutomatico } from '../services/catalogo/catalogoImport.service.js';
import { garantirIndiceTrigram } from '../services/catalogo/catalogoSync.service.js';
import { montarItemNormalizado } from '../services/cotacao/normalizacao.service.js';
import { comprasGovAdapter } from '../services/cotacao/comprasGov.adapter.js';
import { pncpAtasAdapter } from '../services/cotacao/pncpAtas.adapter.js';
import { resolverItemNoCatalogo } from '../services/cotacao/resolucaoCatalogo.js';

const ITENS = [
  'Agulhas de costura de mão grande, caixa c/ 50 unidades',
  'Agulhas de costura tamanhos variados, caixa c/ 50 unidades',
  'Agulhas de crochê numerações variadas',
  'Acetona removedor de esmaltes 500ml',
  'Algodão hidrófilo em rolo 500g',
  'Caneta esferográfica azul',
  'Papel sulfite A4 75g resma 500 folhas',
  'Grampeador de mesa',
  'Copo descartável 200ml pacote com 100 unidades',
  'Detergente líquido neutro 500ml',
  'Serviço de limpeza e conservação predial',
];

const config = { limiteResultados: 5, fundamentacaoArtigo: '' } as unknown as FonteCotacao;

async function main(): Promise<void> {
  if ((await prisma.catalogoOficialItem.count()) === 0) {
    console.log('Importando CATMAT...');
    console.log('  materiais:', await importarCatalogoAutomatico('MATERIAL'));
    console.log('Importando CATSER...');
    console.log('  serviços:', await importarCatalogoAutomatico('SERVICO'));
  }
  await garantirIndiceTrigram();

  let comPreco = 0;
  for (const texto of ITENS) {
    const item = { ...montarItemNormalizado({ nome: texto, descricao: texto, quantidade: 1, unidadeMedida: 'UN', uf: 'MG' }, []) };
    const inicio = Date.now();
    const resolvido = await resolverItemNoCatalogo(item);
    const [cg, atas] = await Promise.all([
      comprasGovAdapter.consultar(item, config),
      pncpAtasAdapter.consultar(item, config),
    ]);
    const precos = [...cg.pontos, ...atas.pontos];
    if (precos.length > 0) comPreco++;
    console.log(`\n### ${texto}  (${Date.now() - inicio}ms)`);
    console.log(`  catálogo (${resolvido.rota}, texto "${resolvido.texto}"): ${resolvido.candidatos.slice(0, 3).map((c) => `${c.codigo} "${c.descricaoCatalogo.slice(0, 70)}" ${c.score.toFixed(2)}`).join(' | ') || 'nenhum'}`);
    console.log(`  Painel de Preços: ${cg.pontos.length} preço(s)${cg.erro ? ` ERRO ${cg.erro}` : ''}${cg.diagnostico ? ` — ${cg.diagnostico}` : ''}`);
    for (const p of cg.pontos) console.log(`    R$ ${p.preco.toFixed(2)}  ${(p.dadosBrutos as { descricaoItem?: string }).descricaoItem?.slice(0, 60)}  | ${p.referencia.slice(0, 150)}`);
    console.log(`  Atas PNCP: ${atas.pontos.length} preço(s)${atas.erro ? ` ERRO ${atas.erro}` : ''}${atas.diagnostico ? ` — ${atas.diagnostico}` : ''}`);
    for (const p of atas.pontos) console.log(`    R$ ${p.preco.toFixed(2)}  ${(p.dadosBrutos as { descricaoItem?: string }).descricaoItem?.slice(0, 60)}  | ${p.referencia.slice(0, 150)}`);
  }
  console.log(`\nRESUMO: ${comPreco}/${ITENS.length} itens com preço.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
