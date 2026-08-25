import { describe, it, expect } from 'vitest';
import { pontuarCorrespondencia, melhorCorrespondencia } from '../matching.js';

describe('pontuarCorrespondencia', () => {
  it('pontua alto quando todos os termos aparecem', () => {
    expect(pontuarCorrespondencia('caneta azul', 'caneta esferografica azul 1.0mm')).toBeGreaterThan(0.9);
  });

  it('pontua baixo quando os termos não têm relação', () => {
    expect(pontuarCorrespondencia('caneta azul', 'cadeira de escritorio giratoria')).toBeLessThan(0.3);
  });

  it('dá peso maior a tokens numéricos (medidas discriminam itens parecidos)', () => {
    const scoreComMedida = pontuarCorrespondencia('caneta azul 1.0mm', 'caneta azul 1.0mm ponta fina');
    const scoreSemMedida = pontuarCorrespondencia('caneta azul 1.0mm', 'caneta azul 0.5mm ponta fina');
    expect(scoreComMedida).toBeGreaterThan(scoreSemMedida);
  });

  it('busca vazia (só stopwords) pontua 0', () => {
    expect(pontuarCorrespondencia('de para com', 'qualquer coisa')).toBe(0);
  });
});

describe('melhorCorrespondencia', () => {
  interface Item { desc: string; preco: number; }
  const candidatos: Item[] = [
    { desc: 'caneta esferografica azul 1.0mm', preco: 2 },
    { desc: 'lapis grafite hb', preco: 1 },
    { desc: 'caneta esferografica preta 0.7mm', preco: 3 },
  ];

  it('escolhe o candidato com maior pontuação acima do limiar', () => {
    const r = melhorCorrespondencia('caneta azul', candidatos, (c) => c.desc);
    expect(r?.item.preco).toBe(2);
  });

  it('devolve null quando nenhum candidato atinge o limiar', () => {
    const r = melhorCorrespondencia('mesa de reuniao grande', candidatos, (c) => c.desc);
    expect(r).toBeNull();
  });

  it('lista vazia devolve null', () => {
    expect(melhorCorrespondencia('caneta azul', [], (c: Item) => c.desc)).toBeNull();
  });
});
