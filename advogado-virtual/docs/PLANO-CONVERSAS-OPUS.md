# PLANO — Módulo Conversas (atendimento WhatsApp no SIMAS, v1 = cliente fino do Chatwoot)

> **Origem:** spec externa (`prompt-atendimento-simas-v1-variante-a.md`) **validada e adaptada ao SIMAS real** pelo Fable (2026-07-09). Veredicto: **a Variante A é a escolha certa para a v1** (ver §1) — com as correções do §2. Execução orquestrada (Fable orquestra, Opus implementa), 3 lotes com paradas.

## 1. Veredicto das variantes (reavaliação)

| Variante | O que é | Avaliação |
|---|---|---|
| **A — cliente fino + relay + polling** (esta) | SIMAS lê/escreve via relay no VPS; zero persistência de conversa no SIMAS | ✅ **MELHOR para v1.** Não-regressão máxima (bot/Chatwoot intactos), zero duplicação de dado sigiloso (LGPD), menor superfície, entrega rápida. Custo: latência de polling (30s/5s) e dependência do VPS — aceitáveis no piloto, e o Chatwoot segue como fallback. |
| B — espelho no Supabase + webhooks + Realtime | Chatwoot empurra eventos; SIMAS persiste conversas/mensagens | ❌ para v1: reconciliação, migrações, duplicação de dado sensível, superfície de regressão grande. É a evolução natural da v2 **quando** houver vínculo conversa↔cliente↔processo (aí o espelho paga o custo). Os contratos do relay já deixam essa porta aberta. |
| C — Chatwoot embutido (iframe/SSO) | Incorporar o painel pronto | ❌ UX não integrada, sessão dupla, o Caddy já bloqueia `api_access_token` no público; não constrói nada reutilizável. |

**Gatilho para migrar A→B no futuro:** precisar de vínculo com processos/clientes, busca no histórico ou notificação em tempo real.

## 2. Correções da spec vs SIMAS/VPS reais (li o código — não são suposições)

1. **Sem Prisma.** SIMAS = Next.js 15 App Router + Supabase (SQL migrations). Irrelevante na prática: a v1 não cria NENHUMA tabela no SIMAS (mantido).
2. **Nome do módulo: "Conversas", não "Atendimento".** `atendimentos` JÁ EXISTE no SIMAS (registro de casos — tabela, rotas `/api/atendimentos/*`, telas). Usar página `/conversas` e rotas `/api/conversas/*` para não colidir.
3. **A alegação do "bug do /notify que pausa o bot" NÃO bate com o código atual**: o handler `/notify` (server.js) registra `sent.id` em `session.botIds` e comenta explicitamente "não altera s.paused" — o eco `fromMe` desse id é reconhecido como do bot e não pausa. A Fase 0 AUDITA e documenta empiricamente (pode ter havido confusão com outro fluxo), mas **não corrigir preventivamente o que não está quebrado**.
4. **Identidade por e-mail — LACUNA OPERACIONAL REAL (parada do dono):** usuários SIMAS hoje usam e-mails pessoais (argermano@gmail.com, jonathan.nardes19@…, danidamke@…, shanasism@…, gerander@…); só katlen@ e blumenau@ são do domínio. Agentes Chatwoot conhecidos: katlen@apoiojuridicodf.adv.br e atendimento@apoiojuridicodf.adv.br. **Só a Katlen casa hoje.** Para cada pessoa que vai responder pelo SIMAS, o agente Chatwoot precisa existir com o MESMO e-mail do usuário SIMAS (criar/ajustar agentes no admin do Chatwoot). Sem isso, a pessoa fica em modo leitura (comportamento correto da spec).
5. **Sem subdomínio novo (sem DNS):** o relay é exposto por **path-route no Caddy** em domínio existente — `agenda.apoiojuridicodf.adv.br/relay/*` (`handle_path` remove o prefixo) — mesmo padrão do `/notify` da Fase 5. Menos parada, mesma segurança (Bearer validado no app; o Caddy só roteia).
6. **CI do VPS:** `deploy-pull.sh` recreia SÓ `scheduler` e `ai-attendant`. Adicionar `simas-relay` à lista (o arquivo é do repo e roda no pull). O Caddy NÃO é recriado pelo CI → reload é parada única do dono (igual fizemos no /notify).
7. **Relay em Node PURO** (http nativo, sem Express/Fastify): padrão do repo omnichannel (ai-attendant/scheduler são Node puro em node:20-alpine, sem npm install). Cofre de tokens: **JSON cifrado (AES-256-GCM, chave em `RELAY_ENCRYPTION_KEY`)** em volume Docker próprio (`relay_data:/data`) — 2-7 agentes não justificam SQLite.
8. **Fase 0 não é executável do Mac**: `http://chatwoot-rails:3000` só existe na rede Docker do VPS, e o domínio público bloqueia `api_access_token`. A descoberta roda **dentro do container ai-attendant** (node:20 tem fetch; CHATWOOT_URL/TOKEN já estão no env) via script que o DONO cola no terminal do hPanel (§4). Sem expor nada novo.
9. **E-mail da sessão SIMAS:** `getAuthContext` → `usuario.email` (tabela users). O proxy injeta `X-Simas-User-Email` server-side (spec mantida). Rotas com `dynamic='force-dynamic'` + `Cache-Control: no-store`.
10. Mantidos integralmente: princípio de não-regressão; leitura com token admin / escrita SÓ com token pessoal (428 `AGENT_NOT_CONNECTED`, sem fallback admin); nota privada nunca ao WhatsApp; auto-assign on reply; sem normalização de telefone; sem tabelas espelho; anexos só exibição; polling com Page Visibility; envio otimista sem perder texto; visibilidade total na v1 isolada num service único.

## 3. Arquitetura v1

```
SIMAS (Vercel) ──sessão──> /api/conversas/* (proxy; injeta RELAY_TOKEN + X-Simas-User-Email)
                                │ HTTPS
                                ▼
Caddy: agenda.apoiojuridicodf.adv.br/relay/* ──> simas-relay:3000 (Node puro, rede Docker)
                                │ api_access_token (interno)
                                ▼
                Chatwoot (http://chatwoot-rails:3000, account 1)
   leitura: CHATWOOT_TOKEN (admin) · escrita: token pessoal do agente (cofre cifrado em relay_data)
```

## 4. FASE 0 — Descoberta empírica (PARADA INICIAL do dono)

Script pronto (o orquestrador entrega o bloco para colar no terminal do hPanel): roda `docker compose exec -T ai-attendant node -e '…'` e, usando os envs já presentes no container, imprime com tokens REDIGIDOS:
- versão do Chatwoot; `GET /conversations` (paginação, filtro status/inbox, ids das inboxes DF/SC); `GET /messages` (shape, sender, anexos, paginação); `GET /profile` com token admin (e instrução p/ repetir com token pessoal); endpoints de assignment e toggle_status da versão; rate limits observados (headers).
- Testes de ESCRITA só se `CONV_ID` (conversa de teste do dono) for informado: outgoing via API (chegou no WhatsApp? autoria? pausou o bot?) e `private: true` (ficou só no Chatwoot? NÃO pausou?).
- Auditoria da pausa: documentar o mecanismo real (fromMe + key.id ∉ botIds) e validar a alegação do §2.3.

**Checkpoint:** Opus consolida a saída em `docs/chatwoot-api-descoberta.md`. Se algo divergir dos contratos do §5, ajustar ANTES do Lote 1.

## 5. Lote 1 — Relay no VPS (repo `argermano/omnichannel`, pasta `relay/`)

- `relay/server.js` (Node puro, porta 3000): auth Bearer `RELAY_TOKEN` em tudo (+ rate limit simples em memória); e-mail do header `X-Simas-User-Email` (case-insensitive).
- **Cofre**: `/data/agents.json` cifrado AES-256-GCM; `POST /agents/register` (valida `GET /profile` com o token recebido; e-mail retornado ≡ header, senão 409 "token pertence a outro agente"), `GET /agents/me`, `DELETE /agents/me`; revalidação diária (setInterval 24h) marcando `status:'invalido'` nos 401 (sem apagar).
- **Negócio** (contratos estáveis, §67-76 da spec, mantidos): `GET /conversations` (id, contato nome+telefone como está, inbox DF/SC, status, assignee, última msg trecho+ts, não-lidas se houver), `GET /conversations/:id/messages?before=`, `POST /conversations/:id/messages {content, private}` (token PESSOAL; sem token → 428 `AGENT_NOT_CONNECTED`; auto-assign se sem assignee; NUNCA reatribuir se assignee ≠ remetente), `POST /conversations/:id/assign {self|agentId}` (token de quem transfere; validar destino ativo), `GET /agents` (admin, cache 5 min, campo `conectado`), `POST /conversations/:id/toggle-status`, `GET /attachments?url=` (SÓ se a Fase 0 exigir; allowlist host interno), `GET /healthz` (conectividade Chatwoot). Logs SEM conteúdo (ids/rota/status/latência); timeout 10s + 1 retry; erros do Chatwoot repassados com código, nunca engolidos.
- **Infra**: serviço `simas-relay` no docker-compose (node:20-alpine, volume `relay_data:/data`, envs `RELAY_TOKEN`, `RELAY_ENCRYPTION_KEY`, `CHATWOOT_URL=http://chatwoot-rails:3000`, `CHATWOOT_TOKEN`); Caddyfile: bloco `handle_path /relay/*` em `agenda.apoiojuridicodf.adv.br` → `reverse_proxy simas-relay:3000`; `deploy-pull.sh`: incluir `simas-relay` no `--force-recreate` + `node --check relay/server.js` como portão; README do relay (envs, runbook: não envia → /agents/me → /healthz → Chatwoot).
- **Testes**: `node --check` + suite `node:test` para as funções puras (cifra/decifra, validação de e-mail, montagem de shapes) rodável no CI local do agente.

**Checkpoint (curl, eu executo o que der do Mac via URL pública; resto do dono):** 401 sem Bearer; /healthz ok; registro com e-mail divergente → 409; registro válido (dono cola token) → agentId; POST message com autoria correta + entrega WhatsApp + bot pausado; nota privada invisível no WhatsApp e sem pausa; 428 sem token.
**Paradas do dono no Lote 1:** setar `RELAY_TOKEN`/`RELAY_ENCRYPTION_KEY` no VPS; `docker compose up -d simas-relay caddy` (única vez); autorizar o push (deploy de produção); alinhar §2.4 (criar agentes Chatwoot com e-mail = usuário SIMAS para quem for atender).

## 6. Lote 2 — SIMAS (proxies + UI)

- **Proxies** `/api/conversas/*` (sessão via getAuthContext; injeta Bearer + `X-Simas-User-Email: usuario.email`; `no-store`; repassa códigos de erro do relay — 428 vira `{code:'AGENT_NOT_CONNECTED'}`): `GET /api/conversas`, `GET /api/conversas/[id]/mensagens`, `POST /api/conversas/[id]/mensagens`, `POST /api/conversas/[id]/atribuir`, `POST /api/conversas/[id]/status`, `GET /api/conversas/agentes`, `GET /api/conversas/conexao` + `POST` (registrar token) + `DELETE`. Envs Vercel: `RELAY_URL`, `RELAY_TOKEN`.
- **Página `/conversas`** (todos os usuários autenticados; item na sidebar, ícone MessagesSquare): lista à esquerda (abas Abertas/Resolvidas, filtro inbox DF/SC, busca local, polling 30s SÓ com aba visível) + thread (autoria clara cliente/bot/agente, anexos: imagem inline/áudio player/PDF link conforme Fase 0, "carregar anteriores", polling 5s com aba visível + botão atualizar) + composer (mensagem/nota interna com distinção FORTE amarela "nota interna — o cliente não vê"; envio otimista enviando→confirmada→falhou com "tentar de novo", texto NUNCA se perde) + posse (sem dono → responder assume; de outro → aviso "Atribuída a {nome} — assumir?" antes de liberar) + transferir (seletor de `GET /agents`, aviso "ainda não conectado" nos sem token) + resolver/reabrir. Mobile: lista/thread empilhadas.
- **Página "Conectar meu atendimento"** (em Configurações): passo a passo (Chatwoot → Perfil → Access Token → colar), estados não conectado/conectado como {nome}/token inválido, desconectar. **O token vai direto SIMAS→relay e não é persistido no SIMAS.**
- **Degradação**: relay fora → banner "Atendimento indisponível — use o Chatwoot" (link público); erros de polling sem toast em loop → indicador "desatualizado desde HH:MM"; sem token → thread em leitura + banner conectar.
- Service único de listagem (futura regra de visibilidade num só lugar). LGPD: nada de conteúdo em logs; sem cache.
- **Testes** (vitest): parser dos shapes (payloads REAIS da Fase 0 como fixtures), estados do composer, tratamento 428/degradação.

**Checkpoint final (dono, ponta a ponta real):** cliente manda WhatsApp → bot responde → advogada vê no SIMAS, assume, responde → chega no WhatsApp com autoria correta → bot pausa → nota interna não vaza → transferência reflete no Chatwoot → usuário sem token lê mas não escreve.

## 7. Lotes e paradas (resumo)

| Lote | Conteúdo | Parada |
|---|---|---|
| **0** | Script de descoberta (dono cola no hPanel) → `docs/chatwoot-api-descoberta.md` | 🛑 dono roda o script e devolve a saída |
| **1** | Relay completo no repo omnichannel + compose + Caddy + CI + README | 🛑 dono: envs VPS + `up -d simas-relay caddy` + autorizar push + alinhar e-mails dos agentes |
| **2** | Proxies + páginas no SIMAS + testes + review adversarial | 🛑 dono: conectar token da Katlen e validar ponta a ponta |

Cada lote: implementação Opus em paralelo com propriedade exclusiva de arquivos → portão de integração → review adversarial (invariantes: nunca token admin em escrita; nota privada nunca vaza/pausa; texto do composer nunca se perde; nada quebra o fluxo bot→Chatwoot→handoff) → correção → portão final do orquestrador → push autorizado.

## 8. Fora de escopo (v1 — não preparar "por precaução")

Vínculo com processos/clientes; normalização de telefone; espelho/webhooks/Realtime; envio de anexos (botão desabilitado "em breve"); presença/typing/macros; permissões por usuário (v1 = todos veem tudo); mudanças no ai-attendant além da auditoria (se a auditoria da Fase 0 revelar pré-requisito, PARAR e reportar ao dono).

## 9. Riscos aceitos (documentar no README)

Polling = latência de até 30s na lista/5s na thread; VPS único ponto de falha do módulo (fallback: painel Chatwoot); identidade depende da disciplina "mesmo e-mail" (runbook cobre); tokens pessoais vivem só no VPS (perda do volume ⇒ reconectar agentes — aceitável).
