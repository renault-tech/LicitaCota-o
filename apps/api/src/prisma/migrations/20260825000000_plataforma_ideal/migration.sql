-- AlterEnum
DO $$ BEGIN
  ALTER TYPE "StatusItem" ADD VALUE IF NOT EXISTS 'AGUARDANDO_FORNECEDOR';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "CotacaoDireta" ADD COLUMN IF NOT EXISTS "origemAutomatica" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CotacaoDireta" ADD COLUMN IF NOT EXISTS "respostaToken" TEXT;
ALTER TABLE "CotacaoDireta" ADD COLUMN IF NOT EXISTS "respostaTokenExpiraEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "categorias" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ItemPesquisa" ADD COLUMN IF NOT EXISTS "precosDescartados" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CotacaoDireta_respostaToken_key" ON "CotacaoDireta"("respostaToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Fornecedor_categorias_idx" ON "Fornecedor" USING GIN ("categorias");
