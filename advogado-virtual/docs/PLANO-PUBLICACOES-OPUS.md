# PLANO — Módulo de Publicações/Intimações (triagem → Kanban)

> **Origem:** spec externa (`prompt-modulo-publicacoes-simas.md`) **adaptada ao SIMAS real** pelo Fable (2026-07-09), no padrão das Fases 4/5. A spec assumia Prisma, Kanban inexistente e captura do zero — nada disso vale. Este plano é a versão executável.

## 0. Contexto real (correções sobre a spec)

- **Sem Prisma.** Migrations SQL em `supabase/migrations/NNN_*.sql`, aplicadas com `node --env-file=.env.local scripts/run-migrations.mjs`. RLS multi-tenant via `get_user_tenant_id()` (padrão da migration 043).
- **A captura DJEN JÁ EXISTE** (`src/lib/processos/djen.ts`, no ar desde `e3c1e8d`): consulta diária por OAB na API Comunica, dedup por id da comunicação, marca d'água anti-perda (`tenants.config.djen_ultima_consulta`), rate ~20 req/min respeitado, resumo IA (Haiku) e aviso WhatsApp para clientes VIP. **O que falta:** hoje só persistimos publicações que CASAM com processos cadastrados — as demais são descartadas. Este módulo passa a **armazenar todas**, auditar execuções e criar o fluxo de triagem → tarefa.
- **O Kanban EXISTE** (migration `020_tarefas_kanban.sql`, página `/tarefas`). Integração direta via `taskService.createAutomatic()` (`src/services/task-service.ts`) — auto-resolve board/coluna/lista default, valida tenant, aceita `origin_reference` e `tagNames`. Exemplo real de automação: `src/app/api/pecas/[id]/enviar-revisao/route.ts:63`.
- **Escopo Astrea:** decisão do dono (2026-07-09) — este módulo substitui a perna de publicações/intimações do Astrea. Atualizar a memória `foco-geracao-de-pecas` na entrega.

## 1. Contrato da API — VALIDADO EMPIRICAMENTE (não redescobrir)

`GET https://comunicaapi.pje.jus.br/api/v1/comunicacao` — sem auth, ~20 req/min/IP (headers `x-ratelimit-*`), `itensPorPagina` ≤ 1000, `count` teto ~10k (fatiar por data se estourar).
Params: `numeroOab`, `ufOab`, `numeroProcesso`, `dataDisponibilizacaoInicio/Fim` (YYYY-MM-DD), `siglaTribunal`, `pagina`, `itensPorPagina`.
Item: `id` (number, chave de dedup), `numero_processo` (20 dígitos), `numeroprocessocommascara`, `siglaTribunal`, `tipoComunicacao`, `tipoDocumento`, `nomeOrgao`, `nomeClasse`, `data_disponibilizacao` (YYYY-MM-DD), `texto` (HTML com inteiro teor), `link`, `destinatarioadvogados[].advogado.{nome,numero_oab,uf_oab}`, `meio`, `status`, `hash` próprio.

**⚠️ ACHADO CRÍTICO (2026-07-09): a OAB suplementar leva o sufixo LITERAL.** `numeroOab=75503A&ufOab=SC` → 8 itens (destinatária "KATLEN SUZAN NARDES GERMANO, 75503A, SC"); `75503` sem o "A" → **0**. O `oabsDoTenant()` atual (`djen.ts`) faz `replace(/\D/g,'')` e **quebraria a OAB de SC** → corrigir para normalizar apenas `[.\s-]` (preservar letras, uppercase).

**Inscrições a monitorar (piloto):** OAB/DF `31637` (já configurada em `tenants.oab_numero`) e OAB/SC `75503A` (adicionar via config — ver §4).

## 2. Modelo de dados (migration `044_publicacoes.sql`)

```sql
-- Caixa de entrada auditável de publicações (TODAS as capturadas por OAB)
CREATE TABLE IF NOT EXISTS publicacoes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fonte               TEXT NOT NULL DEFAULT 'djen' CHECK (fonte IN ('djen','manual')), -- extensível (Judit/Escavador depois)
  chave_fonte         TEXT NOT NULL,            -- id da comunicação no DJEN; p/ 'manual', sha256(texto+numero+data)
  numero_processo     TEXT,                     -- 20 dígitos (pode ser null em edital sem nº)
  numero_mascara      TEXT,
  sigla_tribunal      TEXT,
  orgao_julgador      TEXT,
  tipo_comunicacao    TEXT,
  tipo_documento      TEXT,
  nome_classe         TEXT,
  texto               TEXT,                     -- HTML integral (inteiro teor)
  data_disponibilizacao DATE NOT NULL,
  data_publicacao_sugerida DATE,                -- próximo dia ÚTIL (só fds; SEM feriados — é sugestão, nunca prazo)
  destinatarios       JSONB NOT NULL DEFAULT '[]',
  oab_consultada      TEXT NOT NULL,
  uf_oab              TEXT NOT NULL,
  meta                JSONB,                    -- item bruto da API
  status              TEXT NOT NULL DEFAULT 'nova' CHECK (status IN ('nova','triada','tarefa_criada','descartada')),
  descarte_motivo     TEXT,
  triada_por          UUID REFERENCES users(id),
  triada_em           TIMESTAMPTZ,
  task_id             UUID REFERENCES tasks(id) ON DELETE SET NULL,
  processo_id         UUID REFERENCES processos(id) ON DELETE SET NULL,          -- match Fase 5 (se cadastrado)
  movimento_id        UUID REFERENCES processo_movimentos(id) ON DELETE SET NULL, -- aviso ao cliente já gerado
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_publicacao_fonte ON publicacoes (tenant_id, fonte, chave_fonte);
CREATE INDEX IF NOT EXISTS idx_publicacoes_tenant_data ON publicacoes (tenant_id, data_disponibilizacao DESC);
CREATE INDEX IF NOT EXISTS idx_publicacoes_tenant_status ON publicacoes (tenant_id, status);

-- Auditoria de execução (1 linha por tenant+OAB por rodada; SEMPRE grava, mesmo com zero)
CREATE TABLE IF NOT EXISTS capturas_publicacoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  oab           TEXT NOT NULL,
  uf            TEXT NOT NULL,
  janela_inicio DATE NOT NULL,
  janela_fim    DATE NOT NULL,
  iniciada_em   TIMESTAMPTZ NOT NULL,
  finalizada_em TIMESTAMPTZ,
  status        TEXT NOT NULL CHECK (status IN ('sucesso','falha','parcial')),
  qtd_encontradas INTEGER NOT NULL DEFAULT 0,
  qtd_novas       INTEGER NOT NULL DEFAULT 0,
  qtd_duplicadas  INTEGER NOT NULL DEFAULT 0,
  erro          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_capturas_tenant_data ON capturas_publicacoes (tenant_id, created_at DESC);
```
+ trigger `updated_at` (função padrão) + RLS tenant nas duas (padrão 043; escrita de `capturas_publicacoes` só via service-role).

**OABs monitoradas:** manter o mecanismo existente (`tenants.oab_numero/oab_estado` + `tenants.config.djen_oabs`), agora com shape `[{numero:'75503A', uf:'SC', ativa:true}]` — SEM tabela nova. Adicionar UI de gestão em Configurações (card Avisos/DJEN): listar, adicionar, desativar (admin/advogado). Semear a OAB SC do piloto via UI na parada do Lote 1 (dono).

## 3. Refactor do pipeline (`src/lib/processos/djen.ts` — estender, não reescrever)

Ordem nova dentro de `sincronizarPublicacoesDjen` (mesmos guards: marca d'água, cap, `completo:false` ⇒ não avança, claim atômico):

1. **Janela deslizante D-2**: overlap da marca passa de -1 para **-2 dias** (spec §2; dedup absorve). Datas SEMPRE em `America/Sao_Paulo` — trocar `new Date().toISOString().slice(0,10)` por helper `hojeSaoPaulo()` (Intl, TZ SP) usado em `hojeISO` e na `data_publicacao_sugerida`.
2. **Persistir TODAS as publicações parseadas** em `publicacoes` (upsert `ignoreDuplicates` por `(tenant_id, fonte, chave_fonte)`, `chave_fonte = String(item.id)`), status `nova`, com `data_publicacao_sugerida = proximoDiaUtil(data_disponibilizacao)` (helper puro: pula sáb/dom; **sem feriados** — comentário explícito). Contar novas/duplicadas p/ auditoria.
3. **Match** (fluxo atual intacto): as que casam com `processos` cadastrados seguem para `processo_movimentos` + resumo IA + aviso VIP; gravar `publicacoes.processo_id` e `movimento_id` nelas.
4. **Auditoria**: gravar `capturas_publicacoes` por (tenant, oab) — inclusive `qtd_encontradas=0` (ausência de linha do dia = falha silenciosa). `parcial` quando `completo:false`/cap/deadline.
5. **Alerta de falha** (novo `src/lib/processos/alertas.ts`): em `status='falha'` (ou exceção no cron), enviar **e-mail** via `enviarEmail`+`emailTemplate` (`src/lib/email.ts`) para `CONTACT_REPLY_EMAIL` + `Sentry.captureException` (SDK já instalado; no-op sem `SENTRY_DSN`) + **WhatsApp opcional** via `enviarAvisoWhatsApp` para `tenants.config.alerta_whatsapp` (se configurado; NÃO usar `tenants.telefone` — é fixo). Nunca lançar.
6. **Fix OAB**: `oabsDoTenant` normaliza `numero.toUpperCase().replace(/[.\s-]/g,'')` (preserva o sufixo "A").
7. **Vigia cruzado**: no cron `lembretes-prazo` (roda 10:00 UTC, antes do funil-consultas 11:00), checar se há `capturas_publicacoes` com sucesso nas últimas 26h; se não, alertar (§5 acima). Se ambos os crons morrerem, nada alerta — limitação documentada (§7).

**LGPD:** nunca logar `texto` (só ids/hashes/contagens — padrão já seguido no djen.ts).

## 4. Rotas

| Rota | Auth | Função |
|---|---|---|
| `GET /api/publicacoes` | sessão | lista paginada; filtros `status`, `tribunal`, `oab`, `q` (busca em texto/nº), `de`/`ate` |
| `GET /api/publicacoes/[id]` | sessão | detalhe (texto integral + meta) |
| `POST /api/publicacoes/[id]/triar` | sessão (admin/advogado) | `{acao:'tarefa'\|'descartar'\|'triada', motivo?, tarefa?:{assignee_id, description?, due_date?, priority?}}`. Transições SÓ de `nova` (claim atômico via `UPDATE ... WHERE status='nova'` — lição da Fase 5); `descartar` exige motivo; `tarefa` → `taskService.createAutomatic({description: pré-montada, assigneeId (obrigatório no schema!), dueDate (editável, default null), priority, originReference:'publicacao:<id>', tagNames:['PUBLICAÇÃO']})` e grava `task_id`. Roda em rota autenticada ⇒ o client user-scoped do taskService funciona (RLS ok). `logAudit` em toda transição. |
| `GET /api/publicacoes/saude` | sessão | últimas execuções por OAB (p/ widget) + total `nova` |
| `POST /api/cron/captura-publicacoes` | `CRON_SECRET` **ou** sessão admin | reprocessamento manual `{dataInicio, dataFim}` (chama o pipeline com janela explícita, sem avançar marca) |

`/api/publicacoes` fica sob sessão normal (middleware não muda; `/api/cron` já é autônoma).

## 5. Agendamento — restrição real da Vercel

`vercel.json` tem **2 crons** (limite do plano Hobby, precisão diária). Estratégia:
- **Caminho A (tentar 1º):** adicionar 3º cron `{path:'/api/cron/captura-publicacoes', schedule:'30 10 * * *'}` (07:30 BRT) e deixar o funil-consultas apenas com funil+DataJud. Se o deploy REJEITAR (Hobby), **Caminho B:** manter a captura dentro do `funil-consultas` (como hoje, 08:00 BRT) e a rota nova só para reprocessamento manual.
- A "2ª execução diária (12:00)" da spec: só com plano Pro — anotar como upgrade futuro, não bloquear.

## 6. UI (padrões do repo: Cards, Badge, EmptyState, Spinner, toast; dark-mode via tokens)

1. **Página `/publicacoes`** (`(dashboard)`, gate admin/advogado como `/processos/notificacoes`): filtros no topo (status, tribunal, OAB, busca), lista por `data_disponibilizacao` desc com badge de status (Nova=warning, Triada=secondary, Tarefa=success, Descartada=default), nº do processo (link p/ ficha do cliente quando `processo_id`), tipo de documento e trecho do texto plano.
2. **Detalhe** (drawer/modal): texto integral (render seguro do HTML — sanitizar ou exibir `texto_plano` com quebras), metadados, link externo (`meta.link`), e as 3 ações. **Criar tarefa**: modal pré-preenche `description` = "Publicação {tipo} — proc. {nº mascarado}" (editável), responsável (select de users do tenant — obrigatório), prioridade, `due_date` **vazia por padrão** exibindo `data_publicacao_sugerida` como referência ("Disponibilizada em X; publicação presumida Y — defina o prazo manualmente"). **NUNCA pré-confirmar prazo** (spec §6 — mantida à risca; sem cálculo de prazo, sem feriados).
3. **Widget de saúde** no topo: última captura (quando, status, encontradas/novas) por OAB; vermelho se não houve execução com sucesso hoje.
4. **Sidebar**: item "Publicações" (ícone `Newspaper`, admin/advogado) com **badge de contagem de novas** (client-side fetch leve ao `/api/publicacoes/saude`; não há padrão de badge no menu hoje — criar minimal, sem polling agressivo: 1 fetch por mount).

## 7. Limitações documentadas (criar `docs/publicacoes.md`)

- DJEN não cobre STF; processos sigilosos saem com partes ocultas.
- D+1: o ato aparece no dia seguinte à disponibilização — módulo é de triagem diária, não tempo real.
- Vigia de falha depende dos crons da Vercel; se AMBOS morrerem, o sinal é o widget vermelho (monitor externo de heartbeat = evolução futura).
- Prazo processual é decisão humana — o sistema nunca calcula/confirma prazo.
- Fonte redundante (Judit/Escavador/Codilo) = evolução futura já suportada pelo enum `fonte` + `chave_fonte`.

## 8. Testes (vitest, padrão `src/lib/processos/*.test.ts`)

- `proximoDiaUtil` (sexta→segunda, sábado→segunda, quarta→quinta).
- `hojeSaoPaulo` / janela D-2 (`janelaConsultaDjen` atualizada — casos: sem marca (backfill 30d), com marca (overlap 2d), marca inválida).
- Normalização de OAB com sufixo (`'75.503-A'`→`'75503A'`; `'31637'`→`'31637'`) — trava o fix crítico.
- Dedup por `(fonte, chave_fonte)` e hash sha256 p/ fonte manual.
- Transições de triagem (só de `nova`; descarte exige motivo).
- Integração: pipeline com fetch mockado (2 páginas, 1 falha → `parcial` + marca não avança + auditoria gravada).

## 9. Lotes (ordem de execução)

| Lote | Conteúdo | Verificação | Parada |
|---|---|---|---|
| **1** | Migration 044 (aplicar em prod) + refactor pipeline (§3: persistir todas, auditoria, janela D-2, TZ SP, fix OAB, alertas e-mail/Sentry, vigia cruzado) + UI de OABs em Configurações + rota de reprocessamento | testes §8 + tsc + build + review adversarial (invariantes: marca nunca avança em cobertura incompleta; dedup nunca duplica; alerta nunca lança) | 🛑 dono: adicionar OAB/SC `75503A` na UI, rodar reprocessamento de julho e conferir `publicacoes` + auditoria |
| **2** | Rotas de lista/detalhe/triagem/saúde + página `/publicacoes` + modal criar tarefa (taskService) + widget saúde + badge no menu | testes de triagem + tsc + build + review | 🛑 dono: triar publicações reais — criar 1 tarefa no Kanban, descartar 1, validar fluxo com a equipe |
| **3** (futuro) | 2ª execução diária (Pro), WhatsApp de alerta interno (config), provedor redundante + reconciliação | — | decisão de custo do dono |

**Definition of Done (Lotes 1-2):** captura diária grava TODAS as publicações das 2 OABs com auditoria; falha gera e-mail; a advogada abre `/publicacoes`, vê as novas, cria tarefa no Kanban com responsável e prazo manual; publicação de processo cadastrado continua gerando aviso ao cliente VIP (fluxo Fase 5 intacto — zero regressão em `processo_movimentos`/avisos).

## 10. Fora de escopo (não implementar)

Cálculo automático de prazo; feriados/suspensões; captura por nome (homônimos); provedores pagos; STF; exclusão física de publicações (descartada ≠ apagada — trilha de auditoria).
