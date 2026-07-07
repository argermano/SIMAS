# PLANO FASE 5 — Acompanhamento processual (processos + movimentações + avisos ao cliente)

> **Origem:** pedido do dono (2026-07-07), avaliado e ancorado no código real pelo Fable.
> **Execução:** Opus, em lotes na `main` (tsc + testes + build antes de push; migrations idempotentes via `node --env-file=.env.local scripts/run-migrations.mjs`, aplicar em produção no lote da migration).
> **Caso-exemplo validado ao vivo:** MARTA DE ALMEIDA SUENAR, processo `0009008-28.2025.8.16.0026` — **TJPR** (Pitanga-PR; o dono citou TJSC, mas `8.16` = Paraná e o DataJud confirmou: 1 hit no `tjpr`, 0 no `tjsc`). Alvará Judicial Lei 6.858/80, 78 movimentos, procedência 11/12/2025, trânsito em julgado 11/03/2026, arquivado 19/03/2026.

## 0. Objetivo do produto

1. **Vincular processos a clientes** — N processos por cliente, mesmo sem caso/atendimento no SIMAS.
2. **Armazenar as movimentações** no banco (íntegra do registro DataJud + **resumo em linguagem natural por IA**, gerado 1x no sync) — consultas nunca batem no site/API na hora da pergunta.
3. **Avisar o cliente por WhatsApp** quando houver movimentação de tipo relevante — o escritório escolhe **quais categorias** notificam (config do tenant) e **cada cliente** tem o modo: `desligado` (default) / `fila` (aprovação humana) / `automatico`.
4. *(Lote final)* O assistente de WhatsApp responde "como está meu processo?" para **cliente ativo identificado pelo telefone**, em linguagem natural, lendo do banco.

## 1. Decisões do dono (registradas — não rediscutir)

| # | Decisão |
|---|---|
| 1 | Vínculo é **cliente ↔ processo** (não via atendimento); múltiplos processos por cliente |
| 2 | Guardar **íntegra do movimento** (JSON bruto DataJud) + **resumo IA** por movimento |
| 3 | Config de aviso é **por cliente**: `desligado` / `fila` / `automatico` (recomendação do piloto: começar por `fila`) |
| 4 | Escritório escolhe **categorias** de movimentação notificáveis (config do tenant) |
| 5 | Guardrails do bot/avisos: só cliente **ativo** com telefone batendo; conteúdo **factual** (sem interpretação jurídica, sem valores/estratégia); sempre oferecer atendente |
| 6 | `prompt.txt` do ai-attendant: mostrar o texto ao dono antes de publicar (regra permanente) |

## 2. Fatos verificados no código (não redescobrir)

| Item | Onde | Estado |
|---|---|---|
| Cliente DataJud | `src/lib/jurisprudencia/datajud.ts` | `buscarProcessoPorNumero(alias, numeroLimpo, timeoutMs=12000)` pronto; chave pública CNJ com fallback hardcoded; retorno já inclui `movimentos[{nome,data}]` — **estender para devolver o movimento bruto completo** (codigo, dataHora, complementosTabelados) sem quebrar os usos existentes |
| Validação CNJ + alias | `src/lib/jurisprudencia/verificador-citacoes.ts` | `validarNumeroCNJ`, `aliasDataJud` (mapa J.TR→alias, ex. `8.16`→tjpr) |
| IA JSON | `src/lib/anthropic/client.ts` | `completionJSON` (usado na Fase 3) — reusar para os resumos |
| Crons | `vercel.json` | **2/2 usados** (limite Hobby): `lembretes-prazo` 10h, `funil-consultas` 11h. **Não criar 3º cron**: o sync roda DENTRO do handler de `funil-consultas` (extrair p/ módulo `src/lib/processos/sync.ts` e chamar após a lógica do funil; logar cada etapa separadamente) |
| Tela do cliente | `src/app/(dashboard)/clientes/[id]/page.tsx` (+ `ClienteAcoesClient.tsx`, subpastas `atendimentos/`, `casos/`, `editar/`) | Adicionar seção "Processos" |
| Config do tenant | `tenants.config JSONB` (migration 001) | Guardar categorias notificáveis em `config.processos_notificar: string[]` (sem migration extra p/ isso) |
| Auth/roles | `getAuthContext`, `requireRole` (`src/lib/auth.ts`) | UI/rotas de sessão; integração usa `x-simas-token` (`src/lib/funil/auth-integracao.ts`, `autorizadoIntegracao`) |
| Telefone matching | `src/lib/funil/telefone.ts` | `mesmoTelefone` (máscara/DDI/9º dígito) — reusar no by-phone |
| Envio WhatsApp | ai-attendant `sendText(number, text, instance)` (repo `argermano/omnichannel`) | Já multi-instância (whatsapp-sc / whatsapp-df) |
| Deploy omnichannel | GitHub Actions no push da `main` | `git pull --ff-only` → `node --check` (só ai-attendant) → recreate. **VPS pull-only; SEMPRE `git pull --ff-only` antes de editar (há outra sessão desenvolvendo o bot)** |
| Estado do bot | commit `f088a7e`+ | Sessão é **serializada** (`/data/sessions.json`): não guardar timers/objetos não-serializáveis em `session`; respeitar `session.contactState` (gate de leads da Opção 1); `paused` por `fromMe` com `key.id ∉ botIds` |
| Exposição do VPS | `Caddyfile` (repo omnichannel) | ai-attendant **não** é público. Padrão de rota autenticada por header já existe (scheduler: `@auth header X-Sched-Token ...`). **Expor só um caminho** `/notify` sob o domínio `agenda.apoiojuridicodf.adv.br` (path-route → `ai-attendant:3000`) com header próprio `X-Notify-Token` — **sem DNS novo** |

## 3. Modelo de dados — migration `043_processos.sql`

```sql
-- Processos vinculados a clientes (mesmo sem caso no SIMAS)
CREATE TABLE IF NOT EXISTS processos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cliente_id      UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  numero_cnj      TEXT NOT NULL,              -- só dígitos, validado (DV CNJ)
  tribunal_alias  TEXT NOT NULL,              -- ex.: tjpr (aliasDataJud)
  classe          TEXT,
  orgao_julgador  TEXT,
  assuntos        JSONB NOT NULL DEFAULT '[]',
  grau            TEXT,
  data_ajuizamento TIMESTAMPTZ,
  situacao        TEXT NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo','encerrado')),
  dados_capa      JSONB,                      -- snapshot bruto da capa DataJud
  ultima_sincronizacao TIMESTAMPTZ,
  datajud_atualizado_em TIMESTAMPTZ,          -- dataHoraUltimaAtualizacao do DataJud
  apelido         TEXT,                       -- rótulo amigável opcional ("Aposentadoria INSS")
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_processo_tenant_numero ON processos (tenant_id, numero_cnj);
CREATE INDEX IF NOT EXISTS idx_processos_cliente ON processos (cliente_id);

-- 1 linha por movimentação (íntegra + resumo IA + estado de notificação)
CREATE TABLE IF NOT EXISTS processo_movimentos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id  UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  codigo       INTEGER,                       -- código TPU/CNJ
  nome         TEXT NOT NULL,
  data_hora    TIMESTAMPTZ,
  complementos JSONB NOT NULL DEFAULT '[]',
  raw          JSONB NOT NULL,                -- íntegra do registro DataJud
  raw_hash     TEXT NOT NULL,                 -- md5 do raw p/ dedup no sync
  resumo_ia    TEXT,                          -- linguagem natural (gerado 1x)
  categoria    TEXT,                          -- categoria curada (ver §5) ou null
  notif_status TEXT NOT NULL DEFAULT 'nao_aplicavel'
    CHECK (notif_status IN ('nao_aplicavel','pendente','aprovada','enviada','descartada','erro')),
  notif_texto  TEXT,                          -- mensagem final enviada/a enviar (editável na fila)
  notif_enviada_em TIMESTAMPTZ,
  notif_aprovada_por UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_movimento_processo_hash ON processo_movimentos (processo_id, raw_hash);
CREATE INDEX IF NOT EXISTS idx_movimentos_processo ON processo_movimentos (processo_id, data_hora);
CREATE INDEX IF NOT EXISTS idx_movimentos_notif ON processo_movimentos (notif_status) WHERE notif_status IN ('pendente','aprovada');

-- Config por CLIENTE: modo de aviso de movimentação
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS aviso_movimentacao TEXT NOT NULL DEFAULT 'desligado'
    CHECK (aviso_movimentacao IN ('desligado','fila','automatico'));

-- RLS padrão do repo
ALTER TABLE processos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE processo_movimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_processos ON processos
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_isolation_processo_movimentos ON processo_movimentos
  USING (processo_id IN (SELECT id FROM processos WHERE tenant_id = get_user_tenant_id()));
```

## 4. Sync (módulo `src/lib/processos/sync.ts`)

1. Para cada `processos.situacao='ativo'` do tenant: `buscarProcessoPorNumero(tribunal_alias, numero_cnj)` (timeout 12s; a API oscila e pode demorar ~7s — **concorrência ≤ 3** e teto de tempo por execução; o que não couber fica para o dia seguinte, ordenar por `ultima_sincronizacao ASC`).
2. **Delta por `raw_hash`** (md5 do JSON do movimento): insere só os novos (índice único garante idempotência — `on conflict do nothing`).
3. Para os novos: classifica a **categoria** (mapa TPU §5, por `codigo` com fallback por `nome`) e gera **resumo_ia em lote** (1 chamada `completionJSON` por processo com a lista dos movimentos novos → array de resumos; tom: 1 frase factual, sem juridiquês, sem opinião; ex.: `Trânsito em julgado` → "A decisão se tornou definitiva — não cabe mais recurso").
4. Atualiza capa/situação: movimento de categoria `arquivamento` ⇒ sugerir `situacao='encerrado'` (marcar automaticamente; a UI permite reabrir).
5. **Notificação:** para cada movimento novo com categoria ∈ `tenants.config.processos_notificar` e cliente com `aviso_movimentacao != 'desligado'`:
   - monta `notif_texto` (template curto: saudação + resumo_ia + "Qualquer dúvida, responda por aqui" + assinatura do escritório);
   - `fila` → `notif_status='pendente'` (aparece na fila de aprovação);
   - `automatico` → `notif_status='aprovada'` e envia na hora (§6); sucesso ⇒ `enviada`, falha ⇒ `erro` (retry no próximo sync).
6. Roda dentro do cron existente **`/api/cron/funil-consultas`** (chamar `sincronizarProcessos()` após a lógica do funil; try/catch isolado para um não derrubar o outro; `maxDuration` já é do handler — conferir folga). Logar `logger.info('processos.sync', {processos, novosMovimentos, notificacoes})`.
7. **Sync imediato** também ao cadastrar o processo (snapshot inicial completo — no cadastro, os movimentos históricos entram com `notif_status='nao_aplicavel'`: **nunca notificar retroativo**).

## 5. Categorias curadas (mapa TPU → categoria; `src/lib/processos/categorias.ts`)

| Categoria (slug) | Exemplos de movimento (nome/código TPU) | Default notificável? |
|---|---|---|
| `sentenca` | Procedência, Improcedência, Procedência em Parte, Homologação, Extinção | ✅ |
| `transito_julgado` | Trânsito em julgado | ✅ |
| `audiencia` | Audiência designada/realizada/cancelada | ✅ |
| `expedicao_alvara` | Expedição de documento [Alvará] (complemento) | ✅ |
| `decisao_despacho` | Outras Decisões, deferimento/indeferimento, Mero expediente | ❌ |
| `redistribuicao` | Redistribuição, Incompetência, Remessa | ❌ |
| `arquivamento` | Definitivo, Arquivamento | ✅ |
| `recurso` | Apelação, Agravo, Embargos (recebimento/remessa 2º grau) | ✅ |
| `movimentacao_comum` | Conclusão, Juntada, Petição, Publicação, Decurso de Prazo, Confirmada… | ❌ |

O Opus deve preencher os códigos TPU reais (estão no `codigo` de cada movimento do DataJud; usar o caso-exemplo + tabela TPU/CNJ como referência) e manter fallback por regex no `nome`. Defaults acima = sugestão inicial de `config.processos_notificar`; a UI de Configurações permite ao escritório marcar/desmarcar.

## 6. Envio WhatsApp (SIMAS → ai-attendant → Evolution)

**Por que não direto na Evolution:** o ai-attendant pausa a IA quando vê `fromMe` com `key.id` fora de `session.botIds` (acharia que um humano assumiu). O envio passa pelo bot para registrar o id.

1. **ai-attendant** (repo omnichannel — `git pull --ff-only` antes; coordenar com a outra sessão): novo endpoint `POST /notify` `{ telefone, texto }` autenticado por header `X-Notify-Token` (env nova `NOTIFY_TOKEN` no `ai.env`): normaliza o telefone → jid; escolhe a instância pelo **DDD** (47/48/49 → `whatsapp-sc`; demais → `whatsapp-df`; fallback `INSTANCE`); `sendText`; registra `sent.id` em `session.botIds` (via `getSession`, sem despausar sessão pausada); responde `{ok, id}`. **Node puro, sem deps; não tocar no `prompt.txt` neste ponto.**
2. **Caddyfile** (mesmo repo): sob `agenda.apoiojuridicodf.adv.br`, adicionar path-route `handle /notify* { @tok header X-Notify-Token "<valor>" ; reverse_proxy @tok ai-attendant:3000 ; respond 403 }` (seguir o padrão do X-Sched-Token; **sem DNS novo**).
3. **SIMAS**: `src/lib/processos/notificar.ts` — POST para `PROCESSOS_NOTIFY_URL` com `PROCESSOS_NOTIFY_TOKEN` (envs novas na Vercel), timeout 5s, 1 retry; `logAudit('processo.notificacao_enviada', resourceType:'processo', metadata:{movimento_id, cliente_id})`.
4. **Envs** (paradas do dono): `NOTIFY_TOKEN` no VPS (`ai.env`) = `PROCESSOS_NOTIFY_TOKEN` na Vercel; `PROCESSOS_NOTIFY_URL=https://agenda.apoiojuridicodf.adv.br/notify`.

## 7. Rotas (SIMAS)

| Rota | Auth | Função |
|---|---|---|
| `POST /api/clientes/[id]/processos` | sessão | valida DV CNJ (`validarNumeroCNJ`), resolve `aliasDataJud`, consulta DataJud (best-effort), cria processo + snapshot de movimentos + resumos (batch IA); 409 se número já existe no tenant |
| `GET /api/clientes/[id]/processos` | sessão | lista processos do cliente com último movimento |
| `GET /api/processos/[id]` | sessão | capa + timeline (movimentos ordenados, resumo_ia + nome técnico + íntegra sob demanda) |
| `DELETE /api/processos/[id]` | sessão (admin/advogado) | remove vínculo (cascade nos movimentos) + `logAudit` |
| `PATCH /api/processos/[id]` | sessão | situacao/apelido |
| `GET /api/processos/notificacoes` | sessão (admin/advogado) | fila: movimentos `pendente` (com notif_texto editável) |
| `POST /api/processos/notificacoes/[movimentoId]` | sessão (admin/advogado) | `{acao:'aprovar'\|'descartar', texto?}` — aprovar ⇒ envia (§6) e marca `enviada`; registrar `notif_aprovada_por` |
| `GET /api/integracao/processos/by-phone/[telefone]` | `x-simas-token` (reusar `autorizadoIntegracao`) | p/ o bot (Lote 3): match cliente **ativo** por `mesmoTelefone` → processos + últimos 5 movimentos (só `resumo_ia`, nome, data; **nunca** dados de outros clientes; 200 `{ok:false}` sem match) |

Rotas de integração ficam sob `/api/integracao/*` → **adicionar `'/api/integracao'` ao array `rotasApiAutonomas` do middleware** (`src/lib/supabase/middleware.ts`) — senão o middleware redireciona para /login (lição da Fase 4).

## 8. Telas

1. **Cliente** (`clientes/[id]`): seção **Processos** — cadastrar por número CNJ (máscara + validação DV; erro claro se DV inválido), lista com classe/órgão/último andamento (resumo_ia) + badge situação; clique → timeline completa (resumo em destaque, nome técnico secundário, "ver íntegra" expande o raw). Padrões visuais do repo (Cards, Badge, dark-mode via tokens).
2. **Cliente → editar**: campo **"Avisos de movimentação ao cliente"**: Desligado (default) / Fila de aprovação / Automático — com texto explicativo curto (LGPD: enviado ao WhatsApp do cadastro).
3. **Configurações** (aba existente): **"Movimentações notificáveis"** — checkboxes das categorias (§5), salvas em `tenants.config.processos_notificar` (rota PATCH nova ou reuso do padrão de config existente; admin/advogado).
4. **Fila de aprovação**: página `/processos/notificacoes` (ou seção no dashboard — seguir o padrão do checklist existente): cards com cliente, processo, movimento, texto proposto (editável), botões Aprovar & enviar / Descartar. Badge com contagem de pendentes no dashboard.

## 9. Bot (Lote 3 — ai-attendant, coordenar com a outra sessão)

1. Tool nova `consultar_andamento` (sem params obrigatórios): chama `GET {SIMAS_URL}/api/integracao/processos/by-phone/{number}` com `x-simas-token` (envs já existem no VPS). Retorno com processos+resumos → o modelo responde em linguagem natural; `{ok:false}` → segue o fluxo atual (qualificar/transferir).
2. `prompt.txt`: exceção controlada à regra 7 — pode informar **andamento factual** ao cliente cujo telefone bateu (dados vêm da ferramenta), sem interpretação jurídica/valores/estratégia, sempre oferecendo atendente. **PARADA: mostrar o texto exato ao dono antes do push.**
3. Regras de coordenação: `git pull --ff-only` antes; `node --check` local nos DOIS arquivos alterados; sessão é serializada (não guardar objetos vivos); não mexer no gate de leads (`contactState`).

## 10. Limitações conhecidas (documentar em `docs/processos.md`)

- **DataJud não é tempo real** (atualização em lote; dias de atraso) — avisos são de acompanhamento, não de urgência/prazo.
- **Segredo de justiça não aparece** (comum em família) — processo cadastrado que nunca acha nada deve exibir aviso na UI ("não localizado no DataJud — pode estar em segredo de justiça").
- **Sem inteiro teor** das decisões (só o registro do movimento); anexo manual de PDF fica como evolução.
- WhatsApp via Evolution (não-oficial): volume baixo e para clientes da casa — risco aceito no piloto.

## 11. Lotes (ordem de execução)

| Lote | Conteúdo | Testes | Parada |
|---|---|---|---|
| **1** | Migration 043 (aplicar em prod) + `lib/processos/` (sync, categorias, resumos IA) + rotas de CRUD/timeline + seção Processos na tela do cliente + sync dentro do cron `funil-consultas` | unitários: dedup por hash, classificação de categorias, validação CNJ na rota; teste manual com o caso-exemplo | 🛑 dono: recadastrar a **Marta** como cliente (nome+telefone), vincular `0009008-28.2025.8.16.0026` e validar timeline/resumos |
| **2** | Config cliente (`aviso_movimentacao`) + config tenant (categorias) + fila de aprovação + envio (ai-attendant `/notify` + Caddyfile + `lib/processos/notificar.ts`) + auditoria | fila: aprovar/descartar/editar; idempotência (nunca 2x o mesmo movimento); retroativo nunca notifica | 🛑 dono: criar `NOTIFY_TOKEN` (VPS) = `PROCESSOS_NOTIFY_TOKEN` (Vercel) + teste de envio real controlado |
| **3** | Bot: tool `consultar_andamento` + endpoint by-phone + `prompt.txt` | ponta a ponta com telefone de teste cadastrado | 🛑 dono: aprovar o texto do prompt ANTES do push; teste real pelo WhatsApp |

**Definition of Done:** Marta cadastrada → processo vinculado → timeline com resumos no SIMAS → movimento novo simulado gera item na fila → aprovação envia WhatsApp real → cliente pergunta "como está meu processo?" e o bot responde do banco. Sem regressão no funil/atendimento.

## 12. Fora de escopo (v2)

Inteiro teor/anexo automático de decisões · captura em tribunais fora do DataJud · aviso por e-mail/SMS · múltiplos telefones por cliente · painel de prazos a partir de movimentos · notificação em tempo real (push do tribunal não existe na API pública).

---

*Preparado pelo Fable em 2026-07-07, com teste ao vivo do DataJud (caso-exemplo TJPR). Para executar: apontar o Opus para este arquivo e pedir a execução dos lotes 1 → 3, respeitando as paradas.*
