# Advogado Virtual (SIMAS)

SaaS jurídico **multi-tenant** para escritórios de advocacia: atendimento com transcrição de áudio (IA), análise de caso, geração de peças e documentos, contratos de honorários com assinatura digital, gestão de clientes e tarefas (Kanban).

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict)
- **Supabase** — Postgres + Auth + Storage + **RLS** (isolamento por tenant)
- **IA** — Anthropic (Claude) para geração/análise; **Groq** (Whisper) para transcrição
- **Assinatura digital** — D4Sign
- **Export** — DOCX (`docx`) e PDF (`jspdf`)
- **UI** — Tailwind, Radix, TipTap (editor), dnd-kit (Kanban)
- **Testes** — Vitest

## Estrutura

```
src/
  app/            # rotas (App Router) + páginas
    api/          # ~63 rotas de API (CRUD, IA, webhooks, exportação)
    (dashboard)/  # área autenticada
    (auth)/       # login, definir-senha, etc.
  components/     # UI por domínio (atendimento, clientes, contratos, tarefas, ...)
  lib/            # núcleo
    auth.ts       # getAuthContext()/requireRole() — base do withAuth
    api.ts        # jsonError() + validateBody() (Zod)
    encryption.ts # AES-256-GCM de CPF/RG em repouso
    audit.ts      # trilha de auditoria (audit_log)
    logger.ts     # logger estruturado com redação
    env.ts        # validação de env (Zod) — fail-fast no boot
    supabase/     # clients (server/client/middleware)
    anthropic/    # client, quota (cotas por plano), usage
    d4sign/, export/, jurisprudencia/, prompts/, constants/
  services/       # task-service
supabase/migrations/  # migrations SQL (numeradas)
scripts/          # scripts operacionais (ver scripts/README.md)
```

## Começando

```bash
cp .env.local.example .env.local   # preencha os valores
npm install
npm run dev                        # http://localhost:3000
```

### Variáveis de ambiente

Validadas no boot por `src/lib/env.ts` (`src/instrumentation.ts`). **Obrigatórias** (app não sobe sem):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.

**Opcionais (feature-gated):** `GROQ_API_KEY` (transcrição), `RESEND_API_KEY` (e-mail), `ENCRYPTION_KEY` (criptografia de CPF/RG — `openssl rand -hex 32`), `D4SIGN_TOKEN_API`/`D4SIGN_CRYPT_KEY`/`D4SIGN_WEBHOOK_SECRET` (assinatura), `DATAJUD_API_KEY`, `CONTACT_REPLY_EMAIL`, `ANTHROPIC_MAX_PROMPT_CHARS`.

Para rodar migrations: `SUPABASE_PROJECT_REF` e `SUPABASE_ACCESS_TOKEN` (token pessoal da Management API — **nunca commitar**).

## Scripts

```bash
npm run dev          # desenvolvimento
npm run build        # build de produção
npm test             # testes (Vitest)
npm run test:watch   # testes em watch
npm run lint         # ESLint (Next)
```

Scripts operacionais em [scripts/](scripts/) — ver [scripts/README.md](scripts/README.md).

## Banco de dados (migrations)

Aplicar todas as migrations (idempotente) via Management API:

```bash
node --env-file=.env.local scripts/run-migrations.mjs
```

Ou cole o SQL de `supabase/migrations/*.sql` no **SQL Editor** do painel Supabase. As migrations são numeradas e devem ser aplicadas em ordem.

## Segurança & Compliance

- **Isolamento multi-tenant** via RLS (`get_user_tenant_id()`) + checagens em rotas que usam `service_role`.
- **CPF/RG criptografados em repouso** (AES-256-GCM) quando `ENCRYPTION_KEY` está configurada (retrocompatível com dados legados).
- **Auditoria** de operações sensíveis (`audit_log`).
- **Webhook D4Sign** validado por secret; uploads validados por *magic bytes*; cotas de IA por plano.

## Runbook de deploy (Vercel)

1. **Garanta as env vars** no Vercel (Production) — em especial `ENCRYPTION_KEY` (mesmo valor em todos os ambientes que leem dados cifrados).
2. **Aplique as migrations** pendentes (`scripts/run-migrations.mjs` ou SQL Editor).
3. **Deploy**: push para `main` dispara o build na Vercel (CI roda type-check + test + build em `.github/workflows/ci.yml`).
   - ⚠️ Mudança de env var só vale em **deploy novo** — redeploy após alterar variáveis.
4. **Pós-deploy**: se ativar criptografia pela 1ª vez, rode o backfill dos CPFs existentes:
   `node --env-file=.env.local scripts/backfill-encrypt-clientes.mjs --dry-run` (depois sem o flag).
   ⚠️ Só rode com `ENCRYPTION_KEY` de produção **idêntica** à usada no backfill.

## Documentação adicional

- [SETUP.md](SETUP.md) — setup detalhado do Supabase.
- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) — padrões de UI.
