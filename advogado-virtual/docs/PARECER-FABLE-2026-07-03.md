# Parecer Fable — curadoria dos prompts RASCUNHO + análise das 6 questões

> **Autor:** Claude Fable 5 (análise/curadoria) · **Data:** 2026-07-03
> **Insumos:** leitura literal dos 10 prompts RASCUNHO, `_shared/construtores.ts`, `_shared/qualificacao.ts`, `regras-formatacao.ts`, `previdenciario/peticao-inicial.ts` (régua), + RESUMO-EXECUCAO-PARA-ANALISE.md e documentos de apoio.
> **Execução:** as edições aqui recomendadas (E1–E6) são para o **Opus executar** após aprovação do dono. Preservar prompts byte-a-byte exceto onde indicado; snapshots devem ser atualizados **intencionalmente** junto com cada edição.

---

## Q1 — Curadoria jurídica dos 10 prompts RASCUNHO

### Veredicto geral

**Os 10 podem ser aprovados com ajustes pontuais.** Nenhum contém citação inventada — **todas as súmulas e dispositivos citados são reais e pertinentes** (verifiquei um a um; detalhe abaixo). A arquitetura (construtor compartilhado + metadata por área) concentra o risco num único lugar, o que é bom: **3 edições no `construtores.ts` corrigem as 10 peças de uma vez**. Os problemas encontrados são de **precisão dogmática e de nuance processual**, não de alucinação.

### Verificação dos fundamentos legais (item a item)

| Citação | Status | Observação |
|---|---|---|
| CPC arts. 350–353 (réplica) | ✅ correto | 350 = fato impeditivo/modificativo/extintivo; 351 = preliminares do 337; prazo 15 dias ✓ |
| CPC art. 341 (impugnação específica) | ⚠️ **impreciso no contexto** | ver E1 abaixo |
| CPC art. 1.003 §5º (15 dias) / 1.007 (preparo) / 1.009–1.014 / 1.010 II–III | ✅ corretos | interposição dirigida ao 1º grau ✓ (art. 1.010 caput) |
| CLT art. 895 (RO, 8 dias) / art. 899 (custas + depósito, "quando exigível") | ✅ corretos | a ressalva "quando exigível" é precisa (isenções do §10) |
| Lei 8.213/91, Decreto 3.048/99, CF/88 (prev.) | ✅ corretos | base sólida e verificável |
| Lei 5.478/68 (alimentos), ECA, CC-Família (família) | ✅ corretos | número e ano da Lei de Alimentos conferem |
| CC arts. 186, 927, 951 (médico) | ✅ corretos | 951 é exatamente o dispositivo de responsabilidade de profissionais de saúde |
| CDC arts. 6º e 14 (médico) | ✅ corretos | 14 §4º (culpa do profissional liberal) é a nuance certa da área |
| **Súmulas STJ 302, 387, 597, 608, 609** (médico) | ✅ **todas reais e pertinentes** | 302 (limite de internação), 387 (dano estético + moral), 597 (carência em urgência), 608 (CDC em plano de saúde), 609 (doença preexistente) — conferidas uma a uma |

Este era o maior risco (súmulas inventadas em rascunho gerado por IA) — **e passou limpo**.

### Ajustes recomendados (para o Opus executar, mediante aprovação)

**E1 — [média] Réplica: desancorar a impugnação específica do art. 341 CPC.**
O art. 341 disciplina o **ônus do réu** na contestação (presunção de veracidade dos fatos não impugnados *pelo réu*). Usá-lo como fundamento do dever de o **autor** rebater ponto a ponto na réplica é analogia doutrinariamente imprecisa — um ex-adverso atento explora isso. Editar o item 6 da estrutura da réplica em `construtores.ts` para: *"Da impugnação especificada dos fatos e fundamentos da defesa — rebater ponto a ponto (arts. 350 e 351 do CPC/2015; contraditório substancial)"* — removendo a referência ao art. 341 (ou mantendo-a expressamente como analogia, à escolha do dono).

**E2 — [média-alta] Apelação previdenciária: aviso de JEF.**
Grande parte do contencioso previdenciário (causas até 60 SM) tramita no **Juizado Especial Federal**, onde o recurso cabível é o **recurso inominado (10 dias, Lei 10.259/2001 c/c Lei 9.099/95)** — **não** apelação. O prompt atual, usado num caso de JEF, produz o instrumento errado com prazo errado. Duas opções: (a) mínima — nota no prompt prev/apelacao: *"ATENÇÃO: se o feito tramita em JEF, o recurso cabível é o inominado (prazo 10 dias) — não gere apelação; avise o advogado"*; (b) completa — criar o prompt de recurso inominado (exigiria novo tipo no CHECK de `pecas.tipo` → migration). Recomendo (a) agora e (b) no backlog de curadoria.

**E3 — [média] Réplica trabalhista: nuance de rito.**
No processo do trabalho, a manifestação sobre a contestação não segue o prazo de 15 dias do CPC — o prazo é **fixado pelo juízo** (ou a manifestação ocorre em audiência), com o CPC aplicado só **subsidiariamente** (CLT art. 769). Ajustar os `fundamentos` do wrapper trabalhista/replica.ts para: `'CLT e CF/88; aplicação subsidiária do CPC (art. 769 da CLT) — prazo de manifestação conforme fixado pelo juízo'` e, idealmente, dar ao construtor um campo opcional `observacoes` por área (ver E6).

**E4 — [baixa] Enriquecimentos de metadata (opcionais, seguros):**
- médico: acrescentar `Lei 9.656/98` (planos de saúde) aos fundamentos — 4 das 5 súmulas citadas são de plano de saúde, a lei-base merece estar junto.
- família: acrescentar `CPC arts. 693–699` (procedimento das ações de família; audiência de mediação).
- previdenciário: acrescentar `EC 103/2019` (regras de transição) — relevante em apelações sobre tempo de contribuição.

**E5 — [baixa] Apelação: itens "se aplicável" que valem constar na estrutura:**
pedido de **efeito suspensivo** quando não automático (art. 1.012 §§3º–4º) e **julgamento imediato pela causa madura** (art. 1.013 §3º) quando a sentença for terminativa. Ambos como itens condicionais, sem obrigar.

**E6 — [estrutural, pequena] Campo `observacoes?: string` no `MetaArea`.**
Permite nuance por área (JEF, rito trabalhista) sem quebrar o template compartilhado — e já caminha na direção das 4 camadas do B6. É a forma limpa de implementar E2(a) e E3.

**Condição de promoção:** aplicadas E1–E3 (E4–E6 a critério), os cabeçalhos `// RASCUNHO` podem ser trocados por `// Curado — revisão Fable 2026-07-03; aprovação final: [dono]`. A **aprovação final é do advogado responsável** — meu parecer não substitui a responsabilidade profissional de quem assina a peça. Sugiro o dono ler 1 peça gerada de cada tipo antes de promover.

---

## Q2 — Desenho da base curada de fundamentação (B5.3)

**Princípio:** a base é um **ativo editorial versionado no repositório**, como os prompts — não uma feature de banco de dados. Cresce devagar e com assinatura humana.

**Formato** — `src/lib/fundamentacao/{area}.ts`, registros tipados:

```ts
interface TeseCurada {
  id: string                    // ex.: 'prev-tempo-especial-ruido'
  area: AreaJuridica
  tese: string                  // enunciado da tese em 1-2 frases
  dispositivos: string[]        // ['Lei 8.213/91, art. 57', ...]
  sumulas: string[]             // ['Súmula 198 do extinto TFR', ...] — só verificadas
  ementas: Array<{              // 0..3 por tese; SÓ com verificação humana
    tribunal: string; processo: string; relator: string
    julgamento: string; ementa: string          // texto integral conferido
    fonteUrl: string; verificadoEm: string; verificadoPor: string
  }>
  quandoUsar: string            // gatilhos (tipo de caso/pedido)
  notas?: string                // ressalvas, divergência jurisprudencial
}
```

**Injeção no prompt:** na geração, selecionar as teses da área cujo `quandoUsar` case com o caso (fase 1: seleção por Haiku entre as teses da área — barato; fase 0: injetar todas as da área, enquanto forem <10) e anexar como bloco **"FUNDAMENTAÇÃO VERIFICADA PELO ESCRITÓRIO — estas citações são conferidas e PODEM ser usadas literalmente, sem [VERIFICAR]"**. O verificador B5.2 passa a reconhecer citações vindas da base (match por processo/súmula) e marcá-las **✓ "da base curada"** — fechando o ciclo: o que está na base é citável; o que não está continua ⚠/✗.

**Curadoria (quem/cadência):** o dono é advogado — **ele é o curador natural no piloto**. Começar **pequeno e assimétrico**: 5–10 teses da área de maior volume do escritório (aposta: previdenciário), 1–2 ementas por tese, todas conferidas na fonte (site do tribunal). Cadência: 1 sessão/mês, alimentada por (a) peças reais do piloto em que faltou fundamento e (b) telemetria de edições (B6) quando existir. **Escavador: adiar** — só faz sentido quando o gargalo virar volume de ementas, e no piloto o gargalo é seleção/verificação, não acesso. Proteger a base com snapshot test, como os prompts.

**Anti-risco:** ementa **não** entra na base sem `fonteUrl` + `verificadoPor`. A base nunca é preenchida por IA sem conferência — senão vira lavanderia de alucinação com selo de verdade.

---

## Q3 — Priorização do backlog pós-piloto

Lente: o piloto existe para **aprender**. Prioridade é o que (a) remove atrito real do uso diário e (b) **converte uso em dado de curadoria**. Três ondas:

**Onda 1 — junto com o início do piloto (barato, alto retorno):**
1. **B2-resto: structured outputs** — elimina a classe de erro "A IA não retornou JSON válido" (atrito direto no piloto) e o workaround JSON_ONLY. Pequeno e mecânico.
2. **B2.6: `prompt_utilizado` completo** — sem isso, não há reprodutibilidade nem auditoria do que foi enviado ao modelo; pré-requisito prático da telemetria e da curadoria contínua.
3. **B6-mínimo: telemetria de edições** (diff peça gerada × peça salva, agregado por área×tipo) — **é o instrumento de medição do piloto**. Sem ele, a validação vira anedota. Não precisa do golden suite completo ainda.
4. **B1-resto: transcrição íntegra na triagem** — pequeno, qualidade direta.

**Onda 2 — durante o piloto:**
5. **B5.3 fase 0** (5–10 teses previdenciárias curadas à mão — trabalho do dono, código mínimo).
6. **C3 "Minhas peças"** — só se houver colaborador ativo no escritório; senão, adiar.
7. **D7-mínimo (exportação JSON por cliente)** — fecha o ciclo LGPD; barato.

**Onda 3 — pós-validação (não antes):**
8. **C2 (unificar as 3 telas gêmeas)** — é o maior item de UX, mas **o piloto pode mudar o desenho do fluxo**; refatorar 2.350 linhas antes da evidência de uso real é apostar no escuro. Colher 4–6 semanas de uso primeiro.
9. **B4** — ver Q4. **B6-completo** (4 camadas + golden suite) — junto com a primeira rodada grande de edição de prompts pós-curadoria.

**D8 (fidelidade PDF/hash)** entra na Onda 2–3 conforme o escritório passe a protocolar peças exportadas pelo sistema (aí a trilha probatória vira real). **D5/D6** só quando B4 ou multi-tenant exigirem.

---

## Q4 — B4 (pipeline multi-etapa) vale a pena agora?

**Recomendação: não como pipeline completo. Extrair duas fatias e medir antes.**

Racional: o argumento original do B4 tinha dois motores — qualidade argumentativa e anti-alucinação. O segundo já foi atacado por caminho mais barato (B5.1 + B5.2 + verificação online). O primeiro **ainda não foi medido**: com B1 (documentos íntegros) + prompts curados, não sabemos o tamanho real do gap de qualidade do one-shot — e a telemetria de edições (Onda 1) é exatamente o instrumento que vai dizer.

As duas fatias que valem antes da fila:
- **Revisão crítica pós-geração sem fila:** o `validar-peca` já existe e o painel já existe (B3). Basta disparo automático pós-stream (via `after()`, padrão já usado no B2.5) com o resultado à espera quando o editor abre. 80% do valor da "etapa 4" do B4 com ~5% do custo.
- **Plano editável como experimento de UX:** prototipar só para peças longas (inicial/contestação), atrás de um botão opcional — testar no piloto se o advogado usa. Se ninguém usar, o B4 perde seu principal argumento de UX.

**Gatilho de decisão:** após 4–6 semanas de telemetria — se as edições do advogado forem majoritariamente **estruturais** (reorganizar seções, refazer argumentação), o pipeline se justifica; se forem **pontuais** (dados, estilo, fundamento faltante), B5.3 + prompts melhores resolvem mais barato. Custo do pipeline completo (D5 + latência de minutos + complexidade de estado) só se paga no primeiro cenário.

---

## Q5 — Lacunas de risco para rodar com dados reais

Em ordem de severidade:

1. **[ALTA] Backup do Supabase não confirmado.** Perda de dossiês num escritório é dano irreversível + responsabilidade profissional. **Não cadastrar acervo real antes de confirmar PITR/backup diário** no painel. É item de 10 minutos, está aberto desde o primeiro checklist.
2. **[MÉDIA-ALTA] Segredos de produção em pasta sincronizada.** O repositório (com `.env.local` contendo `ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, chaves de API) vive em `Documentos - MacBook Pro de Anderson/` — padrão de pasta **sincronizada via iCloud**. Chave de cifra e credenciais admin acabam replicadas em nuvem de terceiro, fora do perímetro. Recomendo: mover o projeto para fora da pasta sincronizada (ou excluir `.env.local` da sincronização) e **rotacionar a `ENCRYPTION_KEY` não é trivial** (re-cifrar dados) — então prevenir agora é muito mais barato que remediar.
3. **[MÉDIA] Trilha de auditoria estreita.** `logAudit` cobre usuários/clientes/atendimentos, mas **aprovar/rejeitar peça, exportar documento e alterar contrato não são auditados**. Para escritório, "quem aprovou qual peça quando" é trilha profissional relevante. O wrapper universal do D7 resolve; no curto prazo, adicionar `logAudit` nas 3–4 rotas de peça/contrato já cobre o essencial.
4. **[MÉDIA] Exportação sem artefato/hash (D8).** O DOCX exportado não é arquivado nem tem hash — não há prova de "o que foi protocolado". Aceitável no piloto (o escritório guarda o arquivo), obrigatório antes de escalar.
5. **[BAIXA-MÉDIA] Retenção de áudio indefinida.** Chunks ficam para sempre (decisão A5 de mantê-los é coerente, mas sem prazo). LGPD pede minimização: definir política (ex.: expurgo N meses após encerramento do caso) — decisão do dono, não código urgente.
6. **[BAIXA-MÉDIA] MFA não habilitado.** O sistema trata dado de saúde; Supabase Auth suporta TOTP. Habilitar para os usuários do escritório é ganho barato.
7. **[BAIXA, pós-piloto] RLS sem testes automatizados** (cross-tenant) — mitigado por haver um único tenant no piloto; vira obrigatório antes de qualquer segundo escritório. **CSP incompleta** (só frame-ancestors) — endurecer depois.

**Não-achados (conferi e estão bem):** fail-closed da cifra ✓, webhook fail-closed ✓, magic bytes ✓, Sentry sem PII ✓, guardrail anti-injection nos prompts ✓, isolamento de tenant nas rotas novas ✓.

---

## Q6 — Parecer competitivo atualizado (jul/2026)

**O que mudou desde o parecer original:** o SIMAS agora tem, funcionando em produção, o trio que o mercado brasileiro de "IA que redige peça" em geral **não** tem: (1) **verificação determinística + online de citações** (dígito CNJ, faixas de súmula, LexML, DataJud) exposta na UI; (2) **fluxo de campo** (PWA + gravação resiliente offline → transcrição → peça) — nenhum concorrente relevante trata o atendimento fora do escritório como cenário primário; (3) **prompts curados por área×peça como ativo versionado** com trava de regressão.

**Contra o campo:** Lexter/ChatADV/JusIA competem em redação assistida — nenhum vende *verificação* como produto; Jusbrasil tem a base de jurisprudência mas não o fluxo de produção de peça de escritório pequeno; os incumbentes de gestão (Astrea, ADVBOX) têm intimações/prazos/financeiro, onde o SIMAS segue atrás (E3/E7 são as pontes, ambas viáveis via parceiro). O benchmark internacional (CoCounsel) confirma a tese: "citações verificadas" é o argumento central de venda da categoria em 2026.

**O fosso defensável não é o modelo — é o ciclo editorial:** base curada (B5.3) + telemetria de edições (B6) + curadoria contínua por advogado. Isso compõe com o uso e não é copiável por um player horizontal sem montar a mesma operação editorial. A sequência estratégica que maximiza esse fosso: **piloto → telemetria → B5.3 → E1 (selo "citações verificadas" na peça e no marketing)** — o E1 é barato e transforma o diferencial técnico em diferencial *percebido*.

**Risco competitivo a vigiar:** se um player com distribuição (Jusbrasil) acoplar verificação de citações à sua base proprietária, o diferencial (1) encolhe — mais um motivo para o fosso ser o **ciclo editorial + fluxo de campo**, não a verificação isolada.

---

## Síntese executiva

1. **Prompts:** aprovados com ajustes — nenhuma citação inventada; 3 edições concentradas (E1 art. 341, E2 aviso JEF, E3 rito trabalhista) + enriquecimentos opcionais. Promoção a "curado" após execução das edições e leitura de 1 peça de cada tipo pelo dono.
2. **B5.3:** ativo editorial no repo, 5–10 teses previdenciárias primeiro, dono como curador, Escavador adiado, ementa só entra com fonte + verificação humana.
3. **Prioridade pós-piloto:** structured outputs + prompt completo + **telemetria de edições** (o instrumento de medição do piloto) → B5.3/C3/D7-mínimo → C2/B4 só depois da evidência de uso.
4. **B4:** não agora; extrair revisão crítica automática pós-geração (sem fila) e testar plano editável como experimento; decidir com a telemetria.
5. **Riscos antes de dados reais:** confirmar **backup Supabase** (bloqueante), tirar segredos da pasta sincronizada, ampliar logAudit para peças/contratos. MFA e retenção de áudio na sequência.
6. **Competitivo:** a verificação de citações + fluxo de campo já diferenciam; o fosso duradouro é o ciclo editorial — proteger com B5.3+B6 e materializar com E1 quando o piloto validar.
