# Status e Próximos Passos — SIMAS / Advogado Virtual

> **Atualizado:** 2026-07-03 · **Objetivo imediato definido pelo dono do produto:** implantar o sistema **no próprio escritório** para validar na prática, **antes** de comercializar. Billing, cadastro self-serve e venda multi-tenant ficam **congelados** até essa validação.
> **Documentos irmãos:** [ANALISE-COMPLETA-2026-07.md](ANALISE-COMPLETA-2026-07.md) (parecer) · [PLANO-DESENVOLVIMENTO-OPUS.md](PLANO-DESENVOLVIMENTO-OPUS.md) (backlog completo) · [REVISAO-ARQUITETURAL.md](REVISAO-ARQUITETURAL.md).

---

## 1. O que mudou nesta rodada (14 commits, todos no ar)

Tudo com `tsc` limpo, build de produção ok e a suíte de testes passando (subiu de 73 para 108 testes). Migrations e backfill foram aplicados na produção com verificação.

| Área | Commit | O que entrega |
|---|---|---|
| Gravação resiliente | `d4da958` | Relato por áudio no celular não se perde: servidor **acumula** a transcrição (antes sobrescrevia); trechos ficam guardados em IndexedDB e são reenviados quando a rede volta |
| SSE robusto | `9aad5c9` | Parser com buffer — geração longa não aborta mais em rede móvel; aviso quando a peça é cortada por limite de tamanho |
| PWA | `1837cf7` | App instalável no celular (manifest, service worker, tela offline, ícones) |
| Mobile | `6f399cd` | Botão de menu não cobre o título; grids responsivos; lista de prazos no lugar do calendário em telas pequenas |
| Curadoria de prompts | `01da1b2` | 10 novos prompts **RASCUNHO** (réplica ×5, apelação ×4, recurso ordinário trab.) — de 10 para 20 combinações área×peça; snapshot trava os antigos |
| Motor B1 | `3fb4e01` | **Peça lê os documentos por inteiro** (fim do corte em 500 caracteres — antes a peça era redigida quase sem ver as provas) |
| Segurança A2 | `4f607ee` | DELETE de cliente/caso exige admin/advogado + **soft-delete** + auditoria (antes qualquer papel apagava em cascata, sem trilha) |
| Segurança A8 | `4f607ee` | Trigger anti-escalonamento de privilégio; validação de posse de FK por tenant; `maxDuration` nas rotas de IA |
| Segurança A3 | `804db9d` | **Transcrições cifradas em repouso** (dado sensível de saúde, LGPD) — backfill de 73 registros aplicado |
| Motor B3 | `47f8e3b` | Painel **"Revisar peça"** no editor (validação de coerência/citações/formatação) + **correção de um clique** — camada anti-alucinação que estava pronta e desligada |
| Custo/cota A6 | `52bfc24` | Preço por modelo (Opus não é mais subestimado ~40%); refino e outras rotas passam a contar no dashboard; `gerar-documento` migrado ao wrapper (guardrail + log) |
| Webhook A1 | `fbe5f5e` | D4Sign fail-closed + service_role (era inseguro **e** quebrado ao mesmo tempo) |
| Editor C1 | `e4c1cd1` | **Autosave + guarda de saída** — 'Voltar' salva o pendente; beforeunload avisa; um clique errado não descarta mais a peça/contrato |
| Contrato C1 | `0c325fb` | Painel de **acompanhamento da assinatura** vira drawer sobre o editor (antes ficava atrás, invisível) |
| Motor B2 | `00d23e6` | **Rede de segurança server-side**: fechar a aba no meio da geração não deixa mais a peça vazia (salva no servidor via `after()` se o cliente não salvar) |
| UI C1 | `2 commits` | **Dark mode** legível (~55 cores fixas com variante dark em 11 telas) + labels de área centralizados (Revisão/Histórico mostravam slug cru para 5 áreas) |
| Prontidão piloto | `85c88b7` | **maxDuration** nas 7 rotas de IA que faltavam (gerar-peca não é mais cortada no meio do stream); **OCR** deixa de truncar documentos longos (4.096→8.192); **custo de transcrição** Groq entra no painel; jargão dev fora de Configurações |
| Anti-alucinação B5.1 | `3ed1764` | **DataJud vira estatística, não jurisprudência citável** — parou de induzir o modelo a citar número de processo (sem ementa/resultado) como precedente |
| Anti-alucinação B5.2 | `124aa8e` | **Verificador determinístico de citações** no painel "Revisar peça": nº CNJ (dígito verificador), súmula (faixa por tribunal) e lei (base local) → verificada ✓ / a conferir ⚠ / suspeita ✗ |
| Anti-alucinação B5.2 online | `16648de` | **Verificação online** eleva ⚠→✓/✗: **LexML** confirma existência de lei federal; **DataJud** confirma processo por nº exato. Roda em paralelo com o LLM. Limites: LexML só federal/nível de lei; DataJud lento (best-effort) |
| CI D9 | `41af1e9` | **GitHub Actions** roda typecheck + 137 testes + build em todo push/PR (antes nada rodava em PR) |
| Segurança A8(c) | `aec360b` | **Magic bytes de áudio** validados no upload/transcrição — arquivo disfarçado de áudio é rejeitado antes de processar |
| E-mails D4 | `de32cf2` | Autor recebe e-mail quando a peça é **aprovada** ou **rejeitada** (com motivo) — fecha o ciclo do colaborador; envio reutilizável via Resend |
| Observabilidade D3 | `5e1a7bc` | `onRequestError` app-wide + `logger.ts` estruturado nas 8 rotas de IA críticas — erro em produção deixa de ser invisível (logs pesquisáveis na Vercel; gancho pronto para Sentry) |

**Onde a Segurança P0 está:** A2, A3 e A8 **completos**. É o que torna seguro colocar dados reais de cliente.

**Atualização (2026-07-03, 2ª leva):** também saíram **C1** (autosave, painel de assinatura, dark mode, labels) e **B2** (persistência server-side do stream) — os itens que evitam perda de trabalho no uso real. Ver seção 3.

---

## 2. Ações do dono do produto (para o piloto no escritório)

Estas dependem de você e do ambiente (Vercel/Supabase) — não são código.

### Antes de cadastrar clientes reais
- [ ] **Criptografia obrigatória:** confirmar que `ENCRYPTION_KEY` está no Vercel (produção) e então setar **`ENCRYPTION_REQUIRED=true`**. Isso impede que um deploy futuro grave CPF/RG/transcrições em texto-plano por acidente. *(Hoje já cifra; o flag torna obrigatório.)*
- [ ] **Backup do banco:** confirmar no painel Supabase o plano e a política de backup (idealmente PITR / backups diários). Dados de cliente de escritório precisam ser recuperáveis. É a maior lacuna operacional em aberto.
- [ ] **Chaves de feature:** `GROQ_API_KEY` (transcrição de áudio) e `RESEND_API_KEY` (e-mails de convite/revisão) no Vercel, se for usar essas funções no piloto.
- [ ] **Tenant do escritório:** como é o seu próprio escritório (tenant único), o cadastro é manual — não precisa de self-serve. Preencher em **Configurações**: dados profissionais (OAB, responsável — necessários para contratos saírem completos), papel timbrado, formatação padrão e modelo de contrato.

### Validações práticas (testar no uso real)
- [ ] **Celular em campo:** instalar o app (Adicionar à tela de início), gravar um relato de teste e, no meio, ativar o modo avião para ver os trechos ficarem "aguardando conexão" e reenviarem sozinhos ao voltar a rede.
- [ ] **Painel de revisão:** abrir uma peça no editor, clicar **"Revisar peça"**, conferir o score/avisos e testar uma **correção de um clique**.
- [x] **Curadoria jurídica dos 10 prompts:** ✅ revisão Fable feita em 2026-07-03 (docs/PARECER-FABLE-2026-07-03.md) — todas as citações verificadas (nenhuma inventada); edições E1–E6 aplicadas (art. 341, alerta JEF, rito trabalhista, enriquecimentos); promovidos de RASCUNHO a Curado. **Resta a aprovação final do advogado: ler 1 peça gerada de cada tipo (réplica, apelação, recurso ordinário).**

---

## 3. Recomendado ANTES de dados reais (posso executar quando quiser)

Itens de "prontidão para piloto" que **não dependem de decisão comercial** e que valem para operar com dados reais com segurança/visibilidade.

> **Já feitos:** ✅ **C1** e ✅ **B2** (perda de trabalho); ✅ **B5.1/B5.2 + online** (anti-alucinação de citações); ✅ **D9** (CI), ✅ **A8(c)** (magic bytes de áudio), ✅ **D4** (e-mail de peça aprovada/rejeitada), ✅ **D3** (observabilidade — `onRequestError` app-wide + `logger.ts` nas rotas de IA críticas).

O que ainda faz sentido antes/no início do piloto:

1. **Sentry (fecha o D3).** O gancho já existe no `onRequestError`; falta a conta + `SENTRY_DSN` (ação sua) e ligar o SDK para ter **alerta** quando erro dispara (hoje os logs estruturados já aparecem no painel da Vercel, mas sem alerta ativo).
2. **Portabilidade/retenção LGPD (D7, versão mínima).** Endpoint de **exportação** dos dados de um cliente (JSON/ZIP) e política de retenção de áudios/transcrições. Menos urgente com um só escritório, mas fecha o ciclo LGPD antes de escalar.
3. **Fila para jobs longos (D5).** Só vira necessário para o **pipeline multi-etapa do motor (B4)** e para **e-mail de prazo de tarefa** (precisa de agendador). Não é pré-requisito do piloto básico.

*Rate limiting real (D6) é baixa prioridade para um único escritório (pouca concorrência).*

---

## 4. Congelado até validar na prática (decisão do dono do produto)

Não programar agora:
- **Billing / planos / cobrança (D1)** e **cadastro self-serve / go-to-market (D2)** — o "item 1". Só fazem sentido depois de validar o produto no escritório. Os planos em `quota.ts` seguem existindo como limites técnicos, sem cobrança.
- **D4Sign de produção** — assinatura manual é o caminho atual; o webhook está seguro (inerte até o secret ser provisionado). Arquivar o PDF assinado no Storage fica para quando a conta de produção existir.
- **Consolidar o motor / apagar rotas órfãs** (dúvida #1 do inventário) — precisa da sua decisão sobre quais rotas mortas são lixo vs. feature planejada. Duas delas (`validar-peca`, `correcao-auto`) deixaram de ser órfãs no B3.

---

## 5. Backlog de evolução (pós-validação, quando fizer sentido)

O diferencial competitivo real, para depois que o piloto provar o fluxo:
- **B5 — fundamentação verificada (parcialmente feito).** ✅ B5.1 (DataJud como estatística) e ✅ B5.2 (verificador determinístico de citações: nº CNJ, súmula, lei) já entregues. **Próximo incremento:** verificação *online* — LexML para existência de lei/artigo, DataJud para existência de processo — e a **base curada de teses/ementas por área** (B5.3), que é o que efetivamente coloca jurisprudência real citável na peça (exige curadoria contínua). É a régua competitiva de 2026 contra jurisprudência inventada.
- **B4 — pipeline multi-etapa.** Gerar a peça em etapas (plano → redação → revisão crítica) em vez de one-shot. Requer a fila (D5).
- **Fundamentação verificada + base de teses curadas por área** (o moat editorial).
- **Consolidação do motor** (`gerarPeca({modo})`) e limpeza de código morto.
- **Novas funcionalidades** (parecer §E): enriquecimento de capa via DataJud (grátis), agenda de prazos, intimações via API parceira como add-on, intake por WhatsApp — na ordem de valor da tabela do parecer.

---

## 6. Dúvidas que ainda importam (fora as de billing, congeladas)

1. **Backup Supabase:** qual plano/política (PITR? diário?) e qual perda de dados aceitável para dossiês reais?
2. **Rotas órfãs (dúvida #1):** `refinar-peca`, `comando`, `exportar`, `templates/[tipo]`, etc. — apagar ou são features planejadas? (Destrava a limpeza do motor.)
3. **Curadoria contínua:** quem revisa os prompts jurídicos ao longo do tempo (você, advogado parceiro)? Quais áreas×peças priorizar depois desta primeira leva?
4. **Retenção de áudio:** política para os chunks/áudios gravados (prazo, expurgo) — relevante assim que houver volume real.

---

*Resumo mantido para consulta offline. A execução técnica sem dependência de decisão sua está essencialmente esgotada; o próximo passo natural é o piloto no escritório + os itens de prontidão da seção 3 quando você quiser.*
