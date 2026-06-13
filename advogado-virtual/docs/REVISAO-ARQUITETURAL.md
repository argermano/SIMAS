# Revisão Arquitetural — SIMAS / Advogado Virtual

> **Status:** rascunho para revisão do product owner. **Nenhuma linha de código foi alterada** na produção desta revisão.
> **Data:** 2026-06-13
> **Escopo:** todo o produto (rotas, modelo de dados, motor de IA, funcionalidades e UX).
> **Método:** leitura do código real (App Router, migrations SQL, endpoints `/api/ia/*`, componentes). As afirmações abaixo trazem `caminho/arquivo:linha` como evidência.
> **Premissas declaradas pelo solicitante:** sistema ainda **não está em produção**, **sem dados reais a preservar**. Logo, **toda** mudança é viável, inclusive descartar e reescrever partes. O estado atual é tratado como **ponto de partida**, nunca como restrição. Esta revisão não otimiza por "menor esforço" nem por "reaproveitar o que existe" — otimiza pela melhor arquitetura e UX.

---

## Sumário executivo

1. **Não existe entidade "Caso" separada — o `atendimento` já é o Caso.** Toda a árvore (análises, peças, documentos, contratos, tarefas) pendura em `atendimento_id`. A proposta de "o Caso é o hub" não exige uma tabela nova; exige tratar o `atendimento` como hub também na **navegação**, o que hoje **não acontece**.

2. **As "três portas" existem, mas divergem em vez de convergir.** Estudo, card "área + peça" e Refinamento são três entradas reais — porém cada uma cria seu próprio `atendimento` e termina no **editor da peça**, não de volta na Casa do caso. Elas não se encontram.

3. **O maior problema é de UX, não de dados: re-entrada de contexto.** No fluxo "caso novo", o relato do cliente é digitado/gravado **até três vezes** (Análise de Caso → Consultoria → Tela de geração), porque cada tela re-pergunta o relato em vez de carregar o que já está salvo no `atendimento`. Isso é o que faz o sistema parecer "confuso".

4. **O "motor único `gerarPeca()`" não existe** — há ~13 endpoints de IA, cada um montando seu próprio fluxo. Consolidar é desejável, mas é uma refatoração de back-end de baixo risco e **não** é o que vai melhorar a percepção do advogado. Prioridade menor que a UX.

5. **O vocabulário "área + etapa" só existe pela metade.** `área` está em todo lugar (`atendimentos.area`, `pecas.area`); "etapa" **não existe** — o que existe é `tipo_peca`. Recomendo **não** inventar um terceiro sinônimo ("etapa") e sim padronizar em `tipo` + um `status`/lifecycle derivado do Caso.

**Recomendação de uma linha:** manter o `atendimento` como Caso, transformar a **Casa do caso** no verdadeiro hub para onde as três portas convergem, e **eliminar a re-entrada de contexto** carregando o relato salvo entre telas — antes de qualquer reescrita do motor de IA.

---

## Decisões aprovadas e estado de implementação

Decisões do product owner (2026-06-13) e o que já foi implementado:

| # | Decisão | Estado |
|---|---|---|
| 1 | **Consultoria não é obrigatória** — o Estudo deve levar direto à peça | ✅ Implementado: Estudo permite escolher o tipo de peça e gerar direto (`/[area]/pecas/[tipo]?id=`); "aprofundar análise" virou opcional. |
| 2 | **Um Caso pode ter peças de várias áreas**; documentos, contrato, procuração e declarações pertencem ao Caso e são reutilizáveis entre peças | ✅ Já garantido no modelo (`atendimento` = Caso): `gerar-peca` carrega `documentos(*)` por atendimento; Casa do caso lista docs/contratos/peças do caso. |
| 3 | **Sem campo "etapa"**; andamento como linha do tempo derivada | ✅ Implementado: "Linha do tempo" na Casa do caso (estudo, peças, contratos, documentos por data). |
| 4 | **Manter "Contratos a assinar", remover "Histórico" do menu** | ✅ Menu já sem Histórico; removido o último link órfão no dashboard. |
| 5 | **Implementar tudo, fase a fase** | 🔄 Em andamento (ver abaixo). |

**Princípio do motor (decisão complementar):** unificar a **orquestração**, mas manter/expandir **prompts curados por área+peça** — geração não depende só da IA (público são advogados com pouca familiaridade com IA). Camadas: `base + área + peça + modo`.

**Incrementos entregues:**
- **Inc. 1** (`513fc09`): Estudo→peça direto, Casa do caso como hub (seletor de peças + linha do tempo), editor "voltar ao caso", limpeza do link de Histórico.
- **Inc. 2** (`381d834`): `/api/ia/analise` extensível por área (registro + fallback genérico ciente da área) — remove o viés previdenciário para áreas sem prompt curado.

**Pendente (refatorações internas, sem efeito visível, maior risco de regressão):**
- **Motor único** `gerarPeca({atendimentoId, area, tipo, modo, contexto})` consolidando `gerar-peca`/`refinamento-peca`/`refinar-peca`/`correcao-auto` — preservando os prompts curados byte-a-byte.
- **Unificar** `TelaAtendimento` e `TelaRefinamento` num componente com `modo`.

---

# FASE 1 — Mapa do estado atual

## 1.1 Rotas (Next.js App Router)

Dois grupos de rota: `(auth)` (login) e `(dashboard)` (protegido por `getUser()` em [layout.tsx:14-17](src/app/(dashboard)/layout.tsx)). Landing pública em [page.tsx](src/app/page.tsx). O app usa **API route handlers (`route.ts`), NÃO server actions** — não há nenhuma diretiva `'use server'` no código; o cliente dispara tudo via `fetch('/api/...')`.

| Rota | Papel |
|---|---|
| `/dashboard` | Início — cards das 11 áreas + atalho "Análise de Caso" + últimos 5 casos |
| `/[area]` | Hub da área — `PainelArea` com 4 blocos (Análise, Peças, Refinamento, Modelos) |
| `/[area]/abertura` | Abertura/classificação do serviço + checklist de documentos |
| `/[area]/pecas/[tipoPeca]` | **Geração da peça** — `TelaAtendimento` (relato, áudio, docs) → `gerar-peca` |
| `/[area]/editor/[pecaId]` | Editor TipTap da peça gerada (export DOCX, timbrado, refinar inline) |
| `/[area]/refinamento` | Refinamento — `TelaRefinamento` (upload da peça + docs) |
| `/[area]/consultoria` | Consultoria/Análise (parecer, estratégia, "caso_novo") |
| `/[area]/modelos/[modeloId]` | Modelos prontos (procuração, contrato, declaração, etc.) |
| `/analise-caso` | **Estudo de Caso global** (sem área fixa) → `analise-geral` |
| `/clientes` · `/clientes/novo` · `/clientes/[id]` | Lista, cadastro e dossiê do cliente |
| `/clientes/[id]/casos/[atendimentoId]` | **Casa do caso** (hub atual) |
| `/clientes/[id]/atendimentos/novo` | Grid área × tipo de peça (criar atendimento) |
| `/contratos` · `/contratos/novo` · `/contratos/[id]` | Contratos a assinar (D4Sign) |
| `/tarefas` | Kanban |
| `/revisao` | Fila de revisão (peças `aguardando_revisao`) |
| `/historico` | Histórico completo de atendimentos |
| `/configuracoes` · `/configuracoes/equipe` | Timbrado, formatação, IA, padrões; equipe (admin) |

**Observação-chave:** há **três rotas distintas que fazem "análise"** — `/analise-caso` (global), `/[area]/consultoria` (parecer/estratégia/caso_novo) e o chat-diagnóstico dentro do editor. E há **duas telas de "atendimento"** quase idênticas em propósito — `TelaAtendimento` (gerar) e `TelaRefinamento` (refinar). Essa multiplicidade é a origem da sensação de confusão.

## 1.2 Modelo de dados & multi-tenancy

Confirmado: **Supabase puro** (`supabase/migrations/*.sql` + `supabase-js`), **não Prisma**. Ordem topológica:

```
tenants → users → clientes → atendimentos → { documentos, analises, pecas (→ pecas_versoes),
                                              contratos_honorarios (→ contratos_versoes),
                                              tasks, exportacoes }
```

Fatos relevantes (com evidência):

- **Não existe tabela `Caso`.** `atendimento` É o caso. `status`: `caso_novo | peca_gerada | finalizado` — `003_atendimentos_documentos.sql`.
- `atendimentos`: `tenant_id NOT NULL`, `cliente_id NOT NULL`, `user_id NOT NULL`, `area DEFAULT 'previdenciario'` (`003:7-11`). Guarda também `tipo_peca_origem`, `audio_url`, `transcricao_raw`.
- `pecas`: `analise_id` **NULLABLE** (`004:41`), `atendimento_id NOT NULL`, `area NOT NULL DEFAULT 'previdenciario'` (`004:47`). → **a área é replicada na peça** e pode divergir da área do atendimento. Versionamento em `pecas_versoes` (`004:79-82`).
- `documentos`: `atendimento_id NOT NULL`, `cliente_id` NULLABLE (`012`) → anexos viram dossiê reutilizável do cliente.
- `contratos_honorarios`: `cliente_id` e `atendimento_id` ambos **NULLABLE** (`010:7-8`, `ON DELETE SET NULL`) → contrato pode existir solto.
- **RLS**: `get_user_tenant_id()` `SECURITY DEFINER` (`005:22-28`); policy padrão `tenant_isolation_*` `USING (tenant_id = get_user_tenant_id())` em 14 tabelas; filhos (ex. `pecas_versoes`) via subquery por FK. Storage endurecido por prefixo `tenant_id/` (`026`).

**Dívida de modelagem (não bloqueante, mas real):**
- `area` está triplicada (`atendimentos`, `pecas`, `contratos_honorarios`), sem normalização — risco de inconsistência se a área "do caso" mudar.
- Só `pecas` tem versionamento; análises/contratos/atendimentos não têm histórico de campo.
- `pecas.tipo` e `pecas.area` têm CHECK no SQL **e** união hardcoded em [src/types/index.ts](src/types/index.ts) — dessincronização manual ao adicionar tipo novo.

## 1.3 Motor de IA

**13 endpoints** em `src/app/api/ia/*`, todos passando por uma camada central [client.ts](src/lib/anthropic/client.ts) (`streamCompletion`, `completionJSON`, guardrail anti-injection, `JSON_ONLY`, limite `MAX_PROMPT_CHARS`). Mas **cada endpoint monta seu próprio fluxo**:

| Endpoint | Papel | Forma |
|---|---|---|
| `gerar-peca` | geração de peça (motor principal) | streaming SSE |
| `refinamento-peca` | refinar preservando estrutura | streaming SSE |
| `refinar-peca` | refinar comparando novos docs | JSON |
| `correcao-auto` | correções pontuais | streaming SSE |
| `gerar-documento` | modelos (procuração, decl., etc.) | preenche modelo / gera do zero |
| `gerar-contrato` | contrato de honorários | streaming SSE |
| `analise` | análise por área (prev/trab) | JSON |
| `analise-geral` | triagem multi-área | JSON |
| `comando` | comandos rápidos (timeline, etc.) | streaming SSE |
| `validar-peca` | validação/revisão | JSON |
| `extrair-dados-cliente` | OCR/Vision → dados estruturados | JSON |
| `chat-diagnostico` | chat sobre a peça/diagnóstico | streaming SSE |
| `editor-documento` | edição colaborativa por comando | streaming SSE |

Pontos altos confirmados no código:
- **`gerar-peca` é o mais maduro:** `PROMPT_MAP[area][tipo]` para combinações dedicadas (`previdenciario, trabalhista, civel, familia, medico` × `peticao_inicial, contestacao`); fallback genérico **área+tipo-aware** via `buildPromptPecaGenerica` (`gerar-peca/route.ts:241-287`). Monta contexto rico: triagem de relevância de documentos + jurisprudência (em paralelo, `Promise.all`) + qualificação das partes (decriptada) + modelo padrão do escritório **como referência de estrutura (não cópia)**.
- **Versão de IA escolhível** pelo usuário: `modeloDaVersao(versao)` em `gerar-peca` e `analise-geral` ([versoes.ts:19-23](src/lib/anthropic/versoes.ts)).
- Cota (`verificarCota`) e `logUsage` em quase todos os endpoints.

Fraquezas confirmadas:
- **`analise/route.ts:52-68` usa `if (area === 'trabalhista') … else (previdenciário)`** — não escala; qualquer área nova cai em previdenciário. (O `PROMPT_MAP` de `gerar-peca` é o padrão certo; `analise` ficou para trás.)
- **Nomes confusos:** `refinamento-peca` (streaming, preserva) vs `refinar-peca` (JSON, compara docs) — dois endpoints, propósitos próximos, nomes quase iguais.
- **"modo" é implícito na URL do endpoint**, não um parâmetro. Não há `gerarPeca({modo})` — o "modo" é qual rota você chamou.

## 1.4 Funcionalidades (estado)

- **Transcrição:** Groq `whisper-large-v3` (não OpenAI) — `transcrever-audio` (efêmero) e `transcrever-audio-upload` (salva `audio_url` + `transcricao_raw` no atendimento). Três entradas de áudio: gravação na reunião (consentimento LGPD), upload pós-reunião, microfone inline.
- **Editor:** TipTap WYSIWYG ([DocumentEditor.tsx](src/components/document-editor/DocumentEditor.tsx)); salva **markdown** (não o estado WYSIWYG). Export DOCX via [docx-generator.ts](src/lib/export/docx-generator.ts) com `EstiloDocumento` ABNT e modos `compacto`/`contrato` (detecta endereçamento `EXCELENTÍSSIMO` e fecho `Cidade, dd de mês de aaaa` p/ centralizar).
- **Timbrado:** [aplicar-timbrado.ts](src/lib/export/aplicar-timbrado.ts) injeta o corpo no `word/document.xml` do timbrado via PizZip (preserva cabeçalho/rodapé/marca d'água). Só DOCX.
- **Export PDF:** apenas contratos, `jsPDF` simplista (não renderiza `**negrito**`).
- **D4Sign:** `contratos/[id]/assinatura` (GET/PATCH), `contract_signatures` + `contract_signature_signers`. **Só contratos**, não peças.
- **Kanban:** board único padrão por tenant (não por caso); `enviar-revisao` cria tarefa, `aprovar` conclui.
- **Refinamento:** rota dedicada, aceita `.pdf/.docx/.txt/.md` (via `extrair-texto`), gera nova versão de peça.

## 1.5 Pontos de entrada e a jornada do advogado

O **PainelArea** ([PainelArea.tsx](src/components/area/PainelArea.tsx)) oferta 4 blocos: "Análise de Caso com IA" (→ `/analise-caso`), grid "Peças com IA" (→ `/[area]/pecas/[tipo]`), "Refinamento de Peça" (→ `/[area]/refinamento`) e grid "Modelos Prontos". Os cards do **Início** levam à área (`/[area]`) ou à Análise global. Todos os pontos de entrada estão preservados.

Abaixo, as **três intenções** com a contagem de cliques e — mais importante — de **quantas vezes o advogado re-informa o relato**.

### Intenção A — "Caso novo, não sei a área, quero estudar e gerar a peça"

| # | Tela | Ação | Re-entra relato? |
|---|---|---|---|
| 1 | Início | clica "Análise de Caso com IA" | — |
| 2 | `/analise-caso` | seleciona cliente, grava/digita **relato**, "Analisar" | ✍️ **1ª vez** |
| 3 | resultado | clica "Aprofundar análise" na área principal → `irParaArea()` | — |
| 4 | `/[area]/consultoria?atendimentoId=` | (tela de análise de novo) gera parecer/estratégia | ✍️ pode re-pedir |
| 5 | consultoria | clica adiante → `router.push('/[area]/pecas/peticao_inicial?id=')` (`ConsultoriaClient.tsx:255,269`) | — |
| 6 | `/[area]/pecas/peticao_inicial` | `TelaAtendimento` re-pede **relato**/docs, "Gerar peça" | ✍️ **de novo** |
| 7 | `/[area]/editor/[pecaId]` | peça pronta | — |

**~6 cliques e o relato é re-informado 2–3 vezes.** O `atendimentoId` é carregado entre telas, mas as telas **re-perguntam o relato** em vez de ler `transcricao_raw` do atendimento. Além disso, o passo 5 defaulta para `peticao_inicial` — o advogado não escolhe a peça.

> Evidência do encadeamento: `AnaliseCasoClient.tsx:275` (`/[area]/consultoria?atendimentoId=`), `ConsultoriaClient.tsx:219,255,269` (`/[area]/pecas/[tipo]?id=`), `CasoPage` "Gerar peça" → `/[area]/consultoria?atendimentoId=` ([casos/[atendimentoId]/page.tsx:160](src/app/(dashboard)/clientes/[id]/casos/[atendimentoId]/page.tsx)).

### Intenção B — "Sei a área e a peça, quero gerar direto"

| # | Tela | Ação |
|---|---|---|
| 1 | Início | clica o card da área → `/[area]` |
| 2 | `/[area]` | clica a peça no grid → `/[area]/pecas/[tipo]` |
| 3 | `TelaAtendimento` | seleciona cliente, relato/docs, "Gerar peça" |
| 4 | `/[area]/editor/[pecaId]` | peça pronta |

**~4 cliques, relato 1 vez.** É o fluxo **limpo**. Porém: cria o atendimento implicitamente dentro da `TelaAtendimento` e **nunca passa pela Casa do caso** — o advogado pode nem saber que existe um "caso" agregando aquilo.

### Intenção C — "Já tenho a peça, quero refinar"

| # | Tela | Ação |
|---|---|---|
| 1 | Início | card da área → `/[area]` |
| 2 | `/[area]` | "Refinamento de Peça" → `/[area]/refinamento` |
| 3 | `TelaRefinamento` | cliente, upload da peça, instruções, docs, "Refinar" |
| 4 | `/[area]/editor/[pecaId]` | versão refinada |

**~5 cliques, relato 0 (usa a peça enviada).** Limpo, mas é uma **terceira tela de atendimento** com layout próprio, reforçando a fragmentação.

**Conclusão da Fase 1:** o sistema é funcionalmente rico e bem isolado por tenant. A dor não está em falta de recurso — está em **fragmentação de telas** e **re-entrada de contexto** no fluxo que deveria ser o principal (Intenção A).

---

# FASE 2 — Análise de lacunas + arquitetura-alvo

## 2.1 Avaliação crítica da proposta

> Proposta em avaliação: *"o Caso é o hub; três portas convergem nele (Estudo / card área+etapa / Refinar), todas compartilhando o vocabulário `área + etapa` e terminando num motor único `gerarPeca({casoId, area, etapa, modo, contexto})`."*

| Peça da proposta | Veredito | Evidência / razão |
|---|---|---|
| **"O Caso é o hub" (entidade)** | ✅ **Já existe** | `atendimento` é o caso; tudo pendura em `atendimento_id`. Não precisa de tabela nova. |
| **"O Caso é o hub" (navegação)** | ⚠️ **Parcial** | A *Casa do caso* existe ([casos/[atendimentoId]/page.tsx](src/app/(dashboard)/clientes/[id]/casos/[atendimentoId]/page.tsx)), mas as portas **não voltam** para ela — terminam no editor. O Início e o PainelArea a contornam. |
| **"Três portas" (Estudo / card / Refinar)** | ⚠️ **Existem, mas divergem** | As três entradas são reais, porém cada uma cria seu atendimento e segue para o editor. Não convergem na Casa do caso — divergem. |
| **Estudo → peças** | ❌→⚠️ **Conflita com o fluxo atual** | O Estudo não gera peça: leva a `/consultoria` (outra análise) e só então a `/pecas/[tipo]` defaultando `peticao_inicial`. Detour de 3 telas. |
| **Vocabulário `área`** | ✅ **Existe** | `atendimentos.area`, `pecas.area`, rotas `/[area]/*`. |
| **Vocabulário `etapa`** | ❌ **Não existe** | O que existe é `tipo` (`pecas.tipo`, `[tipoPeca]`) e `tipo_peca_origem`. "Etapa" seria um **terceiro sinônimo** sem ganho. |
| **Motor único `gerarPeca({…})`** | ❌ **Não existe** | 13 endpoints, cada um com seu fluxo. `gerar-peca` é o mais próximo, mas não recebe `modo`/`etapa`; o "modo" é a própria URL. |
| **`{modo, contexto}` como parâmetros** | ❌ **Não existe** | "modo" é implícito (qual endpoint); "contexto" é remontado do zero a cada request, sem cache. |

**Onde eu discordo da proposta — e o que proponho no lugar:**

1. **Não introduzir "etapa".** É um sinônimo de `tipo_peca`, que já existe e já é validado por área (`area.pecas`). Um terceiro nome só aumenta a carga cognitiva e a chance de dessincronização. Se o objetivo é representar o **andamento do caso** (estudo → 1ª peça → contestação → recurso…), isso é um **lifecycle/status derivado do Caso**, não um campo novo na peça. Recomendo: manter `tipo` para a peça e exibir um *timeline* do caso computado a partir das peças existentes.

2. **O motor único é desejável, mas é prioridade 2.** Consolidar `gerar-peca` + `refinamento-peca` + `refinar-peca` + `correcao-auto` num único `gerarPeca({atendimentoId, area, tipo, modo, contexto})` (onde `modo ∈ {criar, refinar, corrigir}`) reduz duplicação e padroniza contexto/versionamento. Mas isso é **back-end invisível ao advogado** — não muda a percepção de "confuso". Fazer **depois** da UX.

3. **A convergência na Casa do caso é o ponto certo da proposta** — e é o que falta de verdade. As três portas devem **terminar na Casa do caso** (onde as peças se acumulam), não no editor isolado.

## 2.2 Os problemas estruturais que realmente importam

- **P1 — Re-entrada de contexto (crítico).** O relato vive em `atendimentos.transcricao_raw`, mas `consultoria` e `TelaAtendimento` re-perguntam em vez de carregar. *Fix de dados:* não há; o dado já existe. É só **ler o atendimento** ao montar a tela.
- **P2 — Divergência das portas.** Tudo termina no editor; a Casa do caso não é destino de retorno.
- **P3 — Telas de análise triplicadas** (`/analise-caso`, `/consultoria`, chat-diagnóstico) e **telas de atendimento duplicadas** (`TelaAtendimento`, `TelaRefinamento`).
- **P4 — `analise/route.ts` não escala** (if/else trabalhista) — destoa do `PROMPT_MAP`.
- **P5 — Menu redundante:** `/historico` e `/contratos` competem com o acesso "tudo pelo cliente" (já parcialmente endereçado em conversas anteriores).

## 2.3 Arquitetura-alvo

**Princípio:** *o `atendimento` é o Caso; a Casa do caso é o hub de navegação; as portas convergem nela; o relato é informado uma única vez e segue o caso.*

```
                         ┌──────────────────────────────┐
   Início / Cliente ───► │        CASA DO CASO          │ ◄─── todas as portas retornam aqui
                         │  (atendimento = Caso)        │
                         │  • Estudo (relato + áreas)   │
                         │  • Linha do tempo de peças   │
                         │  • Documentos / Contratos    │
                         └───────────────┬──────────────┘
                                         │ "Gerar peça" (escolhe área+tipo, contexto já carregado)
                                         ▼
                         gerarPeca({ atendimentoId, area, tipo, modo, contexto })
                          modo ∈ { criar | refinar | corrigir }   (um motor, vários modos)
                                         │
                                         ▼
                                  Editor da peça ──► "voltar ao caso"
```

Mudanças estruturais propostas (em ordem de valor):
1. **Carregar contexto do atendimento** em `ConsultoriaClient` e `TelaAtendimento` quando há `atendimentoId` (ler `transcricao_raw`, docs, dados extraídos). Elimina P1.
2. **Estudo → recomenda peças → link direto** para `/[area]/pecas/[tipo]?atendimentoId=` (pular a `consultoria` intermediária no caminho de geração). Elimina o detour de P3.
3. **Toda geração retorna à Casa do caso** (botão "voltar ao caso" no editor, já parcialmente feito p/ contrato) e a Casa lista as peças por área. Resolve P2.
4. **Consolidar o motor** em `gerarPeca({…, modo})` (back-end). Resolve a parte legítima da proposta + P4.
5. **Unificar `TelaAtendimento`/`TelaRefinamento`** num componente com `modo`.

---

# FASE 3 — Análise de UX (prioridade)

Esta é a seção mais importante: a queixa do solicitante ("acho o sistema um pouco confuso") é de UX.

## 3.1 O problema central — re-entrada de contexto

No fluxo principal (Intenção A), o advogado **conta o caso até três vezes**. Isso quebra a promessa do produto ("a IA já sabe do caso"). A correção não exige modelo de dados novo: `atendimentos.transcricao_raw` e os `documentos` já estão salvos e o `atendimentoId` já trafega na URL. Falta as telas **lerem** esse contexto ao montar. **É o fix de maior retorno por esforço do sistema inteiro.**

## 3.2 Becos sem saída e vocabulário inconsistente

- **"Aprofundar análise" engana.** O botão sugere "ir fundo no caso", mas leva a `/[area]/consultoria` (outra análise: parecer/estratégia), não à geração da peça. O advogado que queria a peça faz uma análise a mais sem querer (`AnaliseCasoClient.tsx:275`).
- **"Gerar peça" da Casa do caso leva a uma análise.** O card "Gerar peça" linka para `/[area]/consultoria?atendimentoId=` ([page.tsx:160](src/app/(dashboard)/clientes/[id]/casos/[atendimentoId]/page.tsx)), não para a tela de geração. É um rótulo que não cumpre o que diz.
- **Default silencioso para `peticao_inicial`.** Ao avançar da consultoria, a peça é fixada em petição inicial (`ConsultoriaClient.tsx:255,269`) — o advogado não escolhe o tipo.
- **Três "análises" e duas "telas de atendimento"** com nomes/finalidades sobrepostas — o usuário não constrói um modelo mental estável de "onde faço o quê".

## 3.3 Menu e navegação

`Início, Clientes, Tarefas, Contratos a assinar, (Revisão), (Equipe), Configurações`. `/historico` foi removido do menu mas a rota existe e o Início ainda linka "Ver todos" → `/historico` ([dashboard/page.tsx:157](src/app/(dashboard)/dashboard/page.tsx)). Tudo deveria ser acessível **pelo cliente → caso**; itens globais (Contratos, Histórico) duplicam esse acesso e competem pela atenção.

## 3.4 Redesenho de UX proposto

1. **Uma porta, um relato.** O relato é capturado **uma vez** (no Estudo ou na primeira tela de geração) e gravado no atendimento; toda tela seguinte **mostra** o relato (read-only editável) em vez de pedir de novo.
2. **Estudo aciona peças, não outra análise.** Resultado do Estudo lista as áreas/peças recomendadas com botão **"Gerar petição inicial de [Área]"** que vai **direto** para `/[area]/pecas/[tipo]?atendimentoId=` já com contexto.
3. **Casa do caso como tela-mãe.** Após gerar/refinar, retorna para a Casa do caso, que mostra a **linha do tempo** (Estudo → peças por área → contratos → documentos). "Refinar" e "Gerar nova peça" partem daqui.
4. **Renomear para reduzir ambiguidade:** "Aprofundar análise" → "Gerar peça"/"Ver parecer" (separar as duas intenções); "Consultoria" reservada a parecer/estratégia, fora do caminho de geração.
5. **Escolha de tipo de peça explícita** ao gerar a partir do Estudo (não defaultar `peticao_inicial`).

---

# FASE 4 — Recomendação + plano de construção

## 4.1 Recomendação

**Adotar a essência da proposta (Caso-hub + convergência das portas), descartar o vocabulário "etapa", e priorizar UX sobre o motor.** Em concreto:

- **SIM** — Casa do caso como hub para onde as três portas convergem.
- **SIM** — motor consolidado `gerarPeca({atendimentoId, area, tipo, modo, contexto})`, mas como fase posterior.
- **NÃO** — introduzir "etapa" como vocabulário/campo. Usar `tipo` (peça) + `status`/timeline (caso).
- **PRIORIDADE 0** — eliminar a re-entrada de contexto (carregar o atendimento nas telas).

Não recomendo reescrever do zero: o modelo de dados (atendimento-como-caso, RLS, versionamento) e o `gerar-peca` (PROMPT_MAP + fallback genérico + triagem) são sólidos. O problema é de **fluxo entre telas**, e isso se resolve por reorganização de navegação, não por reconstrução.

## 4.2 Plano incremental

**Fase 0 — Contexto único (1 PR, alto impacto).**
`ConsultoriaClient` e `TelaAtendimento`, ao receberem `atendimentoId`, carregam `transcricao_raw` + docs + dados extraídos e exibem como contexto pré-preenchido (read-only/editável). Critério de pronto: no fluxo A, o relato é digitado **uma vez**.

**Fase 1 — Estudo → peça direto.**
No resultado do Estudo, cada área recomendada vira CTA "Gerar [peça] de [área]" → `/[area]/pecas/[tipo]?atendimentoId=`. Remover o desvio obrigatório pela `consultoria`. Permitir escolher o tipo (não fixar `peticao_inicial`).

**Fase 2 — Convergência na Casa do caso.**
Editor ganha "voltar ao caso"; Casa do caso vira destino de retorno e ganha **linha do tempo** do caso. Corrigir o rótulo "Gerar peça" da Casa para apontar à geração (ou abrir um seletor área+tipo) em vez de `/consultoria`.

**Fase 3 — Consolidar o motor (back-end).**
`gerarPeca({atendimentoId, area, tipo, modo, contexto})` com `modo ∈ {criar, refinar, corrigir}`, unificando `gerar-peca`/`refinamento-peca`/`refinar-peca`/`correcao-auto`; padronizar versionamento (hoje só refinar/correção versionam; `gerar-peca` cria v1 sem registrar). Migrar `analise` para um `PROMPT_MAP` por área (eliminar o if/else trabalhista).

**Fase 4 — Unificar atendimento/refinamento e limpar menu.**
`TelaAtendimento`/`TelaRefinamento` → um componente com `modo`. Remover `/historico` do menu/links órfãos; acesso a tudo via cliente → caso.

## 4.3 Riscos

- **Regressão de fluxo ao mexer na navegação** — mitigar com a Fase 0 isolada (só leitura de contexto, sem mudar rotas) antes de remanejar telas.
- **Consolidar o motor pode alterar prompts** e a qualidade da peça — manter os `PROMPT_MAP` atuais byte-a-byte; o `modo` só troca o system, não o conteúdo dos prompts validados.
- **Versionamento inconsistente** ao unificar (alguns endpoints versionam, `gerar-peca` não) — definir a regra antes (ex.: toda geração cria versão).
- **`area` triplicada** pode divergir se um caso "trocar de área" — decidir a fonte da verdade (sugiro: a peça manda na peça; o atendimento guarda a área principal).

## 4.4 Perguntas em aberto (para você decidir)

1. **Consultoria (parecer/estratégia) é destino de valor por si só** ou só um meio para gerar peça? Se for valor próprio, mantemos a rota separada do caminho de geração; se for só meio, ela some do fluxo principal.
2. **Um caso = uma área principal com peças de áreas diferentes** (caso Paula: Família + Previdenciário no mesmo atendimento) — confirmamos que **um Estudo pode gerar peças de várias áreas dentro do mesmo Caso**? (Hoje `pecas.area` permite isso; a UX precisa abraçar.)
3. **"Etapa"** — você quer mesmo um conceito de andamento do caso (estudo → inicial → contestação → recurso) como **timeline visível**, ou `tipo` de peça basta?
4. **Histórico e Contratos globais** — remover do menu e acessar só via cliente/caso, ou manter como visões globais?
5. **Prioridade de negócio:** começar pela Fase 0 (contexto único) já destrava a maior dor — **confirma** que é por aí que começamos quando sairmos do modo de revisão?

---

*Fim da revisão. Nenhuma alteração de código foi feita. Aguardando sua leitura para decidir o que implementar.*
