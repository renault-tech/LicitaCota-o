import { describe, it, expect } from 'vitest';
import {
  mediana,
  media,
  descartarOutliers,
  calcularPrecoReferencia,
  variacaoPercentual,
} from '../calculo.js';

describe('mediana e média', () => {
  it('mediana de lista ímpar', () => expect(mediana([3, 1, 2])).toBe(2));
  it('mediana de lista par', () => expect(mediana([1, 2, 3, 4])).toBe(2.5));
  it('média simples', () => expect(media([2, 4])).toBe(3));
  it('lista vazia devolve 0', () => {
    expect(mediana([])).toBe(0);
    expect(media([])).toBe(0);
  });
});

describe('descartarOutliers', () => {
  it('não descarta nada com 2 ou menos preços (amostra pequena)', () => {
    expect(descartarOutliers([10, 1000], 30)).toEqual({ mantidos: [10, 1000], descartados: [] });
  });

  it('descarta preço acima do limite percentual da mediana', () => {
    const r = descartarOutliers([10, 11, 100], 30);
    expect(r.mantidos).toEqual([10, 11]);
    expect(r.descartados).toEqual([100]);
  });

  it('ignora valores não positivos', () => {
    expect(descartarOutliers([10, 11, 12, 0, -5], 30).mantidos).toEqual([10, 11, 12]);
  });

  it('descarta os extremos mantendo o preço central', () => {
    const r = descartarOutliers([1, 100, 10000], 30);
    expect(r.mantidos).toEqual([100]);
    expect(r.descartados).toEqual([1, 10000]);
  });

  it('mantém os originais quando a dispersão descartaria todos os preços', () => {
    // Mediana entre dois grupos distantes: nenhum preço fica dentro do limite.
    const r = descartarOutliers([1, 1, 1000, 1000], 30);
    expect(r.descartados).toEqual([]);
    expect(r.mantidos).toEqual([1, 1, 1000, 1000]);
  });
});

describe('calcularPrecoReferencia', () => {
  const base = { limiteOutlierPercentual: 30, minFontes: 3 };

  it('sem preços válidos devolve null e incompleta', () => {
    const r = calcularPrecoReferencia([null, undefined, 0, -1], { ...base, metodo: 'MEDIA' });
    expect(r.precoReferencia).toBeNull();
    expect(r.completa).toBe(false);
    expect(r.fontesComPreco).toBe(0);
  });

  it('aplica a média sobre os preços mantidos', () => {
    const r = calcularPrecoReferencia([10, 12, 100], { ...base, metodo: 'MEDIA' });
    expect(r.precosDescartados).toEqual([100]);
    expect(r.precoReferencia).toBe(11);
  });

  it('aplica mediana e menor preço', () => {
    expect(calcularPrecoReferencia([10, 11, 12], { ...base, metodo: 'MEDIANA' }).precoReferencia).toBe(11);
    expect(calcularPrecoReferencia([10, 11, 12], { ...base, metodo: 'MENOR_PRECO' }).precoReferencia).toBe(10);
  });

  it('marca completa somente com o mínimo de preços exigido', () => {
    expect(calcularPrecoReferencia([10, 11], { ...base, metodo: 'MEDIA' }).completa).toBe(false);
    expect(calcularPrecoReferencia([10, 11, 12], { ...base, metodo: 'MEDIA' }).completa).toBe(true);
  });

  it('conta os preços válidos antes do descarte', () => {
    const r = calcularPrecoReferencia([10, 11, 100], { ...base, metodo: 'MEDIA' });
    expect(r.fontesComPreco).toBe(3);
  });
});

describe('variacaoPercentual', () => {
  it('calcula a variação absoluta em percentual', () =>
    expect(variacaoPercentual(100, 130)).toBe(30));
  it('devolve 0 quando o preço anterior é inválido', () =>
    expect(variacaoPercentual(0, 50)).toBe(0));
});
