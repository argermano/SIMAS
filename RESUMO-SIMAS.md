# RESUMO-SIMAS.md — fotografia do estado atual (2026-07-10)

> Documento de contexto para uma IA que vai planejar evoluções. Factual, sem propostas.
> App principal em `advogado-virtual/`. Repo irmão: `omnichannel` (VPS de atendimento).

## 1. VISÃO GERAL

O **SIMAS** é um SaaS jurídico **multi-tenant** para escritórios de advocacia brasileiros. Núcleo: **geração de peças processuais com IA** (prompts curados por área+peça, revisão humana obrigatória), cercado por um sistema operacional de escritório: clientes/atendimentos, contratos de honorários com assinatura digital, tarefas/Kanban, funil comercial de leads (WhatsApp), acompanhamento processual (DataJud), publicações/intimações (DJEN), conversas de WhatsApp dentro do sistema (via Chatwoot) e agenda unificada. Objetivo declarado do dono: **substituir o Astrea** (sem integrações com ele). Usuários: advogados e equipe (papéis `admin`/`advogado`/`colaborador`). Piloto em produção: escritório Katlen Nardes Germano Advogados (Brasília/DF, Florianópolis e Blumenau/SC) — a base foi zerada de propósito em 2026-07-05 para o piloto (base pequena = intencional). Billing/self-serve/venda multi-tenant estão **congelados** até validação no piloto.

## 2. ARQUITETURA

**Stack:** Next.js `^15.1` (App Router) · React 19 · TypeScript strict · Supabase (`@supabase/supabase-js` + `@supabase/ssr`: Postgres com **RLS por tenant**, Auth, Storage isolado por tenant) · Zod · Tailwind 3.4 + Radix + lucide (tokens shadcn, dark mode `class`) · TipTap (editor de peças) · docx/docxtemplater/jspdf/mammoth/pdf-parse (documentos) · `@anthropic-ai/sdk` + `groq-sdk` (não há SDK OpenAI) · Resend (e-mail) · Sentry (gateado por DSN) · Vitest. **Sem Prisma** (SQL puro), **sem date-fns nem lib de calendário** (`Date`+`Intl`, grades próprias).

**IA:** modelo padrão `claude-sonnet-4-6` (env `ANTHROPIC_MODEL`), "avançado" `claude-opus-4-8`, `claude-haiku-4-5` para resumos baratos (movimentos/publicações); Groq `whisper-large-v3` para transcrição de áudio.

**Multi-tenant:** função SQL `get_user_tenant_id()` + policy `tenant_id = get_user_tenant_id()` em todas as tabelas; toda rota de API repete `.eq('tenant_id', ...)` como defesa em profundidade. Auth de rota: `getAuthContext()` (`src/lib/auth.ts`) → `{supabase, user, usuario:{id,nome,tenant_id,role}}` + `requireRole()`. Banco: **46 migrations** numeradas (`001_tenants_users` … `046_agenda_calendario`).

**Estrutura de `src/`:** `app/(dashboard)/` (~23 páginas), `app/api/` (~120 `route.ts` em 32 grupos, destaque `ia/` com 16 rotas), `components/` (118 arquivos por módulo: atendimento, agenda, conversas, publicacoes, funil, tarefas, ui…), `lib/` (161 arquivos; destaque `prompts/` com **41 prompts curados**, `processos/`, `jurisprudencia/`, `anthropic/`, `conversas/`, `agenda/`), `services/task-service.ts`.

**Infra externa (repo `omnichannel`, VPS própria):** stack Docker de atendimento — **Evolution API** (WhatsApp, 2 números DF/SC), **Chatwoot** (inbox humana), **ai-attendant** (bot de triagem/agendamento em Node puro + Claude; prompt.txt versionado — nunca alterado sem aprovação do dono), **scheduler** (Cal.com, 2 agendas), **simas-relay** (ponte SIMAS↔Chatwoot; leitura com token admin, escrita **exclusivamente** com token pessoal do agente, cofre AES-256-GCM) e **Caddy** (TLS/roteamento). Deploy do VPS: push na `main` → GitHub Actions → `deploy-pull.sh` (recria só scheduler/ai-attendant/relay; Caddy só é recriado quando o Caddyfile muda, com validação prévia — o Caddyfile é bind-mount de arquivo único, preso ao inode). **Integrações SIMAS↔VPS** (todas por token): `POST /notify` (aviso WhatsApp de movimentação), `GET /api/integracao/processos/by-phone` (bot consulta processos — hoje desligado por flag no bot), rotas de funil (leads/agendamento), `RELAY_URL/relay/*` (conversas). Webhook Cal.com com HMAC; webhook D4Sign.

## 3. FUNCIONALIDADES ATUAIS (implementadas e no ar)

- **Geração de peças** por área (11 áreas × peça: inicial, contestação, réplica, apelação/recurso), consultoria, análise de caso, refinamento com documentos, comandos de edição por IA, validação, editor TipTap com export DOCX/PDF, workflow de **revisão/aprovação** com versões, telemetria de taxa de edição.
- **Clientes/atendimentos**: cadastro (CPF/RG cifrados AES-256-GCM), casos, documentos, gravação/transcrição de áudio com consentimento, extração de dados por IA.
- **Contratos de honorários**: templates, geração, assinatura digital **D4Sign** (webhook, reenvio, contrato físico importado), export.
- **Teses do escritório** (Fase 3): mineração de peças enviadas → IA extrai → advogado aprova → biblioteca curada usada na fundamentação.
- **Jurisprudência**: DataJud/LexML + **verificador determinístico de citações**.
- **Funil comercial** (Fase 4): Kanban de leads alimentado pelo bot do WhatsApp, métricas, agendamento Cal.com.
- **Acompanhamento processual** (Fase 5): arquitetura **on-demand + VIPs** (cron diário sincroniza só clientes com aviso ligado; teto `PROCESSOS_VIP_MAX=30`; demais sob demanda), timeline com resumo IA, aviso WhatsApp por categoria com claim atômico (nunca 2×), fila de aprovação.
- **Publicações** (DJEN por OAB, inclusive suplementar com sufixo literal ex. `75503A`): captura diária auditada, caixa master-detail, triagem→tarefa Kanban, contadores de tratamento, reprocesso idempotente. **Prazo nunca é calculado automaticamente** (invariante do dono).
- **Conversas**: tela 3 colunas (lista com selo "AGUARDANDO Xh" derivado, thread com nota interna, painel de contexto que casa telefone→cliente e mostra casos ativos + publicações + ações rápidas: agendar na agenda, transferir, vincular cliente). Escrita exige o agente conectar seu token pessoal do Chatwoot (e-mail SIMAS = e-mail Chatwoot).
- **Agenda**: grade dia/semana/mês agregando tarefas + eventos/prazos/audiências (`agenda_eventos`, com endpoint para bots) + consultas do bot; visibilidade Escritório/Particular; design editorial próprio.
- **Tarefas/Kanban** com comentários, histórico (audit_log) e aba de publicação vinculada. **Equipe/convites**, configurações (timbrado, formatação, uso de IA, VIPs, OABs monitoradas), auditoria, dashboard.
- **Testes:** 34 arquivos Vitest, **311 casos** (lógica pura de lib), todos verdes.

## 4. DECISÕES TÉCNICAS (o porquê)

- **Prompts curados por área+peça** (41 arquivos) em vez de prompt genérico — qualidade jurídica previsível; motor unificado em `lib/ia/pecas/motor.ts` + registro.
- **RLS + defesa em profundidade** (policy + `.eq(tenant_id)` em toda query) — vazamento cross-tenant é o risco nº 1 do produto.
- **Prazo NUNCA automático** — feriados/suspensões variam; prazo é decisão do advogado. Vale para publicações, agenda e tarefas (due_date nasce vazio).
- **DataJud on-demand + VIPs** — a API pública do CNJ usa chave única compartilhada e instável (não existe tier maior); polling de toda a carteira não escala. Retry 3× com backoff; no caminho do bot, budget de 5s/1 tentativa.
- **DJEN como fonte de publicações** (1 consulta/dia por OAB cobre a carteira inteira, com inteiro teor D+1) — rate ~20 req/min auto-imposto (`RATE_DELAY_MS=3200`); dedup por id.
- **Relay em vez de expor o Chatwoot**: browser nunca vê tokens (`RELAY_*` server-only, sem `NEXT_PUBLIC_`); escrita sempre como o agente real (compliance/atribuição).
- **Migrations SQL idempotentes** aplicadas por script próprio (Management API) — sem ORM.
- **Segredos**: envs validadas em `lib/env.ts` (fail-fast no boot); `ENCRYPTION_KEY` obrigatória e idêntica entre ambientes; criptografia app-level de PII.
- **Vercel Hobby = 2 crons**: lembretes-prazo (10h UTC) e funil-consultas (11h UTC); sync de processos e captura DJEN **pegam carona** no funil-consultas por decisão documentada.
- Padrão de UI: componentes `components/ui/*` (shadcn-like), tokens de tema (sem cor hardcoded), páginas server-component finas + client component por módulo.

## 5. ESTADO ATUAL

- **Em validação pelo dono (tudo já no ar):** redesigns de Agenda e Conversas (2026-07-10), tela de Publicações, fixes do bot (não responde "ok"/emoji; dúvida de golpe transborda; consulta de andamento pelo WhatsApp **desligada por flag** `CONSULTA_ANDAMENTO_ATIVA` no VPS até o escritório ativar).
- **Zero `TODO/FIXME`** marcados em `src/`. Dívidas reais conhecidas: DJEN **sem retry em 429** (falha transitória perde a rodada; recoberta no dia seguinte pela marca-d'água); rate-limit do `/api/contato` é in-memory por instância; leitura de criptografia aceita texto-plano legado (limpeza pendente de backfill); arquivos grandes (`djen.ts` 853 linhas, `ConsultoriaClient` 845, `CaixaPublicacoes` 840); **dois Kanbans** sem código compartilhado (funil e tarefas); vários efeitos colaterais best-effort documentados no código (falham em silêncio por design).
- **Sentry existe mas não está ligado** (falta conta/DSN — hoje só logs da Vercel).
- **Adiado/congelado:** módulo financeiro (E5), billing multi-tenant, Lote 3 de publicações (2ª execução diária/provedor redundante), SLA configurável, IA de sugestão de resposta nas conversas (dono optou por não ter), integração dos bots com `agenda_eventos` (endpoint pronto, sem consumidor).
- **Caminho de escala documentado** (quando a carteira crescer): SCMPP/TJPR grátis → provedor pago (Judit ~R$0,45–1,50/processo/mês). Astrea descartado como fonte programática (não tem API).

## 6. COMO RODAR

```bash
cd advogado-virtual
cp .env.local.example .env.local   # mínimo: 3 envs Supabase + ANTHROPIC_API_KEY (resto é feature-gated)
npm install                         # Node LTS (~22)
node --env-file=.env.local scripts/run-migrations.mjs   # exige SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN
npm run dev                         # http://localhost:3000
```

Gates: `npm run typecheck` · `npm test` (311) · `npm run build`. **Deploy:** push na `main` → Vercel (CI GitHub roda typecheck+test+build); mudanças de env exigem redeploy; migrations são aplicadas manualmente antes do push. VPS (`omnichannel`): push na `main` → Actions → `deploy-pull.sh`. Docs de referência: `advogado-virtual/README.md`, `SETUP.md`, `DESIGN_SYSTEM.md`, planos por fase em `advogado-virtual/docs/PLANO-*.md`.
