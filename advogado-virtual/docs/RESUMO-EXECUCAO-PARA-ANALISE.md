# Resumo de execução — para análise do Fable

> **Para quem lê:** este documento é um **handoff para o Claude Fable 5 analisar**. Segue a divisão de trabalho do projeto — **Fable analisa/curadoria/decisão crítica; Opus executa**. Ele resume o que foi implementado nesta leva e o que ficou pendente, e termina com **perguntas específicas** que quero que o Fable analise.
>
> **Documentos de apoio (contexto completo):** [ANALISE-COMPLETA-2026-07.md](ANALISE-COMPLETA-2026-07.md) (parecer original) · [PLANO-DESENVOLVIMENTO-OPUS.md](PLANO-DESENVOLVIMENTO-OPUS.md) (backlog com itens A–E) · [STATUS-E-PROXIMOS-PASSOS.md](STATUS-E-PROXIMOS-PASSOS.md) (status corrente) · [REVISAO-ARQUITETURAL.md](REVISAO-ARQUITETURAL.md).

---

## 0. Contexto e objetivo estratégico

**SIMAS / advogado-virtual** é um SaaS jurídico brasileiro (Next.js 15 + Supabase + Claude/Groq) que gera peças processuais e contratos com IA, multi-tenant com RLS.

**Decisão do dono do produto (firme):** o objetivo imediato **não é comercializar**, e sim **implantar o sistema no próprio escritório para validar na prática** (piloto com dados reais). Por isso:
- **Congelado:** cobrança/billing (D1), cadastro self-serve/go-to-market (D2), D4Sign de produção. **Não analisar como prioridade.**
- **Priorizado:** rodar com dados reais de cliente **com segurança, visibilidade e sem alucinação de citações**.

**A análise do Fable deve partir dessa lente** (piloto num escritório, não venda em escala).

---

## 1. O que foi FEITO nesta leva (tudo em produção, `tsc`+build+137 testes verdes, CI ativo)

### Segurança e prontidão para dados reais
- **Deleções seguras (A2):** DELETE de cliente/caso exige `admin/advogado` + **soft-delete** (`deleted_at`) + auditoria. Antes qualquer papel apagava em cascata sem trilha.
- **Criptografia em repouso (A3):** CPF/RG **e transcrições** (dado de saúde, LGPD) cifrados com AES-256-GCM; `ENCRYPTION_REQUIRED=true` faz o boot **falhar fechado** sem a chave. Backfill aplicado; round-trip verificado contra o banco de produção (106 campos, 0 falhas).
- **Higiene de segurança (A8):** trigger anti-escalonamento de privilégio (usuário não muda o próprio `role`/`tenant_id`); validação de posse de FK por tenant; `maxDuration` nas rotas de IA; **magic bytes de áudio** validados no upload/transcrição (A8c — arquivo disfarçado é rejeitado antes de processar).
- **Webhook D4Sign (A1-mínimo):** fail-closed + service_role (era inseguro e quebrado). Partes (c)/(d) congeladas com a D4Sign de produção.
- **Custo/cota de IA (A6):** preço por modelo correto (Opus não é mais subestimado ~40%); **todas** as rotas de IA logam uso; **custo de transcrição Groq/Whisper** agora entra no painel.

### Resiliência de uso real
- **Gravação por áudio resiliente (Lotes 1/4):** servidor **acumula** a transcrição (antes sobrescrevia); trechos ficam em IndexedDB e reenviam ao voltar a rede; layout mobile corrigido.
- **Streaming robusto (Lote 2 / A7 / B2.5):** parser SSE com buffer (não aborta em rede móvel); aviso quando a peça é cortada por limite de tokens; **rede de segurança server-side** — fechar a aba no meio da geração não deixa mais a peça vazia.
- **PWA (Lote 3):** app instalável, offline básico, ícones.
- **Editor sem perda de trabalho (C1):** autosave + guarda de saída (`beforeunload`), painel de assinatura acessível, dark mode legível, labels de área centralizados. **C1 completo.**

### Motor de IA e anti-alucinação (o núcleo desta leva)
- **Contexto documental íntegro (B1, parcial):** removido o corte de 500 chars nos builders — a peça agora lê os documentos por inteiro (orçamento ~30k/doc). OCR de extração subiu de 4.096→8.192 tokens (documento longo não é mais truncado na origem).
- **Ciclo validar→corrigir religado (B3, parcial):** painel **"Revisar peça"** no editor (validação de coerência/formatação por IA) + correção de um clique.
- **DataJud reposicionado (B5.1):** o DataJud (CNJ) **não é base de jurisprudência** — só devolve metadados processuais (número, classe, assunto), sem ementa/relator/resultado. Antes ele era apresentado como "jurisprudência" e o modelo era instruído a citar os números → **fabricava ementas grudadas em números reais**. Agora entra só como **estatística de litigiosidade**, não citável.
- **Verificador determinístico de citações (B5.2):** extrai processo/súmula/lei da peça e confere — **dígito verificador CNJ** (nº inventado falha ~96/97), **faixa de súmula** por tribunal, **base local de leis**. Status ✓/⚠/✗ por citação no painel.
- **Verificação ONLINE (B5.2 online):** eleva ⚠→✓/✗ — **LexML** confirma existência de lei federal; **DataJud** confirma processo por número exato. Roda em paralelo com o LLM. Testado ponta a ponta contra as APIs reais.

### Operação e observabilidade
- **CI (D9):** GitHub Actions roda typecheck + 137 testes + build em todo push/PR.
- **E-mails transacionais (D4):** autor recebe e-mail quando a peça é **aprovada** ou **rejeitada** (com motivo). Envio via Resend testado e funcionando em produção (domínio `simas.app` verificado).
- **Observabilidade (D3):** `onRequestError` app-wide + `logger.ts` estruturado nas rotas de IA críticas + **Sentry ligado** (servidor e navegador, PII desligado por LGPD, inerte sem DSN). Evento de teste confirmado no projeto do Sentry.

---

## 2. O que ficou PENDENTE

### 2a. Qualidade do motor de IA (o diferencial competitivo — pós-piloto)
- **B1 (resto):** transcrição ainda truncada em 3.000 chars na **triagem de relevância** (deveria ser íntegra); documentos acima do orçamento apenas truncam (falta o **resumo por Haiku**). Extração **por página** para autos muito longos (30+ pág.) também pendente.
- **B2 (resto):** faltam **structured outputs** (`output_config: json_schema` — hoje ainda usa `JSON_ONLY`/`extrairJsonDoTexto`, fonte do erro "IA não retornou JSON válido"); **thinking/effort adaptativo** no modo Opus; gravar o **`prompt_utilizado` completo** (ainda trunca em 500 chars — atrapalha reprodutibilidade); remover header beta `output-128k` (no-op).
- **B3 (resto):** **consolidação do motor** — `refinamento-peca`/`refinar-peca` seguem como 4 rotas separadas; falta unificar sob um motor único com `modo ∈ {criar, refinar, corrigir}`.
- **B4 (não iniciado):** **pipeline de geração em etapas** (extração → plano editável → redação → revisão crítica em contexto separado). Hoje a geração é *one-shot*. Requer fila (D5).
- **B5.3 / B5.4 (não iniciado):** **base curada de teses/ementas por área** injetada no prompt — é o que efetivamente **coloca jurisprudência real CITÁVEL** na peça (hoje só sabemos *flagrar o falso*, não *fornecer o verdadeiro*). Exige decisão de **quem cura**. Opcional: integração Escavador (ementas reais, ~R$0,10–0,20/consulta).
- **B6 (não iniciado):** refatoração dos prompts em 4 camadas (base+área+peça+modo); **suíte de regressão golden com LLM-judge**; telemetria de edições (diff peça gerada × salva pelo advogado).

### 2b. UX de fluxo (pós-piloto)
- **C2 (não iniciado, item grande):** unificar as **3 telas gêmeas de captura** (~2.350 linhas duplicadas: `abertura`, `consultoria`, `analise-caso`) numa só, com a **Casa do Caso** como hub. Vocabulário "Caso"/"Estudo do caso" já adotado parcialmente.
- **C3 (parcial):** tela **"Minhas peças"** para o colaborador acompanhar status (aprovada/rejeitada); decidir/remover rotas órfãs.
- **C4 (não iniciado):** **onboarding first-run** (wizard: OAB/responsável → timbrado → modelo de contrato → convite da equipe) — hoje dados profissionais são silenciosamente necessários para contratos saírem completos.

### 2c. Operação e compliance (parte antes/parte pós-piloto)
- **Sentry — alerta (ação do dono):** código ligado; falta pôr `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` na Vercel + criar a regra de alerta.
- **D7 — LGPD direitos do titular (recomendado antes de escalar):** endpoint de **exportação** (JSON/ZIP) por cliente; anonimização/exclusão em cascata; política de retenção documentada; `logAudit` universal (hoje cobre poucas rotas).
- **D5 — fila durável (QStash/Inngest):** só há `after()` best-effort. Necessária para B4 e para **e-mail de prazo de tarefa** (precisa de agendador).
- **D6 — rate limiting real** (Upstash): baixa prioridade num escritório só.
- **D8 — fidelidade de exportação:** PDF hoje é jsPDF direto (não via pipeline DOCX→PDF, perde timbrado); falta SHA-256 na trilha e máquina de estados de contrato.
- **D9 (resto):** falta **1 E2E Playwright** (login→caso→peça→export) e **smoke test pós-deploy** (o CI básico já roda).

### 2d. Congelado por decisão do dono (NÃO analisar como prioridade)
- D1 (billing), D2 (registro/go-to-market), A1(c/d) e D4Sign de produção.

### 2e. Ação humana pendente (candidata a Fable)
- **Curadoria jurídica dos 10 prompts RASCUNHO** gerados por IA (réplica ×5, apelação ×4, recurso ordinário trab. ×1) em `src/lib/prompts/pecas/{area}/`. Marcados `RASCUNHO`, **não devem ir a produção sem revisão de advogado**.

### 2f. Novas funcionalidades (Parte E — backlog de produto)
E1 selo "citações verificadas" (materializa o B5 na UI/marketing) · E2 enriquecimento de capa via DataJud (nº CNJ → partes/vara) · E3 lembretes de prazo · E4 biblioteca de teses/ementas (interface sobre B5.3) · E5 financeiro de honorários (Asaas) · E6 abstração de provedor de assinatura (Clicksign/ZapSign) · E7 intimações/publicações (Escavador/Codilo) · E8 intake por WhatsApp · E9 diff/aceite por seção · E10 painel do dono (uso/custo por tenant).

---

## 3. Perguntas para o Fable analisar

1. **Curadoria dos 10 prompts RASCUNHO** — leitura crítica **área a área**: fundamentos legais corretos e verificáveis? estrutura fiel ao padrão? algum risco de citação inventada ou de vício processual? (Este é o item mais urgente de análise humana/curadoria.)

2. **B5.3 — base curada de ementas:** como desenhar? (formato dos registros, como injetar no prompt como bloco citável, granularidade por área×tese, **quem cura e com que cadência**, e se vale começar já com Escavador ou só com curadoria manual). É o que falta para "jurisprudência correta na peça", não só "flagrar a falsa".

3. **Priorização do backlog pós-piloto:** dado o objetivo (validar no escritório), qual a ordem de maior retorno entre **B4 (pipeline multi-etapa)**, **C2 (unificar fluxo)**, **D7 (LGPD export)** e **B1/B2 (resto do motor)**? O que realmente move o ponteiro de qualidade/segurança vs. o que é polimento?

4. **B4 vale a pena?** Dado que o **verificador de citações (B5.2)** já ataca a alucinação, o pipeline multi-etapa (plano editável → redação → revisão crítica) ainda se justifica pelo ganho de qualidade/controle, ou o one-shot atual + verificador é suficiente por ora? Análise de custo/benefício.

5. **Lacunas de risco** que possam ter passado — segurança, LGPD, ou jurídico (ex.: retenção de áudio/transcrição, `logAudit` incompleto, exportação sem trilha probatória). O que é inaceitável rodar com dados reais mesmo num piloto?

6. **Parecer competitivo atualizado** frente aos concorrentes brasileiros, considerando o que já foi entregue (anti-alucinação com verificação online é incomum no mercado) — onde estão o fosso defensável e o próximo movimento de maior valor.

---

*Gerado ao fim da leva de execução do Opus. Estado do código: branch `main`, tudo em produção (deploy Vercel), CI verde, 137 testes.*
