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

const ITENS: Array<[string, string]> = [
  ['Agulhas de costura de mão grande, caixa c/ 50 unidades', 'CX'],
  ['Agulhas de costura tamanhos variados, caixa c/ 50 unidades', 'CX'],
  ['Agulhas de crochê numerações variadas', 'UN'],
  ['Acetona removedor de esmaltes 500ml', 'UN'],
  ['Algodão hidrófilo em rolo 500g', 'RL'],
  ['Caneta esferográfica azul', 'UN'],
  ['Papel sulfite A4 75g resma 500 folhas', 'RESMA'],
  ['Grampeador de mesa', 'UN'],
  ['Copo descartável 200ml pacote com 100 unidades', 'PCT'],
  ['Detergente líquido neutro 500ml', 'UN'],
  ['Serviço de limpeza e conservação predial', 'MES'],
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

  // Mesma concorrência do worker (5 itens simultâneos), para exercitar o
  // limite de requisições do Compras.gov.br como em produção.
  const saidas: string[] = new Array(ITENS.length);
  let comPreco = 0;
  let proximo = 0;
  const inicioGeral = Date.now();
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (proximo < ITENS.length) {
      const idx = proximo++;
      const [texto, unidadeMedida] = ITENS[idx];
      const item = { ...montarItemNormalizado({ nome: texto, descricao: texto, quantidade: 1, unidadeMedida, uf: 'MG' }, []) };
      const inicio = Date.now();
      const resolvido = await resolverItemNoCatalogo(item);
      const [cg, atas] = await Promise.all([
        comprasGovAdapter.consultar(item, config),
        pncpAtasAdapter.consultar(item, config),
      ]);
      if (cg.pontos.length + atas.pontos.length > 0) comPreco++;
      const l: string[] = [];
      l.push(`\n### ${texto} [${unidadeMedida}]  (${Date.now() - inicio}ms)`);
      l.push(`  catálogo (${resolvido.rota}, texto "${resolvido.texto}"): ${resolvido.candidatos.slice(0, 3).map((c) => `${c.codigo} "${c.descricaoCatalogo.slice(0, 70)}" ${c.score.toFixed(2)}`).join(' | ') || 'nenhum'}`);
      l.push(`  Painel de Preços: ${cg.pontos.length} preço(s)${cg.erro ? ` ERRO ${cg.erro}` : ''}${cg.diagnostico ? ` — ${cg.diagnostico}` : ''}`);
      for (const p of cg.pontos) l.push(`    R$ ${p.preco.toFixed(2)}  ${(p.dadosBrutos as { descricaoItem?: string }).descricaoItem?.slice(0, 60)}  | ${p.referencia.slice(0, 160)}`);
      l.push(`  Atas PNCP: ${atas.pontos.length} preço(s)${atas.erro ? ` ERRO ${atas.erro}` : ''}${atas.diagnostico ? ` — ${atas.diagnostico}` : ''}`);
      for (const p of atas.pontos) l.push(`    R$ ${p.preco.toFixed(2)}  ${(p.dadosBrutos as { descricaoItem?: string }).descricaoItem?.slice(0, 60)}  | ${p.referencia.slice(0, 160)}`);
      saidas[idx] = l.join('\n');
    }
  }));
  for (const s of saidas) console.log(s);
  console.log(`\nTempo total: ${Math.round((Date.now() - inicioGeral) / 1000)}s`);
  console.log(`\nRESUMO: ${comPreco}/${ITENS.length} itens com preço.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
