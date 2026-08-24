-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'OPERADOR', 'VISUALIZADOR');

-- CreateEnum
CREATE TYPE "StatusPesquisa" AS ENUM ('AGUARDANDO', 'PROCESSANDO', 'CONCLUIDA', 'ERRO');

-- CreateEnum
CREATE TYPE "StatusItem" AS ENUM ('PENDENTE', 'COTADO', 'SEM_RESULTADO', 'ERRO');

-- CreateEnum
CREATE TYPE "TipoFonte" AS ENUM ('API_REST', 'SCRAPING', 'TABELA_REFERENCIA');

-- CreateEnum
CREATE TYPE "StatusValidacaoFonte" AS ENUM ('VALIDA', 'INVALIDA', 'NAO_TESTADA');

-- CreateEnum
CREATE TYPE "MetodoCalculo" AS ENUM ('MEDIA', 'MEDIANA', 'MENOR_PRECO');

-- CreateEnum
CREATE TYPE "TipoNotificacao" AS ENUM ('PESQUISA_CONCLUIDA', 'FONTE_FALHOU', 'VARIACAO_PRECO', 'SISTEMA');

-- CreateEnum
CREATE TYPE "StatusCotacaoDireta" AS ENUM ('ENVIADA', 'RESPONDIDA', 'RECUSADA');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cargo" TEXT,
    "setor" TEXT,
    "municipio" TEXT,
    "uf" TEXT,
    "role" "Role" NOT NULL DEFAULT 'OPERADOR',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "passwordHash" TEXT,
    "refreshToken" TEXT,
    "conviteToken" TEXT,
    "conviteExpiraEm" TIMESTAMP(3),
    "resetSenhaToken" TEXT,
    "resetSenhaExpiraEm" TIMESTAMP(3),
    "prefNotifEmail" BOOLEAN NOT NULL DEFAULT true,
    "prefNotifInApp" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pesquisa" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "status" "StatusPesquisa" NOT NULL DEFAULT 'AGUARDANDO',
    "userId" TEXT NOT NULL,
    "totalItens" INTEGER NOT NULL DEFAULT 0,
    "itensComCotacao" INTEGER NOT NULL DEFAULT 0,
    "itensSemCotacao" INTEGER NOT NULL DEFAULT 0,
    "itensComErro" INTEGER NOT NULL DEFAULT 0,
    "resumoCobertura" TEXT,
    "arquivoEntradaUrl" TEXT,
    "arquivoSaidaUrl" TEXT,
    "compartilhada" BOOLEAN NOT NULL DEFAULT false,
    "linkCompartilhamento" TEXT,
    "municipio" TEXT,
    "uf" TEXT,
    "fundamentacaoLegal" TEXT,
    "valorTotalEstimado" DECIMAL(18,2),
    "jobId" TEXT,
    "erroProcessamento" TEXT,
    "concluidaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pesquisa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemPesquisa" (
    "id" TEXT NOT NULL,
    "pesquisaId" TEXT NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "descricaoNormalizada" TEXT,
    "quantidade" DECIMAL(18,4) NOT NULL,
    "unidadeMedida" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "camposExtras" JSONB,
    "precoReferencia" DECIMAL(18,4),
    "precoTotal" DECIMAL(18,2),
    "statusItem" "StatusItem" NOT NULL DEFAULT 'PENDENTE',
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemPesquisa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cotacao" (
    "id" TEXT NOT NULL,
    "itemPesquisaId" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "preco" DECIMAL(18,4),
    "referencia" TEXT,
    "fundamentacaoArtigo" TEXT,
    "dataConsulta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "erro" TEXT,
    "editadaManualmente" BOOLEAN NOT NULL DEFAULT false,
    "dadosBrutos" JSONB,

    CONSTRAINT "Cotacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricoPreco" (
    "id" TEXT NOT NULL,
    "itemNome" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "preco" DECIMAL(18,4) NOT NULL,
    "dataReferencia" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pesquisaId" TEXT,
    "municipio" TEXT,
    "uf" TEXT,

    CONSTRAINT "HistoricoPreco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FonteCotacao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tipo" "TipoFonte" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "endpointBase" TEXT,
    "metodoHttp" TEXT NOT NULL DEFAULT 'GET',
    "parametrosTemplate" JSONB,
    "headers" JSONB,
    "credencialCifrada" TEXT,
    "mapeamentoCampos" JSONB,
    "regexValor" TEXT,
    "fundamentacaoArtigo" TEXT,
    "limiteResultados" INTEGER NOT NULL DEFAULT 5,
    "timeoutMs" INTEGER NOT NULL DEFAULT 15000,
    "pausaMs" INTEGER NOT NULL DEFAULT 1200,
    "retries" INTEGER NOT NULL DEFAULT 2,
    "statusValidacao" "StatusValidacaoFonte" NOT NULL DEFAULT 'NAO_TESTADA',
    "ultimoTesteEm" TIMESTAMP(3),
    "ultimoTesteResultado" JSONB,
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FonteCotacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TabelaReferenciaItem" (
    "id" TEXT NOT NULL,
    "fonteId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "descricaoNorm" TEXT NOT NULL,
    "unidadeMedida" TEXT,
    "preco" DECIMAL(18,4) NOT NULL,
    "referencia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TabelaReferenciaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracaoSistema" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "municipio" TEXT,
    "uf" TEXT,
    "brasaoUrl" TEXT,
    "responsavelTecnico" TEXT,
    "metodoCalculo" "MetodoCalculo" NOT NULL DEFAULT 'MEDIA',
    "limiteOutlierPercentual" INTEGER NOT NULL DEFAULT 30,
    "minFontesCompleta" INTEGER NOT NULL DEFAULT 2,
    "itemAmostraTeste" TEXT NOT NULL DEFAULT 'caneta esferográfica azul',
    "textosFundamentacao" JSONB,
    "smtpConfig" JSONB,
    "canalSuporte" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ConfiguracaoSistema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogAuditoria" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "acao" TEXT NOT NULL,
    "entidade" TEXT,
    "entidadeId" TEXT,
    "detalhe" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogAuditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notificacao" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" "TipoNotificacao" NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtigoAjuda" (
    "id" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "conteudoMarkdown" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "publicado" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtigoAjuda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DicionarioSinonimo" (
    "id" TEXT NOT NULL,
    "termo" TEXT NOT NULL,
    "sinonimos" JSONB NOT NULL,
    "expansoes" JSONB NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DicionarioSinonimo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCatalogo" (
    "id" TEXT NOT NULL,
    "nomeNormalizado" TEXT NOT NULL,
    "descricaoPadrao" TEXT NOT NULL,
    "unidadeMedida" TEXT,
    "vezesUsado" INTEGER NOT NULL DEFAULT 0,
    "ultimoPrecoReferencia" DECIMAL(18,4),
    "ultimaDataReferencia" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemCatalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fornecedor" (
    "id" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "cnpj" TEXT NOT NULL,
    "contatoNome" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "endereco" TEXT,
    "municipio" TEXT,
    "uf" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CotacaoDireta" (
    "id" TEXT NOT NULL,
    "itemPesquisaId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "preco" DECIMAL(18,4),
    "anexoSolicitacaoUrl" TEXT,
    "anexoRespostaUrl" TEXT,
    "dataSolicitacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataResposta" TIMESTAMP(3),
    "justificativa" TEXT NOT NULL,
    "status" "StatusCotacaoDireta" NOT NULL DEFAULT 'ENVIADA',
    "outlier" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CotacaoDireta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_conviteToken_key" ON "User"("conviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_resetSenhaToken_key" ON "User"("resetSenhaToken");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Pesquisa_linkCompartilhamento_key" ON "Pesquisa"("linkCompartilhamento");

-- CreateIndex
CREATE INDEX "Pesquisa_userId_idx" ON "Pesquisa"("userId");

-- CreateIndex
CREATE INDEX "Pesquisa_status_idx" ON "Pesquisa"("status");

-- CreateIndex
CREATE INDEX "Pesquisa_createdAt_idx" ON "Pesquisa"("createdAt");

-- CreateIndex
CREATE INDEX "ItemPesquisa_pesquisaId_idx" ON "ItemPesquisa"("pesquisaId");

-- CreateIndex
CREATE INDEX "ItemPesquisa_statusItem_idx" ON "ItemPesquisa"("statusItem");

-- CreateIndex
CREATE UNIQUE INDEX "ItemPesquisa_pesquisaId_sequencia_key" ON "ItemPesquisa"("pesquisaId", "sequencia");

-- CreateIndex
CREATE INDEX "Cotacao_itemPesquisaId_idx" ON "Cotacao"("itemPesquisaId");

-- CreateIndex
CREATE INDEX "Cotacao_fonte_idx" ON "Cotacao"("fonte");

-- CreateIndex
CREATE INDEX "HistoricoPreco_itemNome_idx" ON "HistoricoPreco"("itemNome");

-- CreateIndex
CREATE INDEX "HistoricoPreco_dataReferencia_idx" ON "HistoricoPreco"("dataReferencia");

-- CreateIndex
CREATE UNIQUE INDEX "FonteCotacao_slug_key" ON "FonteCotacao"("slug");

-- CreateIndex
CREATE INDEX "FonteCotacao_ativo_statusValidacao_idx" ON "FonteCotacao"("ativo", "statusValidacao");

-- CreateIndex
CREATE INDEX "FonteCotacao_ordem_idx" ON "FonteCotacao"("ordem");

-- CreateIndex
CREATE INDEX "TabelaReferenciaItem_fonteId_idx" ON "TabelaReferenciaItem"("fonteId");

-- CreateIndex
CREATE INDEX "TabelaReferenciaItem_descricaoNorm_idx" ON "TabelaReferenciaItem"("descricaoNorm");

-- CreateIndex
CREATE INDEX "LogAuditoria_userId_idx" ON "LogAuditoria"("userId");

-- CreateIndex
CREATE INDEX "LogAuditoria_acao_idx" ON "LogAuditoria"("acao");

-- CreateIndex
CREATE INDEX "LogAuditoria_entidade_idx" ON "LogAuditoria"("entidade");

-- CreateIndex
CREATE INDEX "LogAuditoria_createdAt_idx" ON "LogAuditoria"("createdAt");

-- CreateIndex
CREATE INDEX "Notificacao_userId_lida_idx" ON "Notificacao"("userId", "lida");

-- CreateIndex
CREATE INDEX "Notificacao_createdAt_idx" ON "Notificacao"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArtigoAjuda_slug_key" ON "ArtigoAjuda"("slug");

-- CreateIndex
CREATE INDEX "ArtigoAjuda_categoria_idx" ON "ArtigoAjuda"("categoria");

-- CreateIndex
CREATE UNIQUE INDEX "DicionarioSinonimo_termo_key" ON "DicionarioSinonimo"("termo");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCatalogo_nomeNormalizado_key" ON "ItemCatalogo"("nomeNormalizado");

-- CreateIndex
CREATE INDEX "ItemCatalogo_nomeNormalizado_idx" ON "ItemCatalogo"("nomeNormalizado");

-- CreateIndex
CREATE UNIQUE INDEX "Fornecedor_cnpj_key" ON "Fornecedor"("cnpj");

-- CreateIndex
CREATE INDEX "CotacaoDireta_itemPesquisaId_idx" ON "CotacaoDireta"("itemPesquisaId");

-- CreateIndex
CREATE INDEX "CotacaoDireta_fornecedorId_idx" ON "CotacaoDireta"("fornecedorId");

-- AddForeignKey
ALTER TABLE "Pesquisa" ADD CONSTRAINT "Pesquisa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPesquisa" ADD CONSTRAINT "ItemPesquisa_pesquisaId_fkey" FOREIGN KEY ("pesquisaId") REFERENCES "Pesquisa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cotacao" ADD CONSTRAINT "Cotacao_itemPesquisaId_fkey" FOREIGN KEY ("itemPesquisaId") REFERENCES "ItemPesquisa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoPreco" ADD CONSTRAINT "HistoricoPreco_pesquisaId_fkey" FOREIGN KEY ("pesquisaId") REFERENCES "Pesquisa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FonteCotacao" ADD CONSTRAINT "FonteCotacao_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TabelaReferenciaItem" ADD CONSTRAINT "TabelaReferenciaItem_fonteId_fkey" FOREIGN KEY ("fonteId") REFERENCES "FonteCotacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfiguracaoSistema" ADD CONSTRAINT "ConfiguracaoSistema_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogAuditoria" ADD CONSTRAINT "LogAuditoria_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notificacao" ADD CONSTRAINT "Notificacao_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotacaoDireta" ADD CONSTRAINT "CotacaoDireta_itemPesquisaId_fkey" FOREIGN KEY ("itemPesquisaId") REFERENCES "ItemPesquisa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotacaoDireta" ADD CONSTRAINT "CotacaoDireta_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

