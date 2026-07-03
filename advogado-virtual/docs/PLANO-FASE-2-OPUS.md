# Plano Fase 2 — para execução pelo Claude Opus

> **Origem:** decisões do dono do produto em 2026-07-03 sobre o backlog da Parte E, após o parecer [PARECER-FABLE-2026-07-03.md](PARECER-FABLE-2026-07-03.md). Curadoria e decisões de desenho: Fable. Execução: Opus.
>
> **Decisões do dono (2026-07-03):**
> - **Foco do produto: GERAÇÃO DE PEÇAS.** O escritório já usa Astrea para gestão — não competir com ele. Features de gestão entram só no mínimo que serve à geração de peças.
> - **Aprovados para desenvolver:** E1, E2, E3, E4, E6, E9, E10 (+ pacote UX pré-piloto).
> - **Adiados (podem voltar no futuro):** E5 (financeiro/cobrança de honorários), E7 (intimações via API paga), **E8 (intake WhatsApp — backlog, outro momento)**.
> - D1/D2 (billing/registro do SaaS) seguem congelados, como antes.
>
> **Regras de execução (mesmas do §0 do plano original):**
> 1. Um lote = um commit coeso (ou poucos), com testes quando houver lógica pura. `npx tsc --noEmit` + `npm test` + `npm run build` antes de cada push. Push na main autorizado.
> 2. **Prompts curados**: preservar byte a byte. Exceção autorizada neste plano: o Lote 5 ADICIONA um bloco novo ao prompt em runtime (como o de jurisprudência) — não edita os arquivos curados. Se um snapshot mudar, é bug do lote.
> 3. Snapshots só mudam intencionalmente, com diff conferido linha a linha no commit.
> 4. Em ambiguidade real de produto, PARAR e perguntar ao dono. Decisões de desenho já tomadas abaixo — não reabrir.
> 5. Pontos de parada obrigatórios marcados por lote.

---

## Ordem de execução

| Lote | Conteúdo | Esforço | Dependência externa |
|---|---|---|---|
| 0 | Pacote UX pré-piloto (4 itens verificados) | pequeno | — |
| 1 | E1 — selo "citações verificadas" | pequeno | — |
| 2 | E2 — capa do caso via DataJud (nº CNJ) | pequeno-médio | — |
| 3 | E3 — lembrete de prazo por e-mail (cron) | pequeno-médio | dono: 1 env + redeploy |
| 4 | E10 + B6-mínimo — telemetria de edições + painel por prompt | médio | — |
| 5 | E4 + B5.3 — base curada de fundamentação + biblioteca | médio | dono: conteúdo (teses) |
| 6 | E6 — abstração de provedor de assinatura (+ resolve A1d) | médio | credencial ZapSign só p/ ativar |
| 7 | E9 — diff/aceite por seção no editor | alto | — |

E8 (WhatsApp) fica REGISTRADO no backlog, sem spec — não iniciar.

---

## Lote 0 — Pacote UX pré-piloto

Achados verificados no código (greps de 2026-07-03):

1. **Revisão automática pós-geração.** Hoje `validar-peca` só roda no clique ([EditorPecaClient.tsx:103](../src/app/(dashboard)/%5Barea%5D/editor/%5BpecaId%5D/EditorPecaClient.tsx)). Fazer: ao fim da geração (gerar-peca e refinamento-peca), disparar a validação server-side via `after()` (mesmo padrão de `salvarPecaPosStreamSeVazia` em `motor.ts`) gravando o resultado nos campos `validacao_*` que já existem; no editor, se a peça já tem validação gravada, exibir badge no header ("Revisão automática: score N") que abre o drawer existente. NÃO bloquear a geração se a validação falhar (best-effort). Atenção: a validação consome cota `validar_peca` — logar como `validar_peca_auto` para distinguir no painel.
2. **Toast de notificação.** `aprovar`/`rejeitar` já devolvem `emailNotificado`; a UI ignora. No fluxo de revisão (BotoesRevisao), incluir no toast de sucesso: "Autor notificado por e-mail" ou "E-mail não enviado (serviço não configurado)".
3. **Checklist de configuração no dashboard** (mini-C4). Card no dashboard do admin com 4 itens e link direto: dados profissionais (OAB/responsável preenchidos em tenants?), papel timbrado, modelo de contrato, equipe convidada. Some quando 4/4 completo. Server-side simples (consultas leves na própria página do dashboard).
4. **Retorno previsível.** Trocar `router.back()` por navegação com href explícito em: `EditorContratoClient.tsx`, `ModeloProntoClient.tsx`, `FormCliente.tsx` (destinos: contrato → `/contratos` ou casa do caso de origem; modelo → painel da área; form cliente → `/clientes` ou origem explícita via prop).

**Parada:** avisar o dono para validar visualmente (gerar peça → badge de revisão; aprovar peça → toast).

---

## Lote 1 — E1: selo "citações verificadas"

**Decisão de desenho (Fable):** o selo aparece na **UI** (editor e fila de revisão) — **NUNCA dentro do documento exportado** (peça protocolada não deve carregar marca de ferramenta; risco de constrangimento processual).

Fazer:
1. No header do editor de peça, quando houver validação com `citacoes`: chip com o resumo — ex.: `✓ 4 verificadas · ⚠ 1 a conferir · ✗ 0 suspeitas` — clicável, abre o drawer de revisão na seção de citações.
2. Na fila de revisão (`/revisao`), mesma chip por peça (dados já vêm de `validacao_fontes`; se o resumo de citações não estiver persistido, persistir junto no Lote 0.1 — acrescentar `citacoes` ao objeto salvo em `validacao_fontes`).
3. Estado "sem citações detectadas" = chip neutra discreta.

**Aceite:** peça com citação suspeita mostra ✗ vermelho na fila de revisão sem abrir a peça.

---

## Lote 2 — E2: capa do caso via DataJud

Contexto pronto: cliente DataJud em `src/lib/jurisprudencia/datajud.ts`; derivação tribunal→alias em `verificador-citacoes.ts` (`aliasDataJud`); validação de dígito (`validarNumeroCNJ`).

Fazer:
1. Campo **"Número do processo (CNJ)"** no caso (verificar se `atendimentos` já tem coluna; se não, migration `numero_processo text` + índice). Máscara/validação com `validarNumeroCNJ` no cliente (feedback imediato "dígito não confere").
2. Ao preencher/salvar: consulta ao DataJud pelo número exato (padrão `contarProcessoExato`, mas trazendo `_source` completo: classe, órgão julgador, assuntos, data de ajuizamento, movimentos recentes; partes SE o tribunal expuser — muitos não expõem). Exibir card "Dados do processo (DataJud)" na casa do caso com botão "usar estes dados" para preencher a capa.
3. Sempre **sugerir + confirmar**, nunca sobrescrever silenciosamente. Best-effort com timeout (DataJud é lento — padrão 12s já usado); falha → card "não foi possível consultar agora".

**Aceite:** informar um CNJ real → capa sugere classe/órgão/assuntos; CNJ com dígito errado → aviso imediato sem consulta.

---

## Lote 3 — E3: lembrete de prazo por e-mail (enxuto — não é módulo de gestão)

**Escopo mínimo deliberado (não invadir o Astrea):** apenas e-mail diário dos prazos de tarefas **que já existem** no kanban. Sem recorrência, sem convites de agenda, sem sync externo.

Fazer:
1. Rota `src/app/api/cron/lembretes-prazo/route.ts`: busca `tasks` com `due_date` = hoje ou amanhã, não concluídas, agrupa por responsável (`assigned_to` → users.email) e por tenant, e envia 1 e-mail por pessoa via `enviarEmail()` (lib/email.ts) listando as tarefas com link. Proteção: header `Authorization: Bearer ${CRON_SECRET}` — sem o secret correto → 401 (fail-closed, padrão do webhook D4Sign).
2. `vercel.json` com cron diário — atenção: Vercel cron é UTC; usar `0 10 * * *` (≈ 07:00 America/Sao_Paulo).
3. Idempotência: marcar `lembrete_enviado_em` na task (migration, coluna nullable) para não repetir no mesmo dia em re-execução.
4. Log estruturado (`logger.info('cron.lembretes', {enviados}else)`).

**Parada:** dono precisa criar `CRON_SECRET` na Vercel + redeploy. Avisar com instrução de 3 linhas.

---

## Lote 4 — E10 + B6-mínimo: telemetria de edições + painel por prompt

**Racional:** o painel do dono só tem valor se medir o que importa para a curadoria — quanto o advogado **edita** o que a IA gera. Este lote instala o instrumento de medição do piloto.

Fazer:
1. **Telemetria de edições (B6-mínimo):** no `salvar-peca` (versões não-silenciosas) e na aprovação, calcular e gravar métrica de edição — distância normalizada entre `conteudo_markdown` gerado (1ª versão em `pecas_versoes`) e o salvo (ex.: razão de diff por caracteres; lib leve própria, sem dependência — função pura testável `calcularTaxaEdicao(a, b)`). Gravar em coluna `taxa_edicao numeric` na peça (migration) na aprovação/exportação.
2. **Painel por prompt:** estender o painel de consumo existente (`PainelConsumoIA` + rota `uso-ia`) com corte por (área × tipo de peça): nº de peças geradas, taxa média de edição, custo médio. Acesso: role `admin` (no piloto, o dono é o admin do tenant — visão cross-tenant fica para quando houver 2º tenant).
3. Ordenar por taxa de edição decrescente = **fila de curadoria** (o prompt que mais é editado é o próximo a curar).

**Aceite:** gerar peça, editá-la e aprovar → painel mostra a taxa por área×tipo.

---

## Lote 5 — E4 + B5.3: base curada de fundamentação + biblioteca

Desenho completo no [PARECER-FABLE-2026-07-03.md](PARECER-FABLE-2026-07-03.md) §Q2. Resumo executável:

1. **Estrutura:** `src/lib/fundamentacao/tipos.ts` (interface `TeseCurada` conforme o parecer) + `src/lib/fundamentacao/{area}.ts` + `index.ts` (registro por área). Snapshot test protegendo o conteúdo (padrão prompts). Seed inicial: **arquivos vazios ou 1 exemplo por área marcado `EXEMPLO — não usar`** (o conteúdo real é curadoria do dono — NÃO gerar teses por IA).
2. **Injeção na geração:** em `gerar-peca` (curado e fallback), quando a área tiver teses, anexar bloco `## FUNDAMENTAÇÃO VERIFICADA PELO ESCRITÓRIO` com instrução: estas citações são conferidas e podem ser usadas literalmente SEM [VERIFICAR]; as demais regras anti-alucinação seguem valendo. Enquanto houver <10 teses/área, injetar todas as da área (sem seleção por IA).
3. **Verificador reconhece a base:** em `verificador-citacoes`, citação presente na base → status `verificada` com detalhe "consta da base curada do escritório" (match por número de súmula/processo/dispositivo).
4. **Biblioteca (E4) — decisão de desenho (Fable):** UI **somente leitura** em `/biblioteca` (lista por área → detalhe da tese com ementas e fontes). A **edição é via repositório** (ativo versionado, com trilha de revisão) — interface de edição fica para uma fase futura, se a prática pedir.

**Parada:** entregar ao dono o template de 1 tese preenchida como exemplo e pedir as primeiras 5–10 teses da área de maior volume (ele é o curador).

---

## Lote 6 — E6: abstração de provedor de assinatura (resolve também o A1d)

1. Interface `ProvedorAssinatura` em `src/lib/assinatura/provedor.ts`: `criarDocumento`, `enviarParaAssinatura`, `consultarStatus`, `cancelar`, `mapearStatusWebhook` — com um **mapa de status canônico único** (isto conserta a divergência A1d: webhook `'4'→download_ready` vs PATCH `'4'→completed`; decidir pelo mapa do webhook, que é o mais granular, e migrar o PATCH).
2. Adapter `d4sign.ts` implementando a interface sobre o client existente (`src/lib/d4sign/`) — sem mudar comportamento.
3. Adapter `zapsign.ts` esqueleto: implementa a interface, mas construtor exige `ZAPSIGN_API_TOKEN`; sem a env → provedor indisponível (inerte). Seleção por env `PROVEDOR_ASSINATURA` (default `d4sign`).
4. Rotas de contrato passam a falar com a interface, não com o client direto.

**Aceite:** comportamento atual idêntico com `PROVEDOR_ASSINATURA=d4sign`; os dois mapas de status divergentes deixam de existir (fonte única).

---

## Lote 7 — E9: diff/aceite por seção no editor

O maior. Fazer por partes, nesta ordem:

1. **Motor de diff por seção** (`src/lib/diff/secoes.ts`, puro e testado): dividir markdown por headings (`##`/`###`), parear seções de duas versões por título (fuzzy simples: título normalizado; sobras = adicionadas/removidas), diff textual dentro da seção. Sem dependência nova se viável; senão, avaliar `diff` (pacote pequeno) — justificar no commit.
2. **UI de comparação:** no editor, ação "Comparar com versão anterior" (usa `pecas_versoes`, já existente): painel lateral com lista de seções alteradas → visual lado-a-lado/inline por seção → botões **Aceitar** (mantém a nova) / **Restaurar** (volta a antiga) por seção → resultado aplicado no TipTap e salvo pelo fluxo normal (autosave/versão).
3. **Integração com refinamento:** após "refinar peça" (que gera v2), abrir automaticamente o modo comparação v2×v1 — este é o caso de uso nobre (human-in-the-loop fino sobre a reescrita da IA).
4. Telemetria: aceites/restaurações por seção alimentam `taxa_edicao` (Lote 4) com granularidade de seção (campo jsonb opcional).

**Parada:** validação de UX com o dono antes de considerar concluído (é feature de interação — precisa de uso real).

---

## Registro de backlog (não iniciar)

- **E8 — intake WhatsApp:** decisão do dono em 2026-07-03 — backlog, outro momento. Quando voltar: exigirá provedor WhatsApp Business API (conta/custo do dono) + webhook de mídia → transcrição existente.
- **E5 — financeiro (Asaas)** e **E7 — intimações (API paga):** adiados por decisão; podem voltar.
- **D1/D2:** congelados (inalterado).

---

*Preparado pelo Fable em 2026-07-03. Para executar: apontar o Opus para este arquivo e pedir a execução dos lotes em ordem, respeitando os pontos de parada.*
