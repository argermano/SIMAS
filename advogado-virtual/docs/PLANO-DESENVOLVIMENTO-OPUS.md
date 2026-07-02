# Plano de Desenvolvimento — para execução pelo Claude Opus

> **Origem:** [ANALISE-COMPLETA-2026-07.md](ANALISE-COMPLETA-2026-07.md) (parecer completo com evidências) + [REVISAO-ARQUITETURAL.md](REVISAO-ARQUITETURAL.md) (decisões de UX de jun/2026, ainda válidas).
> **Contexto:** produto pré-produção, sem dados reais. Push direto na main faz deploy (Vercel) — autorizado pelo dono do produto para mudanças pedidas.
>
> **Regras para quem for executar:**
> 1. Um item = um PR/commit coeso, com testes quando houver lógica pura. Rodar `npx tsc --noEmit` e `npm test` antes de cada push.
> 2. **Preservar os prompts curados byte-a-byte** exceto quando o item mandar alterá-los explicitamente. Eles são o ativo do produto.
> 3. Itens marcados **[DECISÃO]** dependem de resposta do dono do produto (perguntas na §9 do parecer) — não iniciar sem resposta.
> 4. Ordem recomendada: P0 (inteiro) → B1–B3 do motor → C1–C4 de UX → o resto conforme decisão de negócio.

---

## PARTE A — P0: correções críticas (antes de qualquer dado real)

### A1. Webhook D4Sign: corrigir e endurecer
**Problema:** `src/app/api/webhooks/d4sign/route.ts` usa `createClient()` (anon+cookies) — sem sessão, a RLS bloqueia tudo e o webhook descarta eventos silenciosamente; sem `D4SIGN_WEBHOOK_SECRET` ele aceita qualquer requisição (fail-open); no evento de conclusão grava URL temporária da D4Sign em `signed_file_url`.
**Fazer:** (a) trocar para o admin client (`SUPABASE_SERVICE_ROLE_KEY`, como `arquivo-assinado` já faz) com checagem manual de tenant; (b) secret obrigatório em produção — sem ele, responder 401 (fail-closed); (c) no status "assinado", baixar o binário da URL temporária e gravar em `{tenant}/contratos/{id}/` no Storage (padrão da migration 033), servindo por signed URL; (d) unificar os dois mapas de status divergentes (webhook `'4'→download_ready/'5'→completed` vs PATCH `'4'→completed`) num único módulo.
**Aceite:** evento simulado com secret válido atualiza `contract_signatures` e arquiva o PDF; sem secret retorna 401; PainelAssinatura exibe link permanente.

### A2. Deleções destrutivas: role + soft-delete + auditoria
**Problema:** `clientes/[id]` DELETE e `atendimentos/[id]` DELETE sem `requireRole` — colaborador apaga cliente/caso em cascata, hard-delete, sem trilha.
**Fazer:** `requireRole(['admin','advogado'])` nas duas rotas; coluna `deleted_at` (migration) em `clientes` e `atendimentos` com filtro nas queries e nas policies RLS; `logAudit` em toda exclusão. Manter hard-delete apenas como operação administrativa futura (fora deste item).
**Aceite:** colaborador recebe 403; excluído some das listagens mas permanece no banco com `deleted_at`; linha em `audit_log`.

### A3. Criptografia obrigatória + escopo ampliado
**Problema:** `ENCRYPTION_KEY` é opcional (`src/lib/env.ts`) — sem ela, CPF/RG vão em texto puro com um `console.warn`. Transcrições (dado de saúde na área médica) e áudio sem cifra de aplicação.
**Fazer:** mover `ENCRYPTION_KEY` para as obrigatórias (fail-fast no boot); estender `CAMPOS_SENSIVEIS` para `transcricao_raw`/`transcricao_editada` (com migração/backfill idempotente análoga ao script de CPF); documentar no README que o Storage de áudio depende da cifra em repouso do Supabase (avaliar envelope encryption por tenant em fase posterior).
**Aceite:** boot falha sem a chave; transcrições novas ilegíveis via SQL direto; backfill roda em dry-run e real.

### A4. Transcrição de gravações longas: acumular no servidor
**Problema:** `api/atendimentos/[id]/audio` faz `update({transcricao_raw: transcricao})` a cada chunk de 10 min — sobrescreve o anterior; o acumulado vive só no browser. `enviarChunkParaAPI` (GravadorAudio.tsx) retorna `''` em erro — chunk perdido sem aviso.
**Fazer:** append server-side (ler valor atual e concatenar, ou RPC `append`); no GravadorAudio, distinguir erro de transcrição vazia, exibir aviso e oferecer retry do chunk.
**Aceite:** gravação de 30 min com aba fechada aos 25 preserva os 20 min já transcritos; chunk com falha gera aviso visível e botão de retry.

### A5. Retenção de chunks de áudio (não repetir o incidente de Storage)
**Problema:** chunks WAV (`gravacao_chunk_`) acumulam no bucket até estourar a cota (incidente de jun/2026, resolvido à mão com 10 scripts).
**Fazer:** apagar o chunk do Storage imediatamente após transcrição bem-sucedida (mantendo só o áudio final consolidado, se essa for a política) OU job de limpeza (ver D5-fila) para chunks com mais de 24h; transformar os aprendizados de `scripts/*.mjs` em rotina documentada em `scripts/README.md`.
**Aceite:** após uma gravação completa, nenhum `gravacao_chunk_` órfão permanece no bucket.

### A6. Fechar os furos de cota e custo de IA
**Problema:** `refinamento-peca` (a rota de refino usada pela UI) não chama `verificarCota` e loga endpoint fora das categorias; caminho de fallback genérico de `gerar-peca` não loga uso; `gerar-contrato`, `gerar-documento`, `editor-documento`, `extrair-dados-cliente` sem cota/log; `usage.ts` precifica tudo como Sonnet; transcrições Groq não entram no log.
**Fazer:** cota+log em todas as rotas de IA; tabela de preço por modelo (resolvida pelo campo `modelo` já gravado): Sonnet 4.6/5 $3/$15, Opus 4.8 $5/$25, Haiku 4.5 $1/$5 por MTok; registrar transcrição (duração do áudio × preço Whisper) no `api_usage_log`.
**Aceite:** todas as chamadas de IA aparecem no painel uso-ia com custo pelo modelo correto; refino conta na cota `refinar_peca`.

### A7. Robustez do stream no cliente
**Problema:** `useStreaming` (StreamingText.tsx) divide chunks por `\n` sem guardar linha parcial — evento SSE cortado na fronteira aborta gerações longas; o evento `done` carrega `stopReason` e o cliente ignora — peça truncada por `max_tokens` é salva como completa.
**Fazer:** buffer de linha parcial entre reads; linhas malformadas ignoradas de fato; se `stopReason === 'max_tokens'`, avisar o advogado ("a peça pode estar incompleta") com opção de continuar a geração.
**Aceite:** simulação com chunks cortados no meio de `data:` não aborta; geração que estoura tokens exibe aviso.

### A8. Higiene de segurança menor (agrupável num PR)
- `WITH CHECK` na policy `users: gerenciar próprio` impedindo o próprio usuário de alterar `role`/`tenant_id` (migration).
- Validar posse de FKs no tenant antes de inserir (`atendimentos.cliente_id`, `contratos.cliente_id/atendimento_id`, `tasks.*`).
- Estender `file-validation.ts` (magic bytes) ao fluxo principal de upload de documentos/áudio.
- `gerar-documento`: migrar para `completionJSON`/`streamCompletion` (ganha guardrail, limite e log).
- `maxDuration` nas rotas de IA bloqueantes (`analise`, `analise-geral`, `gerar-documento`, e nas que forem religadas).
- `upload-modelo` de contrato: `requireRole` + avisar (não truncar silenciosamente) modelos >8.000 chars.

---

## PARTE B — Motor de IA v2 (evoluir, não reescrever)

**Princípios (decisões já registradas):** unificar a orquestração; manter/expandir prompts curados por área+peça como ativo versionado; anti-alucinação como requisito de produto — o modelo **nunca** cita julgado "de memória".

### B1. Contexto documental integral (a maior alavanca de qualidade — 1 PR)
**Problema:** todos os 10 builders truncam cada documento a 500 chars (`texto_extraido?.substring(0, 500)`); a triagem vê 800/doc e 600 da transcrição. A peça é redigida sem ler as provas.
**Fazer:** remover o truncamento nos builders (curados + genérico); orçamento por documento generoso (ex.: 20–30k chars/doc) com a triagem de relevância existente + `MAX_PROMPT_CHARS` (600k chars) como guardas; documentos acima do orçamento entram resumidos por Haiku (com marcação "resumo — íntegra disponível"); triagem de relevância passa a ver 2–4k chars/doc e a transcrição inteira.
**Aceite:** peça previdenciária de teste com CNIS de 10 páginas cita períodos contributivos que hoje ficam fora dos 500 chars.

### B2. Correções de fundação da API Anthropic (1 PR)
1. **Upgrade do SDK** `@anthropic-ai/sdk` para a versão atual.
2. **"Raciocínio estendido" de verdade:** no modo `avancado` (Opus 4.8), enviar `thinking: {type: 'adaptive'}` + `output_config: {effort: 'high'}`. Hoje só troca o modelo — no Opus 4.8, omitir `thinking` roda sem raciocínio, e o modelo tende a vazar reflexão no texto visível (o workaround `JSON_ONLY` em `client.ts` trata o sintoma disso).
3. **Structured outputs** nas 7 chamadas JSON (`analise`, `analise-geral`, triagem de relevância, `extrair-dados-cliente`, validação, refino JSON): usar `output_config: {format: {type: 'json_schema', schema}}` — elimina `extrairJsonDoTexto`/`JSON_ONLY` e o erro "A IA não retornou um JSON válido". Passar schemas Zod ao parâmetro `schema` que `completionJSON` já aceita como validação de segunda camada.
4. Remover o header beta `output-128k-2025-02-19` (no-op em Claude 4+).
5. **Persistência server-side do stream:** acumular o texto no servidor (via `finalMessage()` em paralelo ao SSE) e salvar a peça ao término do stream independentemente do cliente — fechar a aba não pode mais gerar peça vazia. `salvar-peca` continua existindo para as edições do usuário.
6. Gravar `prompt_utilizado` completo (ou hash + cópia no Storage) para reprodutibilidade — hoje trunca a 500 chars.
7. OCR (Haiku): `max_tokens` por tamanho do documento ou processamento por página — 4.096 trunca PDFs longos.

### B3. Religar o ciclo validar → corrigir (código pronto, hoje morto)
**Problema:** `api/ia/validar-peca` (IA + `validarFormatacaoPeca` determinística), `api/ia/correcao-auto` e `RelatorioValidacao.tsx` não têm nenhum caller — justamente a camada que mitiga alucinação.
**Fazer:** após cada geração/refino, disparar validação automática server-side (ver D5 para onde roda) e expor o resultado no editor como painel de avisos (score + itens: qualificação correta? [PREENCHER] pendentes? pedidos numerados? citações marcadas?); botão de correção de um clique por item via `correcao-auto`. Consolidar `refinamento-peca`/`refinar-peca` sob o motor único com `modo ∈ {criar, refinar, corrigir}` (já desenhado em `motor.ts`; a REVISAO-ARQUITETURAL Fase 3 descreve a consolidação — preservar prompts).
**Aceite:** gerar peça → editor abre com painel "Revisão automática" preenchido; um clique corrige um item apontado; rotas duplicadas removidas.

### B4. Pipeline de geração em etapas (o novo `gerarPeca`)
Para `modo: criar` em peças longas (inicial, contestação, recursos), substituir o one-shot por:

| Etapa | Modelo | Forma | Observação |
|---|---|---|---|
| 1. Extração estruturada de fatos/partes/pedidos | Haiku 4.5 | structured output | centavos; alimenta as etapas seguintes e o banco |
| 2. Plano da peça (seções, teses, pedidos, provas a citar) | Sonnet 5 | structured output | **exibido ao advogado como prévia editável** antes da redação — controle + percepção de valor |
| 3. Redação | Sonnet 5 (padrão) / Opus 4.8 + adaptive thinking (avançado) | streaming SSE | prompt curado como bloco system estável **com `cache_control`** (TTL 1h); contexto volátil depois do breakpoint |
| 4. Revisão crítica em contexto separado | Opus 4.8 | structured output | checklist curado por tipo de peça (ex.: requisitos do art. 319 CPC); "fresh-context verifier" supera self-critique no mesmo contexto |
| 5. Verificação de citações | Haiku (extração) + fontes externas | determinística | ver B5 |

- Documentos curtos (procuração, notificação, declarações) permanecem one-shot com structured output.
- **Prompt caching:** o pipeline reusa o mesmo prefixo (curado + few-shots + docs do caso) em 3+ chamadas — cache read a 0,1× paga o write de 2× (TTL 1h) já na 3ª chamada. Manter modelo fixo dentro da sessão (trocar modelo invalida o cache).
- **Custo estimado por peça:** rotineira (Sonnet) ~US$ 0,15–0,35 (R$ 1–2); complexa (Opus nas etapas 3–4) ~US$ 0,70–1,00 (R$ 4–6). Desprezível frente ao preço de venda — otimizar para qualidade.
- **Batch API (−50%)** para pré-processamento noturno de autos volumosos e regeneração em massa após atualizar prompts.
- **[DECISÃO]/infra:** o pipeline completo leva minutos e não cabe num request serverless. Opções: (a) `after()`/`waitUntil` do Next 15 para as etapas 4–5 pós-stream (mais simples, limite de tempo da Vercel); (b) fila leve (Upstash QStash ou Inngest) para etapas assíncronas + notificação na UI. Recomendação: começar com (a) para a validação e adotar (b) quando o pipeline completo entrar.

### B5. Fundamentação verificada (anti-alucinação como produto)
1. **Curto prazo (junto com B1):** parar de instruir o modelo a "citar os processos" do DataJud. Reposicionar o resultado DataJud como **estatística processual** ("há N processos semelhantes no TRF-X" — metadado, sem teor); manter a instrução de marcar julgados com [VERIFICAR]. Alterar os builders e `anexarModeloEJurisprudencia` (`motor.ts`) — esta é a exceção autorizada à regra de preservar prompts.
2. **Verificador determinístico pós-geração:** extrair citações da peça (regex CNJ/artigos/súmulas + Haiku com strict tool use); validar: número de processo → DataJud (existência); lei/artigo → LexML (URN persistente, público); julgado/ementa → apenas se veio de fonte recuperada no contexto. Não confirmada → marcada em vermelho no editor (ou removida, configurável). **UI com status por citação: verificada ✓ / não verificada ✗.**
3. **Base curada de fundamentação por área** (ativo editorial, versionado no repo como os prompts): teses típicas + súmulas/artigos verificados por humano + ementas confiáveis, injetada no prompt como bloco citável. Cresce com a curadoria contínua **[DECISÃO: quem cura]**.
4. **Médio prazo [DECISÃO: custo]:** integrar fonte de jurisprudência real com ementas sob demanda (Escavador API, por consumo ~R$ 0,10–0,20/consulta) alimentando a base curada.

### B6. Prompts curados como ativo de 4 camadas + regressão
- Reorganizar em `base (regras forenses) + área (fundamentos, tom, órgãos) + peça (estrutura, requisitos) + modo (criar/refinar/corrigir)` — hoje base+peça estão misturados; separar permite curar a área uma vez e herdar em todas as peças. Migração mecânica preservando o texto.
- Expandir cobertura por prioridade comercial **[DECISÃO: quais áreas×peças]** — candidatos óbvios: réplica, recurso inominado/apelação, recurso ordinário trabalhista, embargos.
- **Suíte de regressão:** 2–3 casos golden por prompt curado (entrada fixa → peça avaliada por LLM-judge Sonnet 5 contra rubrica: estrutura, uso dos fatos, ausência de citação não fornecida, formatação). Rodar a cada mudança de prompt ou de modelo.
- **Telemetria de edições:** diff entre a peça gerada e a versão salva pelo advogado, agregado por (área, tipo) → fila de curadoria. O ativo cresce com o uso.

---

## PARTE C — UX (consolida a REVISAO-ARQUITETURAL + achados novos)

### C1. Correções pontuais de alto impacto (1 PR cada)
1. **Painel de assinatura visível:** mover o `PainelAssinatura` para dentro do overlay do editor de contrato (painel lateral/banner) ou dar ao contrato tela de detalhe própria — hoje fica atrás do `fixed inset-0`.
2. **Autosave + guarda de saída no editor:** debounce ~3s sobre o `handleSalvar` existente; interceptar Voltar/beforeunload com alterações não salvas.
3. **Labels centralizados:** um único `LABELS_AREA`/`LABELS_STATUS` (de `@/types`) em todas as telas — Revisão/Histórico hoje mostram slug cru para 5 das 11 áreas.
4. **Dark mode:** substituir as ~36 cores claras fixas por tokens semânticos do design system.
5. **Remover jargão dev** de Configurações (build/commit/ENCRYPTION_KEY para um rodapé discreto ou rota interna).

### C2. Unificação do fluxo (o item grande — fazer por fases, como a revisão já previa)
- **Uma tela de captura** (cliente + relato áudio/texto + docs) que cria o Caso; **Casa do Caso como destino e origem de todas as ações** (análise, gerar peça sem repassar pela tela de relato, contrato, tarefas). Eliminar as três telas gêmeas (~2.350 linhas duplicadas) e o "degrau" do relato duplo. Meta: jornada de ~13 para ~7 passos.
- Vocabulário único voltado ao advogado: **"Caso"** (não "atendimento") e **"Estudo do caso"** (um nome só para análise IA).
- Breadcrumbs (Cliente → Caso → Peça) + retorno sempre com href explícito (nunca `router.back()`); Casa do Caso como link canônico do caso em todas as listas.

### C3. Fechar ciclos abertos
- **"Minhas peças"** para colaborador/autor (status: aguardando revisão / rejeitada com motivo / aprovada) — hoje o colaborador perde a peça de vista ao enviar.
- **Órfãs [DECISÃO]:** promover `/historico` como "Todos os casos" na sidebar (não existe lista global de casos) ou remover; absorver o checklist de `/[area]/abertura` na Casa do Caso ou remover; apagar rotas/componentes mortos restantes (lista no parecer §2).

### C4. Onboarding do escritório (first-run)
Wizard de 3–4 passos no primeiro login do admin: dados profissionais (OAB/responsável — hoje silenciosamente necessários para contratos) → timbrado/formatação → modelo de contrato → convite da equipe; checklist de progresso no dashboard. Elimina a principal causa de contratos incompletos.

### C5. Mobile (mínimo agora, PWA sob decisão)
Corrigir: hambúrguer sobre o título do Header; grids fixos (`grid-cols-3`/`grid-cols-2`) sem breakpoint; calendário do kanban sem alternativa <xl; KeyboardSensor no dnd-kit. **[DECISÃO]** PWA instalável/offline se gravar em campo for cenário-chave.

---

## PARTE D — Produto, operação e compliance

### D1. Billing e planos **[DECISÃO: gateway e preços]**
Expiração de trial + enforcement de `tenants.status` (suspenso/cancelado bloqueia acesso — hoje nada checa); alinhar nomes/limites da landing com os planos reais; aplicar limites prometidos (usuários, clientes); integração de pagamento (Pix/boleto/cartão — Asaas/Pagar.me se cobrança BR; Stripe se cartão apenas); modelo de cobrança recomendado pelo mercado: franquia de peças/casos + excedente por uso, não por mensagens.

### D2. Registro e funil **[DECISÃO: self-serve vs venda assistida]**
Se self-serve: reativar `/registro` com criação segura de tenant (o antigo `setup-user` foi desativado por inseguro — refazer com fluxo de verificação), onboarding C4 na sequência, preços na landing. Se venda assistida: ajustar CTAs da landing ("Agendar demonstração") e mover o form de contato do login para a landing.

### D3. Observabilidade (antes do piloto)
Sentry (ou equivalente) em client+server; adotar o `lib/logger.ts` existente (hoje código morto) nas rotas no lugar de `console.*`; métricas mínimas de produto (ativação, peças geradas, edição média por peça — alimenta B6); alerta de custo de IA por tenant.

### D4. E-mails transacionais
Completar com a identidade existente em `lib/email.ts`: boas-vindas, peça aprovada/rejeitada (com motivo), prazo de tarefa; customizar o template de reset de senha do Supabase; alertar visivelmente quando `RESEND_API_KEY` ausente (hoje o convite "funciona" e o e-mail não sai).

### D5. Fila/jobs assíncronos
Upstash QStash ou Inngest (serverless-friendly) para: etapas 4–5 do pipeline (B4), limpeza de chunks (A5), regeneração em massa/Batch API, e-mails. Começar com `after()` do Next 15 onde couber.

### D6. Rate limiting real
Upstash Redis nas rotas de IA (por tenant e por IP no login/esqueci-senha); substitui o in-memory de `/api/contato`.

### D7. LGPD — direitos do titular **[DECISÃO: prazo]**
Exportação estruturada (JSON/ZIP) por cliente e por tenant; exclusão/anonimização em cascata com auditoria; política de retenção documentada (áudio, transcrições, logs); `logAudit` em todas as operações sobre clientes/peças/contratos/assinaturas (wrapper na camada withAuth para não depender de disciplina por rota).

### D8. Exportação com fidelidade e trilha
PDF derivado da pipeline DOCX (Gotenberg/LibreOffice headless) — o PDF assinado passa a ser idêntico ao revisado; arquivar artefato exportado no Storage + SHA-256 em `exportacoes` (trilha probatória); máquina de estados de contrato (exportar não regride "assinado"; status muda APÓS gerar com sucesso); timbrado também no DOCX de contrato; editor: desabilitar na toolbar o que não sobrevive à exportação (tabela/imagem/fonte/alinhamento) até suportá-los no docx-generator.

### D9. Testes e CI
Adicionar lint ao CI existente; testes de rota para os fluxos críticos (auth/RLS cross-tenant, webhook D4Sign, gerar-peca com cota, contratos); 1 E2E feliz (login → caso → peça → export) com Playwright; smoke test pós-deploy.

---

## PARTE E — Novas funcionalidades (backlog de produto, ordenado por valor/esforço)

| # | Funcionalidade | Racional de mercado | Esforço |
|---|---|---|---|
| E1 | **Selo "citações verificadas"** na peça (materializa B5 na UI e no marketing) | dor nº 1 do mercado; CoCounsel vende isso como diferencial central | baixo (após B5) |
| E2 | **Enriquecimento de capa processual via DataJud** (grátis): ao informar nº CNJ no caso, autocompletar partes/vara/classe | uso correto do DataJud; custo zero | baixo |
| E3 | **Agenda de prazos com lembretes** (manual, ao lado do kanban) | item mínimo do stack de gestão para não perder vendas | baixo |
| E4 | **Biblioteca de teses/ementas curadas por área** (interface de curadoria sobre B5.3) | transforma a curadoria em ativo visível e vendável | médio |
| E5 | **Financeiro mínimo de honorários via Asaas** (boleto/Pix vinculado ao contrato) | ADVBOX valida o padrão; não construir módulo contábil | médio |
| E6 | **Abstração de provedor de assinatura** + Clicksign/ZapSign | D4Sign: 10 req/h, sandbox default; reduz dependência | médio |
| E7 | **Módulo de intimações/publicações via API parceira** (Escavador/Codilo/Jusbrasil), como add-on cobrado à parte | transforma o maior "gap" vs gestão em integração, não engenharia; repassar custo por volume | médio |
| E8 | **Intake de cliente via WhatsApp** alimentando o mesmo caso (relato por áudio → transcrição existente) | canal esperado no segmento (ChatADV, Lexter); encaixa no fluxo atual | alto |
| E9 | **Diff/aceite por seção no editor** (peça v2 vs v1, aceitar/rejeitar por bloco) | eleva o human-in-the-loop; telemetria de edições fica precisa | alto |
| E10 | **Painel do dono do produto**: uso por tenant, custo de IA, peças/edições por prompt curado | operar o negócio; decidir curadoria com dados | médio |

**Não construir** (validado pela análise de gestão): timesheet, faturamento por hora, BI gerencial, contabilidade — território dos incumbentes enterprise, fora do ICP.

---

## Sequência sugerida (resumo)

```
Semana 1-2  → PARTE A inteira (A1..A8)                      [nada depende de decisão]
Semana 2-4  → B1, B2, B3 (fundação do motor)                [nada depende de decisão]
            → C1 (correções pontuais de UX)
Semana 4-8  → B4 + B5 (pipeline + verificação) com D5 (fila)
            → C2/C3/C4 (unificação de fluxo + onboarding)
Paralelo    → D1/D2 assim que as decisões de negócio saírem
Antes do piloto → D3 (observabilidade), D6 (rate limit), D9 (testes de rota), A3 aplicado
Depois      → PARTE E na ordem da tabela
```
