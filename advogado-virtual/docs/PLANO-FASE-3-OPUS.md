# Plano Fase 3 — Mineração de teses das peças do escritório

> **Origem:** ideia do dono do produto (2026-07-04), analisada e estruturada pelo Fable. Execução: Opus.
> **A ideia:** upload das peças já produzidas pelo escritório → a IA lê, **identifica as teses** (fundamentação, dispositivos, súmulas, ementas) e **sugere** ao advogado a inclusão na base de teses. O advogado revisa e aprova; só então a tese passa a fundamentar novas peças.

---

## §0 — Parecer do Fable (por que faz sentido e o que muda)

**A ideia é forte por três razões:**
1. **Resolve o cold start da base.** A base de teses (B5.3) está vazia e o gargalo era o dono ter que *redigir* teses do zero — fricção alta, na prática não aconteceria. As peças antigas do escritório são fundamentação **já batalhada em casos reais**: minerá-las e pedir só a *aprovação* reduz a fricção em 10x. Curadoria por aprovação ≫ curadoria por autoria.
2. **É o mecanismo de produtização.** No futuro, cada escritório que entrar faz upload das suas melhores peças → base personalizada instantânea → o sistema gera "com a fundamentação do SEU escritório". Isso é diferenciação por cliente + custo de troca — exatamente o fosso editorial do parecer competitivo.
3. **Fecha o ciclo com o que já construímos:** o **verificador de citações (B5.2 + online)** roda sobre cada tese extraída ANTES de o advogado revisar — cada sugestão chega com selo ✓/⚠/✗ por citação (LexML confirma a lei, faixa confirma a súmula, dígito CNJ flagra número inventado). O advogado revisa **com o verificador trabalhando a favor dele**.

**Três riscos, com mitigação desenhada:**
1. **Tese desatualizada** — a peça antiga pode citar entendimento superado (súmula cancelada, EC 103/2019, tema repetitivo posterior). *Mitigação:* a aprovação é humana e explícita; a UI avisa "confira a vigência"; o verificador online marca o que não confirma.
2. **Extração que "melhora" a citação** — o extrator NUNCA pode completar citação de memória (vira alucinação na fonte). *Mitigação:* regra dura no prompt de extração — só citações **presentes literalmente** no texto da peça.
3. **Dados de cliente vazando para a base** — a tese precisa ser **genérica**. *Mitigação:* instrução de anonimização no extrator + revisão humana na aprovação (a tese aprovada não pode conter nome/CPF de cliente).

**⚠️ Mudança arquitetural (decisão do Fable, exposta ao dono):** a base de teses sai dos **arquivos do repositório** e vai para o **banco (tabela por tenant)**. Motivos: (a) um fluxo de aprovação in-app não consegue escrever no repo; (b) a produtização exige base **por escritório** — arquivo no repo é global; (c) a trilha que o repo dava (versão, quem revisou) é substituída por colunas de auditoria + RLS + `logAudit`. O momento é perfeito: a base tem **zero teses reais** (só o template) — não há dado a migrar. Os arquivos em `src/lib/fundamentacao/` viram apenas template/documentação.

---

## Regras de execução (as mesmas das fases anteriores)

1. Um lote = commit coeso; `tsc` + `npm test` + `npm run build` antes de push; push autorizado. Migrations idempotentes aplicadas via `scripts/run-migrations.mjs`.
2. **Rotas de IA de saída longa: `maxDuration = 300`** (lição da Fase 2 — teto baixo corta a resposta). A extração de teses é `completionJSON` (não stream) — usar 300.
3. Prompts curados existentes: intocados. O prompt do EXTRATOR é novo (núcleo definido no Lote B — segui-lo).
4. Em ambiguidade real de produto, parar e perguntar. Decisões de desenho abaixo — não reabrir.

## Mapa de reuso (não reinventar)

| Preciso de | Já existe |
|---|---|
| Ler PDF | `extractTextFromPdf` (`lib/anthropic/client.ts`) — usado em `api/extrair-texto` |
| Ler DOCX | `mammoth` — usado em `api/extrair-texto/route.ts` |
| Magic bytes (PDF/DOCX) | `lib/file-validation.ts` (`validarConteudo`, pdf/zip) |
| Extração estruturada por IA | `completionJSON` (`lib/anthropic/client.ts`) |
| Verificação de citações | `verificarCitacoesOnline` (`lib/jurisprudencia/verificador-citacoes-online.ts`) |
| Similaridade p/ dedup | Dice de `lib/telemetria/taxa-edicao.ts` (extrair helper comum) |
| Selo por citação (UI) | `SeloCitacoes` / padrão do `RelatorioValidacao` |
| Cota/log | `verificarCota` + `logUsage` (nova categoria `extrair_teses`) |
| Auditoria | `logAudit` (`lib/audit.ts`) |
| RLS por tenant | padrão `get_user_tenant_id()` das migrations existentes |

---

## Lote A — Base de teses no banco (migração + leitura)

1. **Migration 039 `teses_escritorio`** (idempotente, aplicar em produção):
   - `id uuid pk`, `tenant_id uuid not null ref tenants`, `area text not null`,
     `status text not null default 'sugerida' check in ('sugerida','aprovada','rejeitada')`,
     `tese text not null`, `dispositivos jsonb default '[]'`, `sumulas jsonb default '[]'`,
     `ementas jsonb default '[]'` (cada: tribunal, processo, relator, julgamento, ementa, fonteUrl?, confirmadaSemFonte?),
     `quando_usar text`, `notas text`,
     `verificacao jsonb` (resultado do verificador por citação),
     `origem_arquivo text`, `trecho_origem text` (de onde veio na peça),
     `sugerida_em timestamptz default now()`, `aprovada_por uuid ref users`, `aprovada_em timestamptz`,
     `rejeitada_por uuid ref users`, `rejeitada_em timestamptz`, `motivo_rejeicao text`.
   - Índice `(tenant_id, area, status)`. RLS: padrão `tenant_id = get_user_tenant_id()`.
2. **`lib/fundamentacao` passa a ler do banco:** `blocoFundamentacaoParaPrompt(area)` vira `blocoFundamentacaoParaPrompt(supabase, tenantId, area)` (async), lendo `status='aprovada'` da área. Mesmo formato de bloco ("FUNDAMENTAÇÃO VERIFICADA PELO ESCRITÓRIO", instrução de citar sem [VERIFICAR]). **Cap: 15 teses/área** (proteção de prompt); acima disso, as mais recentes.
3. `gerar-peca` (2 caminhos) usa a versão async. Best-effort: falha na leitura → bloco vazio, nunca derruba a geração.
4. **Biblioteca lê do banco:** aba "Aprovadas" (status aprovada, por área). O template do repo continua exibido apenas como exemplo de formato. `tesesDaArea`/arquivos do repo deixam de alimentar a injeção (manter o teste garantindo que exemplo não injeta já não se aplica — remover/adaptar testes coerentemente).

**Aceite:** tese inserida à mão no banco (status aprovada) aparece na Biblioteca e no prompt de geração da área; com a tabela vazia, tudo se comporta como hoje.

## Lote B — Upload de peças + extração de teses (o coração)

1. **Rota `POST /api/teses/extrair`** (`maxDuration = 300`): recebe UM arquivo por chamada (o cliente itera sobre vários, padrão do upload de áudio) — multipart ou Storage path.
   - Valida magic bytes (pdf/zip=docx); extrai texto (mammoth / `extractTextFromPdf`).
   - `verificarCota(..., 'extrair_teses')` (nova categoria em `quota.ts`, limite generoso) + `logUsage`.
   - **Extração via `completionJSON`** — núcleo do prompt (Fable; seguir fielmente):
     - Persona: advogado revisor experiente identificando as TESES JURÍDICAS de uma peça do próprio escritório.
     - Extrair 0..8 teses; cada uma: `tese` (enunciado GENÉRICO e reutilizável, 1-2 frases, **sem nenhum dado do caso concreto** — nomes, CPFs, valores, datas), `area` (da lista de áreas do sistema), `dispositivos[]`, `sumulas[]`, `ementas[]` (tribunal/processo/relator/julgamento/texto), `quando_usar`, `trecho_origem` (citação curta do trecho da peça que a fundamenta).
     - **REGRA CRÍTICA:** copiar citações LITERALMENTE como constam na peça. NUNCA completar, corrigir ou adicionar citação de memória. Ementa só entra se o TEXTO dela estiver na peça. Não extrair teses triviais ("aplica-se o CPC").
   - **Dedup** contra teses existentes do tenant (aprovadas + sugeridas): similaridade Dice de palavras do enunciado (> ~0,75 = duplicada → descartar) + interseção de dispositivos. Extrair o helper de Dice de `taxa-edicao.ts` para `lib/telemetria/similaridade.ts` (ou equivalente) e reusar nos dois lugares.
   - **Verificador em cada sugestão:** rodar `verificarCitacoesOnline` sobre `dispositivos + sumulas + processos das ementas` (montar texto sintético) e gravar em `verificacao`.
   - Inserir como `status='sugerida'`. Resposta: `{ sugeridas: n, duplicadas: n }`.
2. **Arquivo enviado:** gravar em Storage `{tenant}/teses-uploads/` (auditoria da origem durante o piloto; retenção a definir depois).

**Aceite:** upload de uma petição DOCX real do escritório → 2+ sugestões coerentes aparecem, com selos de verificação, sem dados do cliente no enunciado; subir a mesma peça de novo → duplicadas ignoradas.

## Lote C — Curadoria na Biblioteca (aprovar/rejeitar)

1. **Biblioteca vira o hub de curadoria:** abas **"Aprovadas"** e **"Sugestões"** (badge com contagem) + botão **"Enviar peças do escritório"** (upload multi-arquivo, processa 1 a 1 com progresso).
2. **Card de sugestão:** enunciado (editável), área (editável, select), dispositivos/súmulas/ementas com **selo do verificador por citação**, `quando_usar` (editável), trecho de origem (colapsável), origem (arquivo).
3. **Aprovação (só `admin`/`advogado`):**
   - Se houver ementa **sem `fonteUrl`** ou citação **⚠/✗**: exigir checkbox *"Conferi esta fundamentação na fonte e confirmo que está vigente"* (grava `confirmadaSemFonte`/registro da confirmação).
   - Aprovar → `status='aprovada'` + `aprovada_por/em` + **`logAudit('tese.aprovar')`**. Rejeitar → idem com motivo + `logAudit('tese.rejeitar')`. (Aproveitar e adicionar `logAudit` também na aprovação de peça, se trivial — alinha com a lacuna D7.)
   - Editar antes de aprovar é o caminho normal (o advogado lapida o enunciado).
4. A partir da aprovação, a tese entra automaticamente na geração (Lote A) — nada mais a fazer.

**Aceite:** fluxo completo: upload → sugestão com selos → editar → aprovar → gerar peça da área → o bloco "FUNDAMENTAÇÃO VERIFICADA" contém a tese; `audit_log` tem o evento.

## 🛑 Ponto de parada (fim do Lote C)

Avisar o dono: **subir 3–5 peças reais** do escritório, revisar as sugestões e aprovar as primeiras teses. É a validação do produto inteiro — a qualidade da extração decide os ajustes do prompt do extrator.

## Fora de escopo (registrar, não fazer)

- Mineração de **estilo/modelo** das peças enviadas (outro uso do mesmo acervo — futuro).
- Telemetria de uso por tese (quais teses mais entram em peça) — segunda iteração.
- Expurgo/retenção dos arquivos enviados — decisão do dono depois do piloto.
- Tela de **criação manual** de tese (a aprovação com edição cobre; criação do zero só se a prática pedir).

---

*Preparado pelo Fable em 2026-07-04. Para executar: apontar o Opus para este arquivo e pedir a execução dos lotes A → B → C, respeitando o ponto de parada.*
