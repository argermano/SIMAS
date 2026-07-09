# Prompt para Claude Code — Módulo de Publicações/Intimações do SIMAS

Copie tudo abaixo da linha e cole no Claude Code na raiz do projeto SIMAS.

---

## Contexto

Você está trabalhando no SIMAS (Sistema Inteligente de Minutas e Assistência Jurídica), um SaaS jurídico construído com Next.js (App Router), Prisma, Supabase (Postgres), Tailwind e Anthropic SDK, hospedado na Vercel. Antes de começar, explore a estrutura do projeto (schema.prisma, estrutura de rotas, padrão de services/API existente, sistema de autenticação) e siga rigorosamente os padrões já adotados no código.

## Objetivo

Implementar o **módulo de captura automática de publicações e intimações judiciais**, substituindo o fluxo manual hoje feito no software Astrea. O módulo deve capturar diariamente as comunicações processuais publicadas no DJEN (Diário da Justiça Eletrônico Nacional) destinadas às inscrições da advogada, armazená-las de forma auditável e alimentar um fluxo de triagem que gera tarefas no Kanban do escritório.

## Fonte de dados

Fonte primária: **API pública do Comunica/DJEN do CNJ**, base `https://comunicaapi.pje.jus.br/api/v1/comunicacao`.

**PASSO OBRIGATÓRIO ANTES DE CODAR:** valide o contrato real da API fazendo requisições de teste (curl ou fetch) e inspecionando a resposta JSON. Os parâmetros conhecidos incluem consulta por número de OAB, UF da OAB e intervalo de datas de disponibilização, com paginação — mas confirme os nomes exatos dos parâmetros, o formato de datas, o shape da resposta e os limites de paginação empiricamente antes de escrever o client. Não presuma nada do contrato: teste primeiro, documente o que encontrou em um comentário no topo do client, e só então implemente.

Inscrições a monitorar (devem ficar em tabela de configuração, não hardcoded):
- OAB/DF 31.637
- OAB/SC 75.503-A

## Requisitos funcionais

### 1. Modelo de dados (Prisma)

Criar migrations com pelo menos:

- **Publicacao**: id, hashConteudo (único, para deduplicação — hash SHA-256 do texto + número do processo + data de disponibilização), numeroProcesso, siglaTribunal, orgaoJulgador, tipoComunicacao, textoIntegral, dataDisponibilizacao, dataPublicacao (dia útil seguinte à disponibilização, quando aplicável), destinatarios (JSON), oabConsultada, ufOab, fonte (enum: DJEN, MANUAL — extensível para futuros provedores redundantes), status (enum: NOVA, TRIADA, TAREFA_CRIADA, DESCARTADA), tarefaId (FK opcional para o Kanban), metadados brutos da API (JSON), createdAt/updatedAt.
- **CapturaExecucao** (log de auditoria): id, dataReferencia, oabConsultada, ufOab, iniciadaEm, finalizadaEm, statusExecucao (SUCESSO, FALHA, PARCIAL), quantidadeEncontrada, quantidadeNova, quantidadeDuplicada, erroDetalhe (texto), respostaHash. Toda execução gera registro, inclusive quando não encontra nada — a ausência de registro do dia é sinal de falha silenciosa.
- **OabMonitorada**: numero, uf, ativa, createdAt.

### 2. Serviço de captura

- Client HTTP isolado em `lib/` ou `services/` (seguir padrão do projeto) com: timeout, retry com backoff exponencial (3 tentativas), tratamento de paginação completa e respeito a rate limits.
- Job de captura idempotente: pode rodar duas vezes no mesmo dia sem duplicar nada (deduplicação pelo hashConteudo).
- A captura do dia D deve consultar D e também D-1 e D-2 (janela deslizante), para cobrir publicações inseridas retroativamente.
- Timezone: **America/Sao_Paulo** em todos os cálculos de data. Nunca usar UTC puro para datas de disponibilização/publicação.

### 3. Agendamento

- Implementar como rota API protegida (`/api/cron/captura-publicacoes`) autenticada por secret no header (padrão Vercel Cron: `CRON_SECRET`), agendada via `vercel.json` para rodar 2x ao dia (ex.: 07:00 e 12:00 BRT — converter para UTC no cron expression).
- A rota deve suportar execução manual com parâmetro de data para reprocessamento (`?dataInicio=&dataFim=`), restrita a usuário admin.

### 4. Alertas de falha (crítico)

- Se uma execução falhar após os retries, OU se até as 08:00 BRT não houver registro de execução com sucesso do dia, disparar alerta. Canal de alerta: verifique se o projeto já possui integração de notificação (e-mail, ou a Evolution API/WhatsApp usada no ai-attendant); se não houver, implemente alerta por e-mail simples e deixe a interface de notificação abstraída para plugar o WhatsApp depois.
- Falha silenciosa é o pior cenário possível neste módulo: perda de prazo processual. Trate observabilidade como requisito de primeira classe.

### 5. Interface (Next.js + Tailwind)

Página `Publicações` com:

- Lista das publicações por data de disponibilização, com filtros (tribunal, status, OAB, busca textual no conteúdo).
- Badge visual de status (Nova / Triada / Tarefa criada / Descartada) e contador de novas no menu.
- Painel de detalhe com o texto integral da publicação, número do processo com link para consulta, e metadados.
- Ações: **Criar tarefa** (abre modal que pré-preenche título com número do processo e permite indicar responsável e data-limite, integrando com o módulo Kanban existente — se o Kanban ainda não existir no código, criar apenas a interface de contrato/service e deixar TODO documentado), **Descartar** (com motivo obrigatório) e **Marcar como triada**.
- Widget de saúde da captura no topo: última execução, status, quantidade capturada — visível para transmitir confiança de que o robô rodou.

### 6. Regra de negócio sobre prazos — ATENÇÃO

O sistema **NÃO deve calcular prazo processual automaticamente de forma definitiva**. Pode sugerir a data de publicação (dia útil seguinte à disponibilização) e exibir o texto, mas a contagem do prazo e a definição da data-limite da tarefa são decisão da advogada na triagem. Deixe o campo de data-limite sempre editável e nunca pré-confirme prazo sem ação humana. Não invente feriados forenses nem regras de suspensão de prazo.

### 7. Segurança e LGPD

- Publicações podem conter dados pessoais de partes: acesso restrito a usuários autenticados do escritório, seguindo o modelo de autorização existente no SIMAS.
- Não logar texto integral de publicações em logs de aplicação (apenas IDs e hashes).
- Secret do cron e eventuais chaves em variáveis de ambiente, nunca commitadas.

### 8. Testes e entrega

- Testes unitários do deduplicador (hash), do parser da resposta da API e da lógica de janela deslizante de datas.
- Um teste de integração do endpoint de cron com a API mockada.
- Ao final, gere um resumo: o que foi validado empiricamente no contrato da API do CNJ, decisões tomadas, migrations criadas e instruções de configuração (variáveis de ambiente e `vercel.json`).

## Arquitetura futura (não implementar agora, mas não bloquear)

O enum `fonte` e a abstração do client devem permitir adicionar depois um segundo provedor redundante (Escavador, Judit ou Codilo) com rotina de reconciliação diária entre fontes. Estruture o código para isso sem implementar agora.

Trabalhe de forma incremental: primeiro o client validado contra a API real, depois schema + migration, depois o job de captura, depois o cron, depois a UI. Rode lint e testes a cada etapa.
