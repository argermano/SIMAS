# Scripts operacionais

Scripts de manutenção/migração. **Todos leem credenciais de variáveis de ambiente** — rode com `--env-file=.env.local` (Node ≥ 20.6) e **nunca** hardcode segredos.

⚠️ Operam sobre o **banco de produção**. Faça backup antes de operações destrutivas.

## Versionados

### `run-migrations.mjs`
Aplica **todas** as migrations de `supabase/migrations/*.sql` em ordem, idempotente (erros de "já existe" são ignorados), via Management API do Supabase.

```bash
SUPABASE_PROJECT_REF=xxxx SUPABASE_ACCESS_TOKEN=sbp_xxx \
  node scripts/run-migrations.mjs
# ou
node --env-file=.env.local scripts/run-migrations.mjs
```

Requer `SUPABASE_PROJECT_REF` e `SUPABASE_ACCESS_TOKEN` (token pessoal da Management API).

### `backfill-encrypt-clientes.mjs`
Cifra (AES-256-GCM) os campos `cpf`/`rg` de clientes que ainda estão em texto-plano. Idempotente (pula valores já cifrados). Usa o mesmo formato de `src/lib/encryption.ts`.

```bash
node --env-file=.env.local scripts/backfill-encrypt-clientes.mjs --dry-run  # só relata
node --env-file=.env.local scripts/backfill-encrypt-clientes.mjs            # aplica
```

Requer `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`.
⚠️ Só rode **após** o deploy com a decifragem no ar e com a **mesma** `ENCRYPTION_KEY` de produção — senão os CPFs aparecerão como `enc:v1:...` no app.

## Não versionados (diagnóstico ad-hoc)

Scripts locais de diagnóstico/limpeza pontual (ex.: `diagnose-*`, `cleanup-*`, `check-owner`, `try-role`) **não são versionados** e podem ser **destrutivos** (ex.: `cleanup-bypass-trigger`). Revise antes de executar e prefira `--dry-run` quando disponível.
