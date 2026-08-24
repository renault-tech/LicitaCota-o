# LicitaPreço

Sistema web de **pesquisa de preços para licitações** conforme a Lei Federal nº 14.133/2021 e a IN SEGES/ME nº 65/2021.

Automatiza a coleta de cotações em múltiplas fontes (APIs públicas, scrapers, tabelas de referência e cotações diretas com fornecedores), calcula o preço de referência com remoção de outliers e gera a planilha formal de banco de preços com a metodologia legal exigida.

---

## Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose v2
- [Node.js](https://nodejs.org/) 22+ e [pnpm](https://pnpm.io/) 11+ (para desenvolvimento local sem Docker)

---

## Setup rápido (Docker)

```bash
# 1. Clone o repositório
git clone https://github.com/renault-tech/LicitaCota-o.git
cd LicitaCota-o

# 2. Configure as variáveis de ambiente
cp .env.example .env
# Edite .env e defina ao menos JWT_SECRET e JWT_REFRESH_SECRET

# 3. Suba a stack (Postgres + Redis + API + Worker)
docker compose up -d

# 4. Execute as migrations e o seed
docker compose exec api node -e "
  const { execSync } = require('child_process');
  execSync('pnpm -F api exec prisma migrate deploy', { stdio: 'inherit' });
"

# 5. Crie o usuário administrador
docker compose exec api node apps/api/dist/scripts/create-admin.js
```

A API estará disponível em `http://localhost:3001`.

---

## Setup local (sem Docker)

Você precisará de PostgreSQL 16 e Redis 7 rodando localmente.

```bash
pnpm install

# Configure .env com DATABASE_URL e REDIS_URL apontando para localhost
cp .env.example .env

# Compile o pacote compartilhado — a API e o seed importam @licitapreco/shared
# a partir de dist/, então este passo precede qualquer script da API.
pnpm --filter @licitapreco/shared build

# Gere o Prisma Client e rode as migrations
pnpm prisma:generate
pnpm prisma:migrate   # cria o banco e aplica todas as migrations

# Popule com dados iniciais (fontes, config, dicionário)
pnpm seed

# Crie o primeiro administrador
pnpm create-admin

# Inicie a API (porta 3001)
pnpm dev:api
```

> **Worker:** o processo da API já sobe um worker BullMQ ao importar a fila.
> Subir `pnpm --filter @licitapreco/api worker:dev` em paralelo faz dois
> workers concorrerem pela mesma fila — use apenas quando a API rodar com o
> worker desabilitado.

---

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|:-----------:|-----------|
| `DATABASE_URL` | Sim | URL de conexão PostgreSQL |
| `REDIS_URL` | Sim | URL de conexão Redis (padrão: `redis://localhost:6379`) |
| `JWT_SECRET` | Sim | Segredo do access token (mín. 32 chars) |
| `JWT_REFRESH_SECRET` | Sim | Segredo do refresh token (mín. 32 chars) |
| `FRONTEND_URL` | Não | URL do frontend para links em e-mails |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Não | Configuração SMTP para e-mails |
| `STORAGE_DRIVER` | Não | `local` (padrão) ou `supabase` |
| `STORAGE_URL` / `STORAGE_KEY` | Não | Necessários se `STORAGE_DRIVER=supabase` |
| `CREDENCIAL_ENC_KEY` | Não | Chave de 32 chars para cifrar credenciais de fontes |

Veja `.env.example` para a lista completa com descrições.

---

## Estrutura do monorepo

```
LicitaCota-o/
├── apps/
│   └── api/                  # API REST (Express + BullMQ + Prisma)
│       ├── src/
│       │   ├── config/       # env, prisma client
│       │   ├── middleware/   # auth JWT, guards de role
│       │   ├── prisma/       # schema, migrations, seed
│       │   ├── routes/       # auth, pesquisas, fontes, usuários, config...
│       │   ├── scripts/      # create-admin, reset-senha
│       │   ├── services/
│       │   │   ├── cotacao/  # motor plugável (API REST, scraping, tabela)
│       │   │   ├── planilha/ # leitura e geração de xlsx
│       │   │   └── queue/    # fila BullMQ + worker
│       │   └── utils/        # logger, errors, crypto, texto
│       └── Dockerfile
├── packages/
│   └── shared/               # Tipos e constantes compartilhados
├── docker-compose.yml
├── .env.example
└── pnpm-workspace.yaml
```

---

## Scripts úteis

| Comando | Descrição |
|---------|-----------|
| `pnpm dev:api` | Inicia a API em modo watch |
| `pnpm --filter @licitapreco/api worker:dev` | Inicia o worker em modo watch |
| `pnpm seed` | Popula fontes, configuração e dicionário |
| `pnpm create-admin` | Cria o primeiro usuário ADMIN |
| `pnpm reset-senha` | Redefine a senha de um usuário por e-mail |
| `pnpm prisma:generate` | Regenera o Prisma Client |
| `pnpm prisma:migrate` | Cria e aplica novas migrations |
| `pnpm lint` | Roda ESLint em todos os pacotes |
| `pnpm test` | Roda vitest em todos os pacotes |

---

## API — principais endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/auth/login` | Login, retorna access + refresh token |
| `POST` | `/api/auth/refresh` | Renova o access token |
| `GET` | `/api/auth/me` | Perfil do usuário autenticado |
| `GET` | `/api/pesquisas` | Lista pesquisas do usuário |
| `POST` | `/api/pesquisas` | Cria nova pesquisa |
| `POST` | `/api/pesquisas/:id/planilha` | Upload de planilha xlsx/tsv |
| `POST` | `/api/pesquisas/:id/confirmar` | Confirma itens e prepara para processar |
| `POST` | `/api/pesquisas/:id/processar` | Enfileira o processamento |
| `GET` | `/api/pesquisas/:id/progresso` | Stream SSE com progresso em tempo real |
| `GET` | `/api/pesquisas/:id/resultado/planilha` | Download do banco de preços gerado |
| `GET` | `/api/fontes` | Lista fontes de cotação (credenciais e headers só para ADMIN) |
| `POST` | `/api/fontes/:id/testar` | Testa e valida uma fonte |

---

## Base legal

- Lei Federal nº 14.133/2021 — Nova Lei de Licitações e Contratos Administrativos
- Instrução Normativa SEGES/ME nº 65/2021 — Pesquisa de Preços
