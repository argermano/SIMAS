# PLANO — Módulo Agenda / Calendário (paridade Astrea)

Fonte da verdade para a orquestração. App em `advogado-virtual/`. App Router, TS strict,
Supabase multi-tenant (RLS por `get_user_tenant_id()`), Tailwind (tokens de tema, sem cor
hardcoded), `Date`+`Intl` (NÃO há date-fns nem lib de calendário — grade é própria).

## Objetivo
Tela `/agenda` estilo Astrea: grade **dia / semana / mês** que AGREGA, por pessoa e tipo,
itens de 3 fontes, com filtros ricos, e permite criar/editar Eventos/Prazos/Audiências. Os
**bots** também criam itens (agenda_eventos via token de integração). Modal de tarefa com
paridade (Comentários, Histórico, Publicação).

## Fontes de itens do calendário (agregação read-only + CRUD só de agenda_eventos)
1. **Tarefas** — tabela `tasks` (já existe): `due_date` (data no calendário), `priority`,
   `completed_at` (concluída), tags coloridas (`task_tags`/`task_tag_links`), `assignee_id`
   + `task_assignees` (envolvidos), `kanban_board_id/column_id`, `process_id`, `created_by`,
   `origin_reference` (vínculo publicação `publicacao:<id>`).
2. **agenda_eventos** — tabela NOVA (evento / prazo / audiência), CRUD completo.
3. **Consultas do bot** — `funil_leads` com `consulta_data IS NOT NULL`: `meet_url`,
   `consulta_formato`, `consulta_cancelada`, `nome`/cliente, `area`.

⚠️ INVARIANTE DO DONO: **prazo NUNCA é calculado automaticamente** — toda data de prazo é
manual (tarefa com `due_date` ou agenda_evento tipo `prazo` criados por humano). Nada no
código pode derivar/plotar um prazo sozinho a partir de publicação/processo.

## 1. Migração (novo arquivo — usar o PRÓXIMO número livre em supabase/migrations/, provável 046)
`agenda_eventos`:
- `id uuid pk default gen_random_uuid()`, `tenant_id uuid not null references tenants(id) on delete cascade`
- `tipo text not null check (tipo in ('evento','prazo','audiencia'))`
- `titulo text not null`, `descricao text`
- `inicio timestamptz not null`, `fim timestamptz`, `dia_todo boolean not null default false`
- `local text`
- `process_id` e `cliente_id`: FKs OPCIONAIS. **Verifique no migration de `tasks` (020) o alvo real de `process_id`** e use o MESMO (hoje `atendimentos(id)`); `cliente_id references clientes(id)`. `on delete set null`.
- `responsavel_id uuid references users(id) on delete set null`
- `visibilidade text not null default 'escritorio' check (visibilidade in ('escritorio','particular'))`
- `status text not null default 'a_concluir' check (status in ('a_concluir','concluida','cancelada'))`, `concluido_em timestamptz`
- `cor text default '#3b82f6'`
- `origin text not null default 'manual' check (origin in ('manual','bot'))`, `origin_reference text`
- `created_by uuid references users(id) on delete set null`, `created_at`, `updated_at` (default now())
- `agenda_evento_envolvidos (evento_id uuid references agenda_eventos(id) on delete cascade, user_id uuid references users(id) on delete cascade, primary key(evento_id,user_id))`
- Index: `idx_agenda_eventos_tenant_inicio on agenda_eventos(tenant_id, inicio)`.
- **RLS**: habilite RLS e crie policies de isolamento por tenant no mesmo padrão das outras tabelas (`tenant_id = get_user_tenant_id()`) para select/insert/update/delete. (A visibilidade `particular` é reforçada TAMBÉM na query da API — ver §3.)

`task_comments` (para a aba Comentários do modal de tarefa):
- `id uuid pk`, `tenant_id uuid not null references tenants(id) on delete cascade`
- `task_id uuid not null references tasks(id) on delete cascade`
- `autor_id uuid references users(id) on delete set null`, `conteudo text not null`, `created_at timestamptz default now()`
- Index `idx_task_comments_task on task_comments(task_id, created_at)`. RLS por tenant.

NÃO aplicar a migração pelo agente — só criar o arquivo. A aplicação em produção é do orquestrador.

## 2. Lib pura (src/lib/agenda/) — testável com Vitest
- `tipos.ts`: `FonteAgenda = 'tarefa'|'evento'|'prazo'|'audiencia'|'consulta'`; `StatusItem = 'a_concluir'|'concluida'|'cancelada'`; `Visibilidade='escritorio'|'particular'`; `Vista='dia'|'semana'|'mes'`.
  `EventoCalendario { id:string /* "fonte:rawId", único */, fonte:FonteAgenda, titulo:string, inicio:string /*ISO*/, fim:string|null, diaTodo:boolean, status:StatusItem, prioridade:'baixa'|'media'|'alta'|'urgente'|null, responsavel:{id,nome}|null, envolvidos:{id,nome}[], processo:{id,titulo,numero}|null, cliente:{id,nome}|null, cor:string, tags:{nome,cor}[], visibilidade:Visibilidade, criadoPor:string|null, meetUrl:string|null, link:string }`.
  `FiltroAgenda { de:string; ate:string; vista:Vista; tipos:FonteAgenda[]; status:'a_concluir'|'concluida'|'cancelada'|'todas'; atribuicao:('responsavel'|'envolvido'|'criador')[]; pessoas:string[] /* userIds; vazio=todos */; equipes:('escritorio'|'particular')[]; tags:string[]; q:string }`.
- `agregacao.ts` (PURA): normalizadores `tarefaParaEvento(row)`, `eventoParaEvento(row)`, `consultaParaEvento(leadRow)` → `EventoCalendario`. Regras: cor da tarefa = 1ª tag ou cor por prioridade; concluída se `completed_at`/`status='concluida'`; consulta cancelada → status cancelada; `link` = deep-link (`/tarefas?tarefa=<id>` p/ tarefa, `/funil?lead=<id>` p/ consulta, abre modal p/ evento). Zero I/O.
- `grade.ts` (PURA): matemática de datas em **America/Sao_Paulo**: `intervaloDaVista(vista, dataRef) -> {de,ate}` (semana dom→sáb; mês; dia); `diasDaSemana(dataRef)`, `semanasDoMes(dataRef)`, `horas()` (0..23), `chaveDia(iso) -> 'YYYY-MM-DD'`, `mesmoDia(a,b)`, `rotuloPeriodo(vista,dataRef)`. Seguir o estilo de `src/components/tarefas/KanbanCalendar.tsx`.
- `filtros.ts` (PURA): `aplicaFiltros(eventos:EventoCalendario[], filtro, meUserId) -> EventoCalendario[]` (tipos, status, pessoas×atribuição, equipes/visibilidade, tags, busca textual). `particular` só aparece pro criador. Testar bem.
- Testes: `agregacao.test.ts`, `grade.test.ts`, `filtros.test.ts` (epochs/ISO fixos; TZ SP).

## 3. Backend (rotas /api/agenda/**) — getAuthContext + requireRole(['admin','advogado','colaborador'])
Auth: `getAuthContext()`; `usuario` tem `{id,nome,tenant_id,role}` (SEM email → email em `auth.user.email`). Escopo por tenant defensivo em toda query. `jsonError`/`validateBody(zod)` de `@/lib/api`.
- `GET /api/agenda?de=&ate=&tipos=&status=&atribuicao=&pessoas=&equipes=&tags=&q=` → busca as 3 fontes NO intervalo [de,ate] (tenant), normaliza via `agregacao.ts`, aplica `filtros.ts` com `meUserId=usuario.id`, retorna `{ eventos: EventoCalendario[] }`. **Visibilidade particular**: na query de `agenda_eventos`, trazer só `visibilidade='escritorio' OR created_by=usuario.id` (defesa além do RLS). Consultas: `funil_leads` com `consulta_data` no intervalo.
- `GET /api/agenda/pessoas` → `{ pessoas:[{id,nome}] }` (users ativos do tenant, p/ o filtro Pessoas).
- `POST /api/agenda/eventos` (cria), `PATCH /api/agenda/eventos/[id]` (edita), `DELETE /api/agenda/eventos/[id]`, `POST /api/agenda/eventos/[id]/status` (concluir/cancelar/reabrir). Validar tipo/datas; `created_by=usuario.id`; envolvidos M2M. `logAudit` (src/lib/audit.ts) nas mutações. Só o criador (ou admin) edita/exclui `particular`.
- **Bot**: `POST /api/agenda/eventos/integracao` autenticado por `x-simas-token` (padrão `autorizadoIntegracao` de `src/lib/funil/auth-integracao.ts`, env `SIMAS_INTEGRATION_TOKEN`), escopo `FUNIL_TENANT_ID`, `origin='bot'`. Cria evento de agenda a partir de payload do bot. NUNCA cria prazo sem data explícita no payload.
- Modal de tarefa: `GET/POST /api/tasks/[id]/comentarios` (lista/cria em `task_comments`, autor=usuario.id) e `GET /api/tasks/[id]/historico` (lê `audit_log` filtrado à tarefa). Se as mutações de tarefa ainda não logam em `audit_log`, ADICIONE `logAudit` em criar/atualizar/concluir/excluir (`src/app/api/tasks/**`) com os campos alterados, para o histórico refletir "criada / adicionada ao quadro / descrição alterada" como no Astrea. NÃO quebrar o comportamento atual das rotas de tasks.

## 4. Frontend (/agenda) — estilo Astrea (ver prints; paridade)
Página server component `src/app/(dashboard)/agenda/page.tsx` (auth + redirect por papel admin/advogado/colaborador; `export const dynamic='force-dynamic'`; `<Header titulo="Agenda"/>` + client). Componentes em `src/components/agenda/`.
- **AgendaCalendario.tsx** (client, orquestrador): estado do filtro + data de referência + vista; `carregar()` faz `fetch('/api/agenda?...')`; renderiza a barra de topo e a grade. Barra: seletor de vista (POR SEMANA/DIA/MÊS), botão **Minhas atribuições**, botão **Todas as atividades**, filtro de **tag**, **busca**, **HOJE**, `‹ ›`, rótulo do mês, **atualizar**, **+** (criar).
- **Grade**: `GradeSemana.tsx` (colunas DOM..SÁB com datas; linha "Dia todo" p/ itens diaTodo/all-day; linhas de hora; item posicionado; "mais N" quando estoura → expande o dia), `GradeMes.tsx`, `GradeDia.tsx`. Itens: barra colorida com **iniciais do responsável + título** (ex.: "Eu -", "SB -"), **borda superior colorida por tipo/prioridade**, **riscado** quando concluída/cancelada. Clique abre o detalhe (tarefa→modal de tarefa; evento→EventoModal; consulta→drawer/link do lead).
- **Filtros** (dropdowns fiéis aos prints):
  - `FiltroAtribuicao.tsx` (**Minhas atribuições**): Atribuição (Responsáveis/Envolvidos/Quem criou — checkboxes), Pessoas (lista de `/api/agenda/pessoas` com checkboxes + "marcar todas"), Equipes (Escritório/Particular). Botões Cancelar/Aplicar.
  - `FiltroAtividades.tsx` (**Todas as atividades**): Exibir (Tarefas/Eventos/Prazos/Audiências/Consultas — checkboxes) + Status (A concluir/Concluídas/Canceladas/Todas — radio). Cancelar/Aplicar.
  - `FiltroTags.tsx` e `BuscaAgenda.tsx` (input de texto).
- **EventoModal.tsx**: criar/editar agenda_evento — tipo (evento/prazo/audiência), título, descrição, dia todo?/início/fim, local, processo/cliente (opcional), responsável + envolvidos, visibilidade (Escritório/Particular), status (concluir/cancelar). Usa `@/components/ui/*` (Dialog, Input, Textarea, Select, Button, useToast). Salva via `/api/agenda/eventos`.
- **Sidebar**: item "Agenda" (ícone lucide `CalendarDays`) gated admin/advogado/colaborador, no padrão de `src/components/layout/Sidebar.tsx`.

### Contrato de componentes entre agentes (pinado — NÃO divergir)
- `EventoCalendario`, `FiltroAgenda`, `Vista`, `FonteAgenda` vêm de `@/lib/agenda/tipos`.
- `AgendaCalendario` consome estes componentes (props exatos):
  - `<FiltroAtribuicao value={filtro} pessoas={Pessoa[]} onAplicar={(patch: Partial<FiltroAgenda>)=>void} />`
  - `<FiltroAtividades value={filtro} onAplicar={(patch: Partial<FiltroAgenda>)=>void} />`
  - `<FiltroTags value={filtro.tags} onAplicar={(tags:string[])=>void} />`
  - `<BuscaAgenda value={filtro.q} onChange={(q:string)=>void} />`
  - `<EventoModal aberto evento={AgendaEvento|null} pessoas={Pessoa[]} onFechar onSalvo />`
  onde `Pessoa = {id:string; nome:string}`.

## 5. Modal de tarefa (paridade) — src/components/tarefas/
Estender `TaskDetailModal.tsx` (ou envolvê-lo) com abas **Comentários** (badge com contagem; lista + input; usa `/api/tasks/[id]/comentarios`), **Histórico de alterações** (`/api/tasks/[id]/historico`), **Publicação** (se `origin_reference` começa com `publicacao:`, buscar e mostrar o card da publicação vinculada — Diário/Vara/Comarca/Divulgado/Publicado/Processo/Termo/Diário — com link "Ver"). Manter todo o comportamento atual do modal. Novos subcomponentes em `src/components/tarefas/detalhe/`.

## Invariantes (duras)
1. Tenant scoping em TODA query (RLS + filtro por `tenant_id`); nada cross-tenant.
2. Visibilidade `particular`: só o criador vê/edita (na API e na lib de filtros). Escritório: todos do tenant.
3. **Prazo NUNCA automático** — nenhuma data de prazo derivada de publicação/processo; só manual.
4. Datas SEMPRE em America/Sao_Paulo na UI; conversões na borda.
5. Segredos server-only; browser só chama `/api/**`.
6. Papel admin/advogado/colaborador em toda rota /api/agenda e na page.
7. Não quebrar os testes existentes (~258/29 arquivos); adicionar testes das libs puras novas. `tsc`, `vitest`, `next build` verdes.
8. Sem dependências novas de calendário — grade própria com `Date`+`Intl`.
9. Reaproveitar componentes `@/components/ui/*` e o padrão visual (tokens de tema). Sem cores hardcoded.
