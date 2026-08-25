import { describe, it, expect } from 'vitest';
import { selecionarFornecedores } from '../fornecedorMatch.service.js';
import type { Fornecedor } from '@prisma/client';

function fornecedor(over: Partial<Fornecedor>): Fornecedor {
  return {
    id: over.id ?? 'id',
    razaoSocial: over.razaoSocial ?? 'Empresa Ltda',
    nomeFantasia: over.nomeFantasia ?? null,
    cnpj: over.cnpj ?? '00000000000000',
    contatoNome: over.contatoNome ?? null,
    email: over.email ?? 'contato@empresa.com',
    telefone: over.telefone ?? null,
    endereco: over.endereco ?? null,
    municipio: over.municipio ?? null,
    uf: over.uf ?? null,
    categorias: over.categorias ?? [],
    ativo: over.ativo ?? true,
    createdAt: over.createdAt ?? new Date(),
    updatedAt: over.updatedAt ?? new Date(),
  };
}

describe('selecionarFornecedores', () => {
  it('prioriza fornecedores cuja categoria casa com a descrição do item', () => {
    const fornecedores = [
      fornecedor({ id: 'a', categorias: ['material de escritorio'] }),
      fornecedor({ id: 'b', categorias: ['informatica'] }),
      fornecedor({ id: 'c', categorias: ['limpeza e higiene'] }),
      fornecedor({ id: 'd', categorias: [] }),
    ];
    const selecionados = selecionarFornecedores(fornecedores, 'caneta esferografica azul material escritorio', 1);
    expect(selecionados[0].id).toBe('a');
  });

  it('completa com fornecedores sem categoria quando não há combinações suficientes', () => {
    const fornecedores = [
      fornecedor({ id: 'a', categorias: ['material de escritorio'] }),
      fornecedor({ id: 'b', categorias: [] }),
      fornecedor({ id: 'c', categorias: [] }),
    ];
    const selecionados = selecionarFornecedores(fornecedores, 'caneta esferografica azul material escritorio', 3);
    expect(selecionados).toHaveLength(3);
    expect(selecionados.map((f) => f.id)).toContain('a');
  });

  it('sem nenhum fornecedor categorizado, ainda seleciona até o mínimo (degrade gracioso)', () => {
    const fornecedores = [fornecedor({ id: 'a' }), fornecedor({ id: 'b' }), fornecedor({ id: 'c' })];
    const selecionados = selecionarFornecedores(fornecedores, 'qualquer coisa', 2);
    expect(selecionados).toHaveLength(2);
  });

  it('respeita o mínimo mesmo com poucos fornecedores disponíveis', () => {
    const fornecedores = [fornecedor({ id: 'a' })];
    const selecionados = selecionarFornecedores(fornecedores, 'qualquer coisa', 3);
    expect(selecionados).toHaveLength(1);
  });
});
