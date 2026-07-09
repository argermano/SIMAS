# Prompt para Claude Code — Atendimento WhatsApp no SIMAS v1 (Variante A: cliente fino do Chatwoot)

Copie tudo abaixo da linha. O trabalho envolve DOIS ambientes: o VPS (Docker: Chatwoot, Evolution API, ai-attendant, Caddy) e o repositório do SIMAS (Next.js App Router, Prisma, Supabase, Vercel). Execute em fases, com checkpoint validado ao final de cada uma.

---

## Contexto

Escritório de advocacia. Stack no VPS (Docker): **Evolution API** conecta 2 números de WhatsApp (DF e SC); um bot **ai-attendant** (Node + Claude) faz o primeiro atendimento; a Evolution espelha as conversas no **Chatwoot self-hosted** (account id 1), atrás do **Caddy** (domínio público `atendimento.apoiojuridicodf.adv.br`, URL interna `http://chatwoot-rails:3000`). Quando um humano responde pelo Chatwoot, um eco `fromMe` pausa o bot (handoff). O Caddy **remove o header `api_access_token`** no caminho público — integrações internas usam a URL interna. Token admin do Chatwoot em `CHATWOOT_TOKEN` (env, nunca commitar).

O **SIMAS** é o sistema do escritório (Next.js serverless na Vercel, Prisma, Supabase), com autenticação própria de usuários.

## Objetivo desta v1 (escopo deliberadamente enxuto)

Emular o atendimento do Chatwoot dentro do SIMAS: **ler conversas e mensagens, e responder — nada mais.**

- O SIMAS é um CLIENTE FINO do Chatwoot: não armazena conversas nem mensagens em banco próprio. Toda leitura e escrita passa por um relay no VPS que fala com a API do Chatwoot.
- Atualização por POLLING (sem webhooks, sem tabelas espelho, sem Supabase Realtime, sem reconciliação nesta versão).
- SEM vínculo com processos/clientes nesta versão. A conversa exibe o contato como o Chatwoot o conhece (nome + telefone). Integrações com processos virão em versão futura — não crie nada disso agora.

**Princípio inegociável:** nada pode quebrar o fluxo atual (bot → Chatwoot → handoff humano). O painel do Chatwoot continua funcionando normalmente como fallback. Em caso de dúvida entre elegância e não-regressão, escolha não-regressão.

## Bugs conhecidos a não reintroduzir

1. **Pausa indevida do bot:** o endpoint `/notify` do ai-attendant hoje pausa o bot por engano. Antes de qualquer código, audite a lógica de pausa no ai-attendant e documente qual evento a dispara. Requisitos: mensagem `outgoing` enviada via API DEVE pausar o bot (é atendimento humano); **nota privada (`private: true`) NUNCA pode pausar o bot nem chegar ao WhatsApp**.
2. **9º dígito:** telefones no Chatwoot às vezes vêm sem o 9º dígito. Nesta v1 não há matching (o SIMAS só exibe o que vem do Chatwoot), então NÃO implemente normalização — apenas exiba o telefone como está. Não crie dependência de formato de telefone em nenhuma lógica.

---

## FASE 0 — Descoberta e validação empírica (obrigatória, sem código de produção)

1. Identifique a versão do Chatwoot em execução e consulte a documentação da API correspondente. Valide o contrato REAL na rede interna do VPS (`http://chatwoot-rails:3000`) com tokens reais:
   - `GET /api/v1/accounts/1/conversations` — listagem, paginação, filtro por status (open/resolved) e por inbox; identifique como distinguir as inboxes DF e SC.
   - `GET .../conversations/{id}/messages` — shape das mensagens, paginação para histórico, formato dos anexos, como vem o `sender` (nome do agente/contato/bot).
   - `POST .../conversations/{id}/messages` — com `message_type: "outgoing"` e com `private: true`.
   - `GET /api/v1/profile` — autenticado com token PESSOAL de um agente: confirme que retorna e-mail e id do agente (base da conciliação de identidade).
   - `POST .../conversations/{id}/assignments` (ou endpoint equivalente da versão) — atribuir agente à conversa.
   - `POST .../conversations/{id}/toggle_status` — abrir/resolver.
2. Teste na ponta: mensagem outgoing via API com token de agente chegou no WhatsApp via Evolution? Autoria correta no Chatwoot? O eco pausou o bot? A nota privada ficou só no Chatwoot (não foi ao WhatsApp, não pausou o bot)?
3. Anexos: as URLs de mídia (imagem/áudio/PDF) retornadas pela API são carregáveis pelo browser via domínio público (através do Caddy)? Se exigirem sessão/autenticação, anote: o relay precisará proxiar anexos (endpoint `GET /attachments?url=...` com allowlist do host do Chatwoot).
4. Documente rate limits observados/configurados do Chatwoot (relevante para o polling).

**Checkpoint:** produza `docs/chatwoot-api-descoberta.md` com tudo validado, incluindo o mecanismo exato da pausa do bot e o resultado do teste de anexos. Só então prossiga.

## FASE 1 — Relay no VPS (auth + identidade)

Serviço pequeno, always-on, container Docker próprio (Node — Fastify ou Express), na mesma rede Docker do Chatwoot. Exposto pelo Caddy em subdomínio dedicado (ex.: `relay.apoiojuridicodf.adv.br`) com TLS.

### Autenticação de entrada
- Toda requisição exige `Authorization: Bearer {RELAY_TOKEN}` (token longo aleatório; env na Vercel e no relay). Sem token → 401. Rate limiting básico. Nunca token em querystring.
- O SIMAS envia também `X-Simas-User-Email: {email do usuário logado}` — o backend do SIMAS injeta esse header a partir da SESSÃO autenticada; jamais aceitar e-mail vindo do frontend.

### Identidade dos agentes (conciliação SIMAS ↔ Chatwoot)
Regra do sistema: cada pessoa tem usuário no SIMAS e agente no Chatwoot com o MESMO E-MAIL. O relay mantém o cofre de tokens:

- Armazenamento local no VPS (SQLite ou arquivo JSON cifrado — escolha o mais simples e robusto): `{ email, chatwootAgentId, agentName, tokenCifrado, validadoEm, status }`. Cifrar com chave em env (`RELAY_ENCRYPTION_KEY`). Tokens de agente NUNCA saem do VPS e NUNCA são armazenados no banco do SIMAS.
- `POST /agents/register` — body `{ token }` + header do e-mail do usuário. O relay valida chamando `GET /api/v1/profile` do Chatwoot com o token recebido e SÓ aceita se o e-mail retornado for idêntico ao `X-Simas-User-Email` (case-insensitive). Se divergir, rejeitar com mensagem explícita ("este token pertence a outro agente"). Se aceito, gravar cifrado e retornar `{ agentId, agentName }`.
- `GET /agents/me` — status do vínculo do usuário atual (conectado/não conectado/token inválido).
- `DELETE /agents/me` — remover o próprio token.
- Healthcheck diário (cron interno do relay): revalidar cada token via `/profile`; marcar `status: invalido` os que falharem (401), sem apagar. O status aparece em `GET /agents/me`.

### Regras de uso de token nas operações
- **Leitura** (listar conversas, ler mensagens): usar `CHATWOOT_TOKEN` (admin) — leitura não tem autoria.
- **Escrita** (enviar mensagem, nota privada, atribuir, mudar status): usar EXCLUSIVAMENTE o token pessoal do agente resolvido pelo e-mail do header. Se o usuário não tiver token válido registrado → HTTP 428 com código de erro `AGENT_NOT_CONNECTED`. É PROIBIDO cair no token admin como fallback de escrita — a rastreabilidade de autoria é requisito do escritório.
- Ao enviar mensagem em conversa SEM assignee, o relay atribui a conversa ao agente remetente na sequência (auto-assign on reply). Se já tiver assignee diferente, NÃO reatribuir automaticamente (a UI cuida disso com ação explícita).

### Endpoints de negócio (proxy fino sobre a API do Chatwoot, contratos estáveis para o SIMAS)
- `GET /conversations?status=&inbox=&page=` — lista com: id, contato (nome, telefone como está), inbox, status, assignee (id+nome), última mensagem (trecho + timestamp), contagem de não lidas se a API fornecer.
- `GET /conversations/:id/messages?before=` — mensagens com id, direção, privada, conteúdo, anexos, sender (tipo + nome), timestamp.
- `POST /conversations/:id/messages` — body `{ content, private }`.
- `POST /conversations/:id/assign` — body `{ self: true }` (assumir para si) OU `{ agentId }` (transferir para outro agente). A transferência é feita com o token do agente que está transferindo (autoria da ação registrada no Chatwoot); qualquer usuário conectado pode transferir. Validar que o agentId de destino existe e está ativo antes de chamar o Chatwoot.
- `GET /agents` — lista dos agentes ativos da conta (id + nome + e-mail), obtida via token admin (`GET /api/v1/accounts/1/agents`) com cache em memória de ~5 min. Serve para popular o seletor de transferência na UI; indicar também quais desses agentes já têm token registrado no relay (campo `conectado: true/false`).
- `POST /conversations/:id/toggle-status`.
- `GET /attachments?url=` — apenas se a Fase 0 mostrou necessidade; allowlist restrita ao host interno do Chatwoot.
- `GET /healthz` — inclui conectividade com o Chatwoot.
- Logs sem conteúdo de mensagem (ids, rotas, status, latência). Timeout e retry (1 retentativa) nas chamadas ao Chatwoot; erros do Chatwoot repassados com código próprio, nunca engolidos.

**Checkpoint:** via curl — registrar um agente com validação de e-mail funcionando (teste também o caso de e-mail divergente); enviar mensagem com autoria correta no Chatwoot; confirmar entrega no WhatsApp; confirmar pausa do bot; confirmar nota privada invisível no WhatsApp; confirmar 428 para usuário sem token.

## FASE 2 — UI de atendimento no SIMAS

Sem banco próprio de conversas: as rotas API do SIMAS (`/api/atendimento/*`) são proxies autenticados (sessão do SIMAS) que repassam ao relay injetando `RELAY_TOKEN` + e-mail da sessão. O frontend NUNCA fala com o relay diretamente.

### Página "Conectar meu atendimento" (configurações do usuário)
- Instruções curtas com passo a passo (entrar no Chatwoot → Perfil → Access Token → colar aqui) e campo para colar o token.
- Estados: não conectado / conectado como {agentName} / token inválido (reconectar). Ação de desconectar.

### Página "Atendimento"
- **Lista de conversas** (coluna esquerda): abas Abertas/Resolvidas, filtro por inbox (DF/SC), busca local pelo nome/telefone nos itens carregados. Cada item: contato, trecho da última mensagem, horário, badge do assignee, inbox. Polling a cada 30s — apenas com aba visível (Page Visibility API); pausar polling em aba oculta.
- **Thread** (área principal): mensagens com autoria clara (cliente / bot / nome do agente), horário, anexos (imagem inline, áudio com player, PDF/documento como link — usando o resultado da Fase 0 sobre URLs). Botão "carregar anteriores" para histórico. Polling da conversa aberta a cada 5s (só com aba visível); botão manual "atualizar".
- **Composer:** enviar mensagem e alternância para **nota interna** com distinção visual FORTE (fundo amarelo, rótulo "nota interna — o cliente não vê"). Envio otimista com estados: enviando → confirmada (apareceu no refetch) → falhou (manter o texto, ação "tentar de novo"; a mensagem digitada NUNCA se perde silenciosamente).
- **Identidade e posse:** topo da thread mostra o assignee. Conversa sem dono → responder assume automaticamente (feito pelo relay). Conversa de OUTRO agente → aviso "Atribuída a {nome} — assumir conversa?" com ação explícita antes de liberar o composer.
- **Transferir conversa:** ação "Transferir para..." no topo da thread, com seletor populado por `GET /agents` do relay. Agentes sem token conectado aparecem no seletor com aviso "ainda não conectado ao SIMAS" (a transferência para eles é permitida — eles atendem pelo Chatwoot —, mas o aviso evita surpresa). Após transferir, atualizar o assignee na tela e exibir confirmação. Se quem transfere não tiver token conectado, aplicar a mesma regra do composer (428 → modo leitura).
- **Visibilidade:** por decisão de produto desta v1, TODOS os usuários autenticados do SIMAS veem TODAS as conversas das duas inboxes (a leitura usa token admin). Não implementar filtros de permissão por usuário nesta versão, mas isolar a listagem em um service único para que uma futura regra de visibilidade (ex.: restringir por assignee) seja aplicada em um só lugar.
- **Usuário sem token conectado:** thread em modo leitura + banner "Conecte seu atendimento para responder" com link para a página de conexão (tratar o 428 do relay).
- **Degradação:** relay/Chatwoot inacessível → banner "Atendimento indisponível — use o Chatwoot" com link para `atendimento.apoiojuridicodf.adv.br`. Erros de polling não podem gerar toasts em loop; usar indicador discreto de "desatualizado desde HH:MM".
- Ações secundárias: resolver/reabrir conversa.

Siga o padrão visual e de componentes existente no SIMAS. Mobile: a página deve ser utilizável em tela estreita (lista e thread empilhadas com navegação entre elas).

**Checkpoint (fluxo real de ponta a ponta):** cliente manda WhatsApp → bot responde → advogado abre o SIMAS, vê a conversa, assume, responde → mensagem chega no WhatsApp com autoria correta → bot pausado → nota interna registrada sem vazar → transferência da conversa para outro agente refletida no Chatwoot → segundo usuário sem token consegue ler mas não responder.

## Segurança e LGPD

- Conteúdo de conversa é sigiloso (advocacia): todas as rotas `/api/atendimento/*` exigem sessão autenticada; sem cache público; headers `no-store` nas respostas.
- Nesta variante o SIMAS não persiste conversas — não crie tabelas de mensagens "para facilitar". Única persistência nova no SIMAS: nenhuma (o cofre de tokens vive no relay).
- Segredos apenas em env: `RELAY_TOKEN`, `RELAY_ENCRYPTION_KEY`, `CHATWOOT_TOKEN`. Nunca em código, log ou querystring.
- Não logar conteúdo de mensagens em nenhum serviço.

## Fora de escopo desta v1 (não implementar, não preparar "por precaução")

- Vínculo conversa↔cliente↔processo; normalização de telefone; tabelas espelho; webhooks; Supabase Realtime; reconciliação.
- Envio de anexos pelo SIMAS (receber/exibir sim; enviar fica para v2 — deixe apenas o botão desabilitado com tooltip "em breve").
- Presença/typing, respostas prontas, macros.
- Qualquer mudança no ai-attendant além da auditoria da lógica de pausa (se a auditoria revelar que a correção do bug do /notify é pré-requisito para a regra da nota privada, PARE e me reporte antes de mexer).

## Entrega

- Testes: registro de agente (e-mail confere / diverge / token inválido), regra de escrita sem fallback admin (428), parser das respostas do Chatwoot com payloads reais da Fase 0, componente de composer (estados otimistas).
- `docker-compose` atualizado com o relay + bloco do Caddyfile do subdomínio.
- README: variáveis de ambiente por ambiente, passo a passo para conectar um novo agente (criar agente no Chatwoot com o MESMO e-mail do SIMAS → copiar token → colar no SIMAS), e runbook de diagnóstico (mensagem não envia → checar /agents/me → checar /healthz → checar Chatwoot).
- Resumo final: o que foi validado empiricamente na Fase 0, decisões tomadas e divergências encontradas em relação a este plano.

Trabalhe fase por fase, rode lint e testes a cada etapa, e apresente cada checkpoint antes de avançar.
