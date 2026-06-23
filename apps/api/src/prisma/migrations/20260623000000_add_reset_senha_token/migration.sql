-- Migration: adiciona campos de redefinição de senha ao User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resetSenhaToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resetSenhaExpiraEm" TIMESTAMP WITH TIME ZONE;
CREATE UNIQUE INDEX IF NOT EXISTS "User_resetSenhaToken_key" ON "User"("resetSenhaToken");
