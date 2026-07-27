# PLANO — Conversas Próprias (SIMAS dono do acervo; aposentadoria do Chatwoot)

> **Contexto/decisão (2026-07-25):** a ponte Evolution↔Chatwoot perde mensagens em
> silêncio (caso real: documentos da Solange em grupo, mídia-primeiro em conversa
> não aberta — e o mesmo vale para cliente novo que abre contato com documento).
> O dono perguntou "o que é mais correto, independente do esforço": o SIMAS passa
> a ser o dono das conversas — ingestão direta dos webhooks da Evolution, acervo
> em banco/storage nossos, Chatwoot aposentado ao final. Fable desenha; Opus
> executa por etapas, cada uma com go explícito do dono e rollback por env.
>
> **Invariantes:** nada é desligado até paridade provada com dados reais; claims
> de fila no padrão da casa (2 UPDATEs, sem .or() com timestamp); LGPD (logs só
> ids/contagens; storage privado com prefixo do tenant); prazo nunca automático;
> mudanças no prompt do bot só com aprovação do dono.

## Panorama das etapas

| Etapa | Entrega | Esforço (workflows Opus) | Duração estimada |
|---|---|---|---|
| 0 | Ingestão própria + acervo paralelo + medidor de perda | 3 | 1–2 dias |
| 1 | Garantia de entrega ao Chatwoot (o bug morre) | 1–2 | ~1 dia |
| 2 | /conversas lê do NOSSO banco | 3–4 | 2–3 dias |
| 3 | Escrita própria + identidade + handoff interno | 2–3 | 1,5–2 dias |
| 4 | Backfill histórico + aposentadoria do Chatwoot | 1–2 + operação | ~1 dia |
| **Total** | | **10–14 workflows** | **~6–9 dias úteis encadeáveis** |

---

## Etapa 0 — Fundação: ingestão própria em paralelo (nada é desligado)

**Objetivo:** todo evento do WhatsApp passa a ser gravado TAMBÉM no SIMAS, com
mídia no nosso storage, sem tocar o fluxo atual. De brinde, um medidor objetivo
de quanto o Chatwoot perde.

1. **VPS — encaminhador durável (ai-attendant):** o `/webhook` já recebe TUDO
   (grupos, mídia, fromMe). Novo: encaminhar cada evento relevante para o SIMAS
   (`POST /api/integracao/conversas/eventos`, x-simas-token, lote) com **buffer
   local em disco** e re-tentativa (SIMAS fora do ar não perde nada). Mídia:
   o ai-attendant baixa via getBase64 e sobe DIRETO ao Supabase Storage com
   **signed upload URL** emitida pelo SIMAS (mesmo padrão dos anexos de 40MB —
   nunca passa pelo corpo da função Vercel); o evento leva só o storagePath.
2. **SIMAS — schema + fila:** migrations: `conversas` (chave: instância + jid
   número/grupo; título; tipo individual/grupo), `conversa_mensagens` (id
   estável = message id da Evolution → dedupe por UNIQUE; direção; autor
   cliente/bot/atendente; tipo texto/mídia; texto; storagePath; timestamps),
   fila `conversas_ingest_fila` com tentativas/dead-letter (padrão 072).
   Endpoint de ingestão valida, deduplica e enfileira; processamento leve inline
   + pesado na folga do cron.
3. **Medidor de paridade:** job que compara (via relay) o que o Chatwoot tem vs
   o nosso acervo por conversa/dia e grava `conversa_gaps` — vira número no
   retorno do cron (e a régua de quando a etapa 4 é segura).

**Riscos/decisões:** volume de storage (mídia 2 instâncias) — teto por arquivo e
retenção a definir com o dono; texto de mensagem fica claro no banco (RLS
service-only, como o Chatwoot faz hoje) — cifrar só se o dono pedir (custo:
busca). **Rollback:** desligar o forward no VPS (1 env).

## Etapa 1 — Garantia de entrega ao Chatwoot (o bug atual morre aqui)

**Objetivo:** enquanto o Chatwoot existir, nada mais se perde nele.

1. A fila da etapa 0 ganha um **poster de reconciliação**: mensagem nossa sem
   correspondente no Chatwoot após N minutos → cria contato/conversa se preciso
   e posta via API (conhecimento já dominado no relay/`chatwoot-api-descoberta`),
   com marcador de origem para dedupe idempotente (re-execução nunca duplica).
2. A ponte nativa da Evolution CONTINUA ligada — nós só cobrimos os buracos
   (só postamos o que comprovadamente não chegou).

**Risco:** dedupe contra corrida com a ponte nativa (janela N minutos + checagem
imediatamente antes do post). **Rollback:** desligar o poster (env), acervo segue.

## Etapa 2 — Leitura própria: /conversas sai do relay

**Objetivo:** a tela /conversas lê do NOSSO banco — mais rápida, busca melhor,
sem os limites do Chatwoot. Chatwoot vira espelho secundário (equipe pode
continuar nele durante a transição).

1. Rotas `/api/conversas/*` trocam relay → banco próprio (lista com paginação
   real, thread, busca full-text nossa, contadores de não-lidas POR USUÁRIO —
   tabela `conversa_vistos`, mesmo padrão do task_vistos).
2. Anexos servidos do nosso storage pelo proxy atual (Range/206 e o player de
   áudio com ogv já funcionam — só muda a origem dos bytes).
3. Foto de contato: cache próprio via Evolution (profilePic pelo encaminhador).
4. **Paridade obrigatória com a tela atual** (checklist de review): filtros
   DF/SC, chips com ícone, Transferidas pelo assistente, vincular cliente,
   comprovante→financeiro, anexar ao dossiê, envio 40MB, áudios.

**Risco:** é o pacote com mais superfície de UI — validação do dono no final da
etapa com roteiro de testes. **Rollback:** flag por env volta as rotas ao relay.

## Etapa 3 — Escrita própria, identidade e handoff interno

**Objetivo:** enviar é nosso; o Chatwoot deixa de ser necessário para operar.

1. Envio texto/anexo DIRETO pela Evolution (instância pela unidade do membro —
   lógica já existente no /notify), gravando na nossa `conversa_mensagens` com
   a identidade real de quem enviou (fim do token pessoal do Chatwoot).
2. **Handoff interno:** estado `atendente_ativa_ate` na conversa (setado por
   qualquer envio humano via SIMAS); o bot troca a consulta ao Chatwoot
   (`humanoAtivoNaConversa`) por `GET /api/integracao/conversas/handoff`
   (x-simas-token, cache 60s) — as 3 camadas atuais viram 1 fonte interna.
3. Estados nossos: aberta/resolvida, etiquetas (transferida etc.), reabertura.
4. Bot: `transferir_para_humano` notifica via SIMAS (já existe o despachante de
   notificações — avisar atendentes por WhatsApp/e-mail conforme preferências).

**Risco:** disciplina de eco (mensagem enviada por nós volta no webhook — dedupe
pelo id, já previsto no schema). **Rollback:** flag volta escrita ao relay.

## Etapa 4 — Backfill histórico + aposentadoria

**Objetivo:** acervo completo e um sistema a menos.

1. **Backfill:** importar do Chatwoot todo o histórico (conversas, mensagens,
   anexos) para o nosso banco/storage via API paginada — workflow próprio, com
   relatório de contagens por conversa (acervo jurídico completo).
2. **Janela de convivência:** medidor da etapa 0 zerado por X dias + ok do dono.
3. Desligar: ponte nativa da Evolution, poster da etapa 1, telas/tokens do
   Chatwoot; containers ficam parados por 30 dias antes de remover (seguro).

---

## Ordem de execução e gates

Cada etapa: spec detalhada → workflows Opus (build + revisor-corretor
adversarial) → gates (tsc, build completo, vitest) → migrations → deploy →
validação do dono → **go explícito para a próxima**. Feature-flags por env em
todas as trocas de origem (leitura/escrita), para rollback em segundos.
