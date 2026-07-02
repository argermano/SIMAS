# Análise Completa do Produto — SIMAS / Advogado Virtual

> **Data:** 2026-07-02 · **Status do produto:** pré-produção, sem dados reais — toda mudança é viável.
> **Método:** análise multi-agente sobre o código real (motor de IA, UX, dados/segurança, contratos/exportação, inventário de features) + pesquisa de mercado (concorrentes de IA jurídica e de gestão, melhores práticas de geração de documentos jurídicos com LLM, jul/2026). Afirmações sobre código citam arquivo/linha. Fontes de mercado listadas ao fim.
> **Complementa** (não substitui) [REVISAO-ARQUITETURAL.md](REVISAO-ARQUITETURAL.md) de 2026-06-13, cujas decisões (Caso como hub, prompts curados, motor unificado) permanecem válidas e parcialmente implementadas.
> **Plano executável derivado desta análise:** [PLANO-DESENVOLVIMENTO-OPUS.md](PLANO-DESENVOLVIMENTO-OPUS.md).

---

## 1. Sumário executivo

**O produto é real e funcional de ponta a ponta** — cliente → caso → relato por áudio/texto → análise → peça com prompts curados → editor → DOCX com timbrado → contrato com assinatura — sobre uma base técnica saudável (multi-tenant com RLS, TypeScript estrito, 73 testes de lib, 1 único `any` no src). E ocupa **o espaço mais aberto do mercado brasileiro**: nenhum concorrente tem como núcleo o fluxo *atendimento gravado → transcrição → caso → peça multi-área*. A Lexter (WhatsApp) e o ChatJurídico (triagem) apenas tangenciam; os softwares de gestão começam no processo já distribuído; o Jusbrasil comoditizou o *chat* de IA, não o *fluxo de trabalho*.

**Cinco conclusões centrais:**

1. **O motor de IA deve ser EVOLUÍDO, não reescrito.** A fundação (registro de prompts curados por área+peça, fiação comum, SSE, cota, guardrail anti-injection) é sólida. Mas hoje a peça — o produto principal — é redigida **quase sem ler as provas**: todos os 10 builders de prompt truncam cada documento em 500 caracteres. E a "jurisprudência" DataJud injeta apenas metadados processuais (sem ementa, sem teor) com instrução de citá-los — **induzindo exatamente a alucinação que já rendeu multas de TJSC e TRT-12 a advogados** e é a reclamação nº 1 contra o Jus IA no Reclame Aqui.
2. **Confiabilidade de citação é a régua competitiva de 2026.** Stanford (JELS 2025) mostrou que até RAG jurídico comercial alucina em 17–33% das consultas; 1.300+ processos com citações fabricadas já foram documentados. Internacionalmente, o CoCounsel vende "citações garantidas contra o Westlaw" como diferencial central. Um verificador determinístico de citações (DataJud valida existência de processo, LexML valida legislação, base curada interna fornece ementas) é diferencial de produto, não "feature de segurança".
3. **O funil comercial não existe.** Zero código de billing (planos são coluna TEXT sem cobrança nem expiração de trial; tenant "cancelado" mantém acesso total), registro público desativado (landing promete "teste grátis sem cartão" e o CTA redireciona ao login), observabilidade zero em produção (Sentry/analytics ausentes; o logger estruturado com redação existe e **nenhuma rota o usa**).
4. **Há 4 problemas críticos/altos de segurança e correção** que precisam ser resolvidos antes de qualquer dado real: webhook D4Sign simultaneamente **inseguro** (fail-open sem secret) e **quebrado** (usa cliente anon, a RLS bloqueia — contratos nunca viram "assinado" via callback); DELETE de cliente/caso sem checagem de papel (colaborador apaga tudo, sem auditoria, hard-delete); ENCRYPTION_KEY opcional (CPF/RG em texto puro por padrão) e relatos de saúde/áudio sem cifra de aplicação; transcrição em chunks que **sobrescreve** em vez de acumular (fechar a aba = perde tudo menos os últimos 10 min do relato).
5. **A dor de UX continua sendo a fragmentação** já diagnosticada na revisão de junho: três telas gêmeas de captura (~2.350 linhas duplicadas), quatro nomes para "análise", jornada de 11–14 cliques, e agora somam-se dark mode quebrado em ~36 pontos, editor sem autosave e o painel de assinatura encoberto pelo editor fullscreen.

**Posicionamento recomendado:** *plataforma de produção jurídica com IA* (do atendimento à peça protocolável), nunca "mais um software de gestão" nem "mais um chat de IA". Preço de referência: entrada R$ 79–99/mês, cheio R$ 149–179, escritório R$ 249–299 — cobrando por **peça/caso**, não por mensagens.

---

## 2. O que está implementado (inventário verificado)

28 páginas, ~72 rotas de API, 33 migrations, 27 tabelas. Status verificado por leitura de código e grep de referências:

### Completo e funcional (19)
| Feature | Evidência / observação |
|---|---|
| Landing page pública | `src/app/page.tsx` (795 linhas) — mas o form de contato está na página de **login**, não na landing; CTAs de "teste grátis" caem no login |
| Formulário de contato (leads) | honeypot + rate limit in-memory + Resend; reply-to com fallback em e-mail pessoal hardcoded |
| Auth + equipe por convite | registro público desativado de propósito; convites com audit_log |
| Dashboard (11 áreas) | todas as áreas `ativo:true`; branch "Em breve" morto |
| Clientes (CRUD + dossiê) | CPF/RG AES-256-GCM; extração de dados por IA/Vision; dossiê com timeline é destaque de UX |
| Estudo de Caso com IA | relato por gravação/upload/digitação; versão Padrão (Sonnet)/Raciocínio estendido (Opus) |
| Casa do Caso (hub) | implementa as decisões 1–4 da revisão arquitetural (jun/2026) |
| Geração de peças com IA | prompts curados 5 áreas × 2 tipos + fallback genérico; triagem de docs + DataJud em paralelo; SSE |
| Editor TipTap + export DOCX/timbrado | timbrado injetado no XML; **round-trip perde tabela/alinhamento/fonte** (ver §5) |
| Refinamento de peça | upload .pdf/.docx/.txt → nova versão |
| Consultoria/análise por área | terceira tela de análise (redundância reconhecida) |
| Modelos prontos | procuração, declarações, substabelecimento etc.; templatização automática de .docx |
| Contratos de honorários | geração IA + aprovação + export; PDF via jsPDF é a pior renderização do sistema |
| Assinatura manual de contrato | status "assinado" + importar arquivo (migration 033) |
| Workflow de revisão | fila + prazo + tarefa no kanban; colaborador perde a peça de vista após enviar (ver §6) |
| Tarefas/Kanban | board único por tenant; dnd-kit sem suporte a teclado |
| Transcrição de áudio (Groq Whisper) | 3 entradas; chunks de 10 min — **acumulação só no browser** (ver §5) |
| Configurações do escritório | perfil, timbrado, formatação, modelos, consumo de IA |
| Auditoria de usuários | só rotas de usuário; clientes/peças/contratos não são auditados |

### Parcial (3)
- **Assinatura digital D4Sign** — fluxo completo em código, mas webhook quebrado+inseguro, sandbox por default, URL temporária persistida como link permanente do PDF assinado.
- **Cotas e planos de IA** — enforcement existe (`quota.ts`) mas com furos (a rota de refino usada pela UI não checa cota; fallback genérico não loga; contrato/documento/editor sem cota) e **sem billing: os planos são letra morta comercialmente**.
- **Jurisprudência DataJud** — funciona tecnicamente, mas entrega metadados sem teor decisório e o prompt induz a citá-los como precedente. Como está, é um risco, não uma feature.

### Morto / órfão (5 grupos — decisão necessária)
- `/[area]/abertura` (checklist de documentos, 387 linhas) e `/historico` — páginas sem nenhum link de entrada.
- `api/ia/validar-peca` + `api/ia/correcao-auto` + `RelatorioValidacao.tsx` — **o ciclo de validação/correção que mitigaria alucinação está pronto e desligado** (~250 linhas sem caller).
- `api/ia/comando` + `ComandosRapidos.tsx` — sem montagem.
- Rotas legadas: `refinar-peca`, `exportar`, `templates/[tipo]`, `contratos/exportar`, `contratos/exportar-docx`, `usuarios/perfil` + 6 componentes não referenciados.

### Qualidade de engenharia
- `tsc --noEmit` limpo; 1 `any`; zero TODO/FIXME; validação Zod de env e de request centralizada (66 de 72 rotas no padrão withAuth).
- 73 testes (13 arquivos, só funções puras de `src/lib`); **CI existe** na raiz do repo (`.github/workflows/ci.yml`: type-check + vitest + build em push/PR) — faltam lint no CI, testes de rota e E2E.
- 7 componentes >500 linhas; 3 gerações de sistemas de template convivendo; ~10 rotas mortas.
- **Incidente operacional real** (jun/2026): estouro da cota de Storage do Supabase por chunks WAV de gravação — resolvido manualmente com 10 scripts não commitados e bypass de trigger via Postgres direto. **Não há retenção/limpeza automática: o risco de recorrência permanece.**

---

## 3. Motor de IA — diagnóstico e veredicto

### Como funciona hoje
- 16 rotas `/api/ia/*` sobre wrapper comum (`client.ts`: SSE, JSON, guardrail anti-injection, teto de 600k chars) e núcleo de peças (`motor.ts` + `registro-pecas.ts`).
- Geração **one-shot**: um prompt system+user → stream SSE → **o browser salva** o resultado via `salvar-peca`.
- Modelos: Padrão = `claude-sonnet-4-6`; Raciocínio estendido = `claude-opus-4-8`; OCR = `claude-haiku-4-5` (4.096 tokens — trunca PDFs longos).
- Prompts curados: 10 combinações (5 áreas × inicial/contestação) de ~74–104 linhas + regras forenses compartilhadas (116 linhas) + fallback genérico ciente de área/tipo. **Este é o maior ativo do motor.**

### Problemas por severidade (evidências no código)
| # | Problema | Sev. |
|---|---|---|
| 1 | **Documentos truncados a 500 chars** em todos os 10 builders (`substring(0,500)`); triagem de relevância vê 800 chars/doc e 600 da transcrição. A peça é escrita sem ler CNIS, laudos, contratos — o teto real (600k chars) está longe de ser atingido | crítica |
| 2 | **DataJud citado como jurisprudência** sem teor decisório; nenhuma verificação externa de citações (a "validação" é a própria IA se auto-avaliando — e está desligada) | alta |
| 3 | **Furos de cota/custo**: `refinamento-peca` (a rota de refino da UI) sem `verificarCota` e categorizada como "Outros"; fallback genérico sem log; contrato/documento/editor/extração sem cota nem log; `usage.ts` precifica tudo como Sonnet ($3/$15) — Opus subestimado ~40%, Haiku de OCR nem registrado | alta |
| 4 | **Ciclo validar→corrigir órfão**: validar-peca, correcao-auto, refinar-peca sem nenhum caller no frontend | média |
| 5 | **Cliente SSE frágil**: `useStreaming` não guarda linha parcial entre chunks (aborta gerações longas intermitentemente); `stopReason` ignorado — peça truncada por `max_tokens` é salva como completa, sem aviso | média |
| 6 | `gerar-documento` chama o SDK direto, fora do wrapper (sem guardrail, sem limite, sem log); rotas bloqueantes sem `maxDuration` | média |
| 7 | JSON sem schema: o parâmetro Zod de `completionJSON` existe e nenhum dos 7 chamadores usa; sem structured outputs da API | baixa |
| 8 | "Raciocínio estendido" **não liga raciocínio**: só troca Sonnet→Opus, sem `thinking: adaptive` nem `effort` — no Opus 4.8, omitir `thinking` roda SEM thinking (o comentário em `JSON_ONLY` já convive com o sintoma); header beta `output-128k` é no-op em Claude 4+; sem prompt caching em lugar nenhum; `prompt_utilizado` truncado a 500 chars (irreprodutível) | baixa/média |

### Veredicto: **EVOLUIR** (consenso da análise de código + melhores práticas de mercado)
Reescrever jogaria fora o principal ativo (curadoria por área+peça, decisão de produto já registrada). O que muda é o **pipeline** e a **fundamentação**:

1. O consenso 2025-26 para documento jurídico longo é **não gerar one-shot**: extração estruturada → plano/esqueleto → redação → revisão crítica em contexto separado → verificação determinística de citações → revisão humana (benchmarks CaseGen/JUSTICE; docs Anthropic para agentes).
2. Modelo por etapa: **Haiku 4.5** ($1/$5 MTok) para classificação/extração/limpeza; **Sonnet 5** ($3/$15; intro $2/$10 até 31/08/2026) para plano, peças rotineiras e LLM-judge de regressão; **Opus 4.8** ($5/$25, 1M de contexto) para redação nobre e revisão crítica, com `thinking: adaptive` + `effort: high`.
3. **Prompt caching arquitetural** (prompt curado + few-shots como bloco system estável com `cache_control`; leitura a 0,1×) e **Batch API** (−50%) para pré-processamento — peça complexa sai por ~US$ 0,70–1,00 (R$ 4–6), rotineira ~US$ 0,15–0,35 (R$ 1–2). **O custo de IA é desprezível frente ao preço de venda: otimizar para qualidade, não para economizar tokens.**
4. **Anti-alucinação como requisito**: o modelo só cita julgado que veio de fonte recuperada com identificador verificável; validador determinístico (DataJud = existência de processo; LexML = legislação, com URN persistente; base curada interna = ementas) com status ✓/✗ visível na UI.
5. **Prompts curados como ativo versionado em 4 camadas** (base forense + área + peça + modo), com suíte de regressão (casos golden avaliados por LLM-judge a cada mudança de prompt/modelo) e telemetria de edições do advogado alimentando a fila de curadoria.

A especificação completa do motor-alvo está no [PLANO-DESENVOLVIMENTO-OPUS.md](PLANO-DESENVOLVIMENTO-OPUS.md), Parte B.

**Restrição de infraestrutura identificada pelo crítico:** não há fila/jobs assíncronos (sem QStash/Inngest/BullMQ, sem `vercel.json`/cron, sem `waitUntil`). Um pipeline multi-etapa de minutos não cabe num request serverless — o plano precisa dizer onde esses jobs rodam.

---

## 4. Dados, segurança e LGPD

**Pontos fortes:** RLS por tenant em 27 tabelas + storage por prefixo; padrão withAuth consistente; criptografia de CPF/RG com backfill; guardrail anti-injection central; magic bytes onde é usado.

**Problemas (todos verificados):**
| # | Problema | Sev. |
|---|---|---|
| 1 | Webhook D4Sign: fail-open sem secret **e** cliente anon bloqueado pela RLS — inseguro e não-funcional ao mesmo tempo; `signed_file_url` grava URL temporária da D4Sign como link permanente | alta |
| 2 | DELETE de cliente e de caso sem `requireRole` — colaborador apaga cliente inteiro em cascata, hard-delete, sem auditoria | alta |
| 3 | `ENCRYPTION_KEY` opcional → CPF/RG em texto puro por padrão; transcrições (dado de saúde na área médica — LGPD art. 11) e áudios sem cifra de aplicação | alta |
| 4 | Sem direitos do titular (LGPD art. 18): nenhuma exportação estruturada por cliente/tenant, nenhuma exclusão/anonimização em cascata, nenhuma política de retenção | alta |
| 5 | Auditoria só em usuários; nada sobre clientes/peças/contratos/assinaturas | média |
| 6 | FKs não validadas contra o tenant (POST atendimentos/contratos/tasks aceitam IDs de outro tenant) | média |
| 7 | Policy RLS de `users` sem `WITH CHECK` — usuário pode, no nível do banco, alterar o próprio `role`/`tenant_id` | média |
| 8 | Upload principal de docs/áudio confia no fileType do cliente (magic bytes existe em `file-validation.ts` mas só 2 rotas usam) | baixa |
| 9 | Cota com corrida TOCTOU; rate limit real só em `/api/contato` (in-memory, inócuo em serverless) | baixa |

**Argumento de mercado:** nenhum incumbente oferece garantias claras de privacidade sobre dados de IA (onde processa, retenção, não-treinamento). O SIMAS lida com **áudio de atendimento** — dado sensível por natureza. Um posicionamento explícito de privacidade (DPA em português, retenção declarada) vira argumento de venda, não só compliance.

---

## 5. Contratos, documentos e exportação

- **O PDF juridicamente assinado é a pior renderização do sistema**: jsPDF cru, sem negrito (regex remove `**`), sem justificação, margens erradas, sem timbrado — visivelmente inferior ao DOCX que o advogado revisou. Recomendação: derivar o PDF da mesma pipeline DOCX (conversão DOCX→PDF via Gotenberg/LibreOffice headless).
- **Round-trip do editor perde formatação**: a toolbar oferece tabela/imagem/alinhamento/fonte, mas turndown→markdown não serializa nada disso — quebra do WYSIWYG no produto cuja saída vai ao tribunal. Curto prazo: desabilitar na toolbar o que não sobrevive à exportação.
- **Transcrição em chunks sobrescreve** `transcricao_raw` a cada POST (o acumulado vive só no browser); chunk com erro vira `''` silenciosamente — perda de relato de cliente sem aviso.
- Exportar rebaixa status incondicionalmente (contrato "assinado" regride a "exportado"); não há máquina de estados; artefato exportado não é arquivado (sem trilha probatória do que foi protocolado).
- D4Sign: sandbox por default, credenciais em query string, 10 req/hora (≈2 contratos/hora), dois mapas de status divergentes. Recomendação: interface `AssinaturaProvider` (D4Sign primeiro, Clicksign/ZapSign depois).
- Custos Groq/Whisper não entram no `api_usage_log` — painel de uso subestima o custo real.

---

## 6. UX e usabilidade

A revisão de junho já diagnosticou o essencial (re-entrada de contexto, divergência das portas) e parte foi corrigida. O que esta análise acrescenta:

**Críticos/altos:**
1. **Três telas gêmeas** de captura seguem existindo (AnaliseCasoClient 810 linhas, ConsultoriaClient 845, TelaAtendimento 691 — mesma UI, APIs diferentes, 4 nomes: "Análise de Caso", "Estudo de Caso", "Consultoria/Análise IA", "Diagnóstico da IA"). Na jornada principal, após a análise o usuário cai numa **segunda tela de relato pré-preenchida** e precisa clicar "Gerar Peça IA" de novo — o degrau que sugere retrabalho. Jornada completa: 11–14 cliques.
2. **Painel de assinatura encoberto**: o editor é `fixed inset-0 z-40` e o PainelAssinatura renderiza atrás — após enviar para assinatura, o acompanhamento fica invisível. Correção pontual de alto impacto.
3. **Onboarding inexistente**: sem wizard de primeiro acesso; dados profissionais obrigatórios para contratos escondidos em Configurações — o advogado só descobre quando o contrato sai incompleto.
4. **Dark mode quebrado em ~36 pontos** (cores claras fixas sem variante dark), violando o próprio DESIGN_SYSTEM.md.
5. **Sem autosave nem guarda de saída no editor** — o conteúdo mais caro do produto (IA paga + edição do advogado) se perde num clique errado.

**Médios:** rótulos de área duplicados em 4 arquivos (Revisão/Histórico mostram slug cru para 5 das 11 áreas — na tela do revisor); sem breadcrumbs, retorno inconsistente (`router.back()`); mobile com hambúrguer sobre o título e grids fixos estourando em 360px; colaborador perde a peça de vista após enviar para revisão (não existe "minhas peças"); jargão dev exposto (Build/commit, ENCRYPTION_KEY, "production") em Configurações.

**Positivos a preservar:** rótulos de IA sem tecnicismo ("Padrão"/"Raciocínio estendido"), estados vazios com ação, progresso visível nas gerações longas, dossiê do cliente com timeline, consentimento LGPD na gravação.

---

## 7. Parecer competitivo

### 7.1 Concorrentes de IA jurídica (geração de peças)

| Player | Preço/mês | O que tem | Fraqueza relevante |
|---|---|---|---|
| **Jus IA (Jusbrasil)** | R$ 78,90–208,90 (incluído em TODOS os planos desde abr/2026; ~300 mil advogados/mês) | peças ilimitadas no topo, jurisprudência + doutrina próprias, validação de citações, memória de casos | reclamações formais de jurisprudência inexistente; 30 msgs/mês no plano de entrada |
| **Jurídico AI** | ~R$ 127 | peças multi-área, banco de teses/jurisprudência, editor | Reclame Aqui: cobrança/cancelamento; textos genéricos |
| **Lexter.ai** | R$ 99–200 (freemium; pivot do enterprise R$ 5k) | **agente de atendimento via WhatsApp → coleta do caso → peça** (o mais próximo do SIMAS), Série A de R$ 16 mi | sem captura do atendimento presencial/áudio; produto p/ escritório pequeno em maturação |
| **ChatADV** | ~R$ 97 | peças + 19 mi de jurisprudências + transcrição de áudio + WhatsApp; parcerias com OABs | "limitado a criação de textos", sem contexto persistente |
| **LawX** | ~R$ 149 | 35+ ferramentas | amplitude sem profundidade |
| **Jusfy/JusGPT** | a partir de R$ 31 (convênios OAB R$ 19–25) | IA + 20 ferramentas; receita >R$ 50 mi em 2025 (+118%) | gestão rasa; monetização por usuário baixa |
| **Redizz / JusDog / Lawdeck / GPTuri** | R$ 39,90–299 | nichos (captação, petição, jurimetria) | fragmentação — 3-4 assinaturas para cobrir o fluxo |
| *Benchmark internacional* | Harvey ~US$ 1.200/adv/mês; CoCounsel ~US$ 225+; Spellbook ~US$ 179 | agentes que executam fluxos inteiros; **citações garantidas contra base oficial**; IA dentro do Word | inviáveis no Brasil — servem de norte de features |

### 7.2 Concorrentes de gestão (contexto)

Mercado maduro e commoditizado (Astrea R$ 209+/2 usuários, ADVBOX R$ 220 c/ usuários ilimitados, Projuris R$ 197+, EasyJur R$ 229+, CPJ-3C sob consulta). IA dos incumbentes é "bolted-on" (resumo de intimação, tradução de juridiquês, minuta por template, limitada por créditos). **Acompanhamento processual não precisa ser construído**: DataJud (grátis, metadados de 80M+ processos) para enriquecer a capa do caso; Escavador (por consumo: ~R$ 0,10–0,20/consulta), Codilo, Jusbrasil Soluções, AASP, JUDIT para intimações/andamentos via API. Fraquezas exploráveis dos incumbentes: suporte lento, migração dolorosa, permissões sem trilha de auditoria, silêncio sobre privacidade de IA.

### 7.3 Posição do SIMAS

**Forças estruturais (raras no mercado):** fluxo atendimento→transcrição→caso→peça (espaço aberto — martelar antes que a Lexter desça ao nicho); Casa do Caso = "memória de casos" que o Jusbrasil cobra caro; prompts curados por área+peça atacam a fraqueza nº 1 dos concorrentes (texto genérico); multi-tenant/RLS sólido desde o dia 1.

**Table stakes que faltam para competir:** citação verificada (a régua da fronteira); billing e onboarding self-serve; recursos/apelação com curadoria (hoje só inicial/contestação são curados); intimações como add-on integrado (não construir).

**Estratégia validada pelos dados:** competir por **fluxo de trabalho**, não por chat (o Jusbrasil ganha qualquer disputa de chat por distribuição); não competir em preço com Jusfy (R$ 31) — vender produtividade de produção jurídica; cobrar por **peça/caso** (legível e ancorado em valor, evita a frustração dos limites de mensagens); trial sem cartão + cancelamento self-service (as reclamações de billing dos concorrentes viram argumento de venda); roadmap: nicho IA-first agora → DataJud grátis em 3–6 meses → intimações pagas como add-on em 6–12 → financeiro só se o ICP puxar.

---

## 8. Lacunas que nenhum resumo anterior cobria (verificadas pelo crítico)

1. **Monetização**: zero billing; planos sem cobrança; trial sem expiração; status "suspenso/cancelado" não é checado em lugar nenhum.
2. **Funil**: landing com pricing sem preços; nomes de plano da landing (Essencial/Profissional/Escritório) divergem dos do sistema (trial/basico/profissional); limites prometidos ("1 usuário", "até 100 clientes") não são aplicados.
3. **E-mails transacionais**: Resend usado só em convite/reenvio/assinatura/lead; sem chave, o convite é criado e o e-mail silenciosamente não sai. Faltam: peça aprovada/rejeitada, prazos, boas-vindas. Reset de senha sai no template padrão do Supabase, fora da identidade.
4. **Observabilidade**: nenhum Sentry/PostHog/OTel; `lib/logger.ts` (estruturado, com redação) é código morto — as rotas usam `console.*`. Errar em produção hoje é invisível.
5. **Fila/jobs**: inexistente (restringe o motor-alvo — ver §3).
6. **Rate limiting**: só `/api/contato`, in-memory.
7. **PWA/mobile**: sem manifest/service worker — para advogado gravando relato no fórum pelo celular, não há instalação nem offline.
8. **Backup/DR**: nada no repo; recuperação depende do plano Supabase (desconhecido); o incidente de Storage mostra que operação sem DR já é risco real.
9. **i18n**: 100% PT-BR hardcoded — provavelmente correto, mas é decisão não registrada.

---

## 9. Perguntas ao dono do produto (bloqueiam priorização)

1. **Cobrança:** gateway (Stripe? Asaas/Pagar.me com Pix/boleto?) ou faturamento manual? Preços dos planos da landing? Trial expira?
2. **Go-to-market:** self-serve (reativar registro com onboarding automático de tenant) ou venda assistida (tenant manual)? Muda a prioridade de billing, onboarding, rate limiting e landing.
3. **Supabase:** qual plano/política de backup (PITR?)? Qual RPO/RTO aceitável para dossiês de clientes?
4. **LGPD:** há prazo/compromisso para o piloto (contrato de operador, DPO)? Define se criptografia obrigatória + direitos do titular entram antes ou depois de dados reais.
5. **D4Sign:** conta de produção contratada (secret, limite >10 req/h)? Ou assinatura manual é o caminho principal no curto prazo?
6. **Volume do piloto:** quantos escritórios/advogados simultâneos? Determina urgência de fila, rate limiting e observabilidade.
7. **Mobile:** gravar relato pelo celular em campo é cenário-chave? Vale PWA agora?
8. **Curadoria:** quais áreas×peças são prioridade comercial para expandir os prompts curados (hoje 10 combinações)? Quem cura continuamente (você, advogado parceiro, cliente-piloto)?
9. **Teto de custo de IA** por tenant/mês que justifique hard caps além da cota por chamadas (relevante quando o pipeline multiplicar chamadas por peça)?
10. **Código morto:** validação/correção-auto e comandos rápidos serão religados (o plano recomenda religar a validação) ou apagados? `/historico` vira "Todos os casos" ou sai? `/abertura` volta pela Casa do Caso ou sai?

---

## 10. Fontes principais (mercado e práticas)

- Preços/planos: Jus IA (ia.jusbrasil.com.br/planos), ConJur abr/2026 (Jus IA em todos os planos), Jurídico AI, ChatADV, LawX, Redizz, Jusfy (startups.com.br), Lexter (Exame), Astrea/Aurum, ADVBOX, Projuris Store, EasyJur, Preâmbulo.
- Alucinação: Stanford JELS 2025 (*Hallucination-Free? Assessing the Reliability of Leading AI Legal Research Tools*), Stanford HAI, HAQQ (1.313 casos), TJSC e TRT-12 (multas por jurisprudência falsa), Reclame Aqui (Jus IA, Jurídico AI).
- Dados jurídicos BR: DataJud wiki (CNJ), Comunica CNJ/DJEN, Escavador API (preços por consumo), Jusbrasil Soluções, Codilo, LexML, AASP, JUDIT, TrackJud.
- Arquitetura LLM: docs.claude.com (modelos/preços/caching/batch/structured outputs, jul/2026), CaseGen (arXiv 2502.17943), JUSTICE (arXiv 2602.08305), self-critique com verificador separado (arXiv 2512.24103).
- Transcrição: Groq (whisper-large-v3 $0,111/h; turbo $0,04/h), AssemblyAI, pyannote 3.1.

*Lista completa de URLs no resultado bruto da pesquisa (disponível sob demanda).*
