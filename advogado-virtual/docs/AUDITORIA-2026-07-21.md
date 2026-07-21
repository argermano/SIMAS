# Auditoria SIMAS — 2026-07-21

Varredura multi-agente (8 dimensões + crítico de completude), com **verificação adversarial**: cada achado só entrou aqui depois que um verificador independente confirmou o problema lendo o código real (49 brutos → 42 confirmados, 6 refutados).

**Decisões intencionais do dono foram respeitadas** (prazo nunca automático, baixa financeira manual, crons diários do plano Hobby, claims em 2 UPDATEs etc.) — nada aqui as contraria.

| Severidade | Qtde |
|---|---|
| alta | 2 |
| media | 25 |
| baixa | 15 |

---

## 🔴 Severidade ALTA

### 1. IDOR cross-tenant: leitura de qualquer documento via storagePath não validado (admin client bypassa RLS)

- **Onde:** `src/app/api/atendimentos/[id]/documentos/route.ts:134` · **Dimensão:** Segurança de API · **Esforço:** pequeno

No handler PATCH, storagePath vem do corpo (linha 118), sem zod e sem guarda de tenant, e é baixado com o admin client (service role, que ignora a RLS): `adminSupabase.storage.from('documentos').download(storagePath)`. O texto extraído é devolvido na resposta (linhas 189-191). O parâmetro `id` (atendimento) NUNCA é reconferido no PATCH e não há requireRole, então qualquer usuário autenticado (inclusive colaborador) pode passar um path de OUTRO tenant (formato `<tenant>/<atendimento>/docs/...`, exposto em outras respostas) e obter o conteúdo do documento alheio. As rotas irmãs (atendimentos/[id]/audio linha 167, ia/transcrever-audio-upload linha 101, clientes/[id]/documentos linha 72) já aplicam exatamente o guard que falta aqui.

```
const { data: fileData, error: downloadError } = await adminSupabase.storage.from('documentos').download(storagePath)  // storagePath do body, sem !storagePath.startsWith(`${usuario.tenant_id}/`)
```

**Recomendação:** Antes do download, buscar o documento por documentoId+tenant_id (como faz documentos/[docId]/extrair) e usar doc.file_url do banco em vez do storagePath do cliente; alternativamente exigir `storagePath.startsWith(`${usuario.tenant_id}/`)` (mesmo guard da rota de áudio) e reconferir o tenant do atendimento `id`. Adicionar validação zod e requireRole. Impacto imediato limitado ao piloto single-tenant, mas quebra total de isolamento ao onboardar novos tenants.

> **Nota do verificador:** Mantenho severidade alta (RLS bypass via service_role em SaaS multi-tenant, com padrão de guard já mandatório no restante do código), mas com duas ressalvas de reachability prática: (1) para vazamento cross-tenant o atacante precisa conhecer um storagePath completo de outro tenant (formato <uuid>/<uuid>/docs/<ts>_<nome>, não enumerável trivialmente — não é 'exposto em outras respostas' para terceiros, só o próprio path do usuário volta no POST linha 103); (2) hoje há um único tenant piloto, então o impacto imediato é nulo. Ainda assim procede: depender da imprevisibilidade do UUID para isolamento é justamente o anti-padrão que o guard existe para evitar, e a correção é barata (esforço pequeno, <1h): adicionar a checagem de prefixo de tenant como na rota de áudio E/OU trocar por buscar o documento por documentoId+tenant_id e usar doc.file_url do banco (padrão de documentos/[docId]/extrair), além de zod e requireRole.

### 2. Usuário desativado/removido mantém acesso total (status nunca é conferido na autenticação)

- **Onde:** `src/lib/auth.ts:39` · **Dimensão:** Completude · **Esforço:** pequeno

getAuthContext() é o portão único de todas as ~159 rotas de API, mas seleciona o usuário só por auth_user_id, SEM filtrar status='ativo'. O middleware também só valida a sessão (supabase.auth.getUser()), não o status. E DELETE /api/usuarios/[id] apenas marca status:'inativo' — não chama admin.auth signOut/deleteUser/ban nem invalida o refresh token. Resultado: um funcionário 'removido' em Configurações > Equipe continua com acesso irrestrito a todos os dados de clientes enquanto o token da sessão Supabase for renovável (na prática, indefinidamente). O único lugar que confere status='ativo' é o feed ICS público — provando que o resto não confere.

```
auth.ts:39 => supabase.from('users').select('id, nome, tenant_id, role, unidade').eq('auth_user_id', user.id).single()  // sem .eq('status','ativo')  |  usuarios/[id]/route.ts:105 => .from('users').update({ status: 'inativo' }).eq('id', id)  // não revoga sessão
```

**Recomendação:** Em getAuthContext() adicionar .eq('status','ativo') ao lookup (usuário inativo → 401/403). No DELETE/PATCH que inativa, também revogar a sessão via adminSupabase.auth.admin (signOut do usuário ou ban) para cortar o acesso imediatamente, não só na expiração do token.

> **Nota do verificador:** Correção mínima e suficiente (esforço pequeno, <1h): adicionar `.eq('status','ativo')` ao lookup de getAuthContext() em src/lib/auth.ts:42 — usuário inativo passa a receber 404/401 já na próxima requisição, cortando o gate de todas as ~159 rotas de uma vez. Recomendado também aplicar o mesmo filtro no helper RLS get_user_tenant_id() (005_rls_policies.sql) para defesa em profundidade. Para corte IMEDIATO da sessão viva (não só na próxima request), complementar o DELETE e o PATCH-para-inativo em src/app/api/usuarios/[id]/route.ts com revogação via adminSupabase.auth.admin (updateUserById com ban_duration ou signOut do usuário) — esforço pequeno/medio. Observação de segurança da mudança: o schema de status só admite 'ativo'|'inativo' e o convite já cria com status:'ativo' (convite/route.ts:108), então filtrar por 'ativo' não quebra usuários legítimos nem o fluxo de convite.

## 🟡 Severidade MÉDIA

### 3. IDOR cross-tenant: contrato assinado aponta para path arbitrário e é servido com URL assinada de service role

- **Onde:** `src/app/api/contratos/[id]/arquivo-assinado/route.ts:84` · **Dimensão:** Segurança de API · **Esforço:** pequeno

O PATCH grava `arquivo_assinado_url: storagePath` direto do corpo (linha 78-84), sem validar que o path pertença ao espaço do tenant (o POST gera sempre `${tenant}/contratos/${id}/...` na linha 50, mas o PATCH aceita qualquer string). Depois o GET assina esse valor com o admin client — `adminStorage().createSignedUrl(contrato.arquivo_assinado_url, 300)` (linha 126) — que ignora a RLS do bucket. Um admin/advogado pode setar o arquivo_assinado_url do PRÓPRIO contrato para o path de um contrato/documento de OUTRO tenant e, no GET, receber uma URL assinada para baixá-lo. As rotas de upload confirmado do restante do código validam o prefixo do tenant; aqui não há essa checagem.

```
PATCH: .update({ arquivo_assinado_url: storagePath, ... })  // sem startsWith(`${usuario.tenant_id}/contratos/${id}/`)
GET: adminStorage().createSignedUrl(contrato.arquivo_assinado_url, 300)
```

**Recomendação:** No PATCH, rejeitar storagePath que não comece com `${usuario.tenant_id}/contratos/${id}/` (paridade com clientes/[id]/documentos linha 72) e validar o corpo com zod. Idealmente confirmar que o objeto existe no Storage sob esse prefixo antes de persistir.

> **Nota do verificador:** Rebaixo de alta para media. A vulnerabilidade (falta de validação de prefixo) é real e o gap de defesa-em-profundidade é legítimo, mas o cenário-título "IDOR cross-tenant para baixar arquivo de outro tenant" é impraticável de explorar: os paths do bucket embutem tenant_id (UUID) + id do contrato/cliente (UUID) + Date.now() + nome do arquivo, todos não-enumeráveis, e não existe vetor de vazamento de path entre tenants (o POST só devolve o path do próprio contrato, escopado por tenant; não há listagem cross-tenant acessível ao atacante). Some-se a isso o tenant piloto único em produção hoje. O risco residual concreto é intra-tenant (um contrato pode apontar para qualquer objeto do bucket) e a inconsistência com o padrão já adotado no resto do código. Correção é barata (pequeno esforço): no PATCH rejeitar storagePath que não comece com `${usuario.tenant_id}/contratos/${id}/`, validar o corpo com zod e, idealmente, confirmar via Storage.list que o objeto existe sob esse prefixo antes de persistir — paridade com clientes/[id]/documentos.

### 4. LGPD: dados pessoais (telefone, nome) gravados em texto claro no audit_log, contrariando a própria norma do projeto

- **Onde:** `src/app/api/conversas/vincular/route.ts:98` · **Dimensão:** Segurança de API · **Esforço:** pequeno

O metadata de auditoria de conversa.vinculada grava o telefone e o telefone anterior do cliente em texto claro (telefone não é cifrado em repouso — só cpf/rg são, ver CAMPOS_SENSIVEIS em src/lib/encryption.ts). O mesmo ocorre em clientes/[id]/route.ts linha 151 (cliente.delete grava `nome`). Isso destoa da convenção explícita repetida em várias rotas do próprio código ('LGPD: auditoria só com ids/contagens — nunca valores/nomes', ex.: financeiro/comprovantes/[id]/atribuir e conversas/[id]/salvar-anexo). Fere a minimização de dados: o audit_log passa a acumular PII que não é necessária para a trilha (bastariam ids/flags).

```
metadata: { telefone: telefone.trim(), telefone_anterior: telefoneAtual || null, substituiu: Boolean(...) }
```

**Recomendação:** Remover valores pessoais do metadata de auditoria (manter só resourceId=cliente.id e flags booleanas, ex.: substituiu/tinhaTelefoneAnterior). Ajustar também clientes/[id] DELETE para não gravar `nome`. Padronizar com o restante das rotas que já auditam só ids/contagens.

> **Nota do verificador:** Dois pontos exatos a corrigir: (1) conversas/vincular/route.ts:97-101 — trocar telefone/telefone_anterior por flags booleanas já disponíveis no escopo (substituiu já existe; adicionar tinhaTelefoneAnterior = Boolean(telefoneAtual)), mantendo resourceId=cliente.id. (2) clientes/[id]/route.ts:151 — remover nome do metadata (deixar só { soft: true }); o resourceId=id já identifica o registro soft-deletado. Severidade media mantida: audit_log é tenant-scoped e telefone/nome já são visíveis aos mesmos usuários na própria tabela clientes, então é desvio de minimização/norma interna, não novo vetor de vazamento. Esforço pequeno (<1h, edição pontual em 2 arquivos).

### 5. Fluxo de assinatura D4Sign loga e-mails dos signatários e respostas cruas da API no console

- **Onde:** `src/app/api/contratos/[id]/assinar/route.ts:308` · **Dimensão:** Dados/LGPD · **Esforço:** pequeno

O fluxo de assinatura de contratos escreve dados pessoais direto no console (logs da Vercel), violando a regra da casa (só ids e contagens). Em assinar/route.ts: linha 308 `console.log('[assinar] Signatários cadastrados:', JSON.stringify(signerResponses))` e linha 322 `console.log('[assinar] Posicionando assinaturas:', JSON.stringify(pins))` — `pins` contém `email: signers[idx].email`. No cliente d4sign/client.ts a coisa é pior: linha 133 `console.log('[D4Sign] addPins:', JSON.stringify(body, null, 2))` (body com e-mails), e linhas 140 e 175 logam o `responseText` CRU da D4Sign (que traz e-mail do signatário e potencialmente a chave/link de assinatura). O logger.ts com redação NÃO é usado aqui — são console.log diretos, então nada é mascarado. Observação atenuante: a D4Sign de produção ainda não está contratada (assinatura é manual hoje, ver comentário no webhook), então o vetor está inativo em prod no momento.

```
assinar/route.ts:308 `console.log('[assinar] Signatários cadastrados:', JSON.stringify(signerResponses))` · client.ts:133 `console.log('[D4Sign] addPins:', JSON.stringify(body, null, 2))` · client.ts:175 `console.log('[D4Sign] sendToSign response:', res.status, responseText)`
```

**Recomendação:** Remover os console.log que serializam signerResponses/pins/body/responseText, ou trocar por logger.info com apenas ids/contagens (ex.: { docUuid, qtdSignatarios }). Se precisar de debug pontual, gatear por env DEBUG_D4SIGN e nunca logar e-mail nem o corpo da resposta.

> **Nota do verificador:** Severidade media mantida (não alta): fator atenuante real e verificado — o comentário em src/app/api/webhooks/d4sign/route.ts:22-23 confirma que a D4Sign de produção ainda não está contratada e a assinatura é manual hoje, então o vetor está dormente em prod. Além disso são logs internos da Vercel, não exposição pública. Dois pontos a acrescentar à correção: (1) há uma terceira ocorrência no route.ts:336 `console.log('[assinar] Resultado sendToSign:', JSON.stringify(sendResult))` (resposta crua da D4Sign, mesma classe de vazamento) que deve entrar na limpeza; (2) além do e-mail, a linha 308 vaza o key_signer — não é só PII, é uma credencial de fluxo de assinatura, o que reforça a importância de mascarar.

### 6. Dedup de movimentos do DataJud usa hash sobre JSON bruto (sensível à ordem de chaves)

- **Onde:** `src/lib/processos/sync.ts:39` · **Dimensão:** Corretude · **Esforço:** medio

A chave que impede reprocessar/reavisar um movimento é md5(JSON.stringify(raw)) sobre o objeto CRU do DataJud (raw = m, o _source.movimentos[] intocado — ver jurisprudencia/datajud.ts:285), gravada no índice único (processo_id, raw_hash). JSON.stringify é sensível à ordem das chaves e à presença de campos: se o Elasticsearch do tribunal reordenar campos ou incluir um campo novo, TODO movimento já existente re-hasheia como 'novo', o upsert insere linha nova e — para clientes VIP/automático — dispara aviso ao cliente de movimentos antigos em massa. É uma quebra latente de alto raio de alcance (mensagens duplicadas a toda a carteira) dependente de mudança externa. (Nota: o lado DJEN usa hashMovimento({djen: it.id}), que é estável; só o lado DataJud é frágil.)

```
export function hashMovimento(raw: unknown): string { return createHash('md5').update(JSON.stringify(raw)).digest('hex') } // ... .upsert(linhas, { onConflict: 'processo_id,raw_hash', ignoreDuplicates: true })
```

**Recomendação:** Hashear uma projeção canônica e estável (ex.: codigo + nome + dataHora + complementos com chaves ordenadas), não o objeto bruto. Cuidado na transição: trocar a função retroativamente causaria exatamente a rajada de duplicatas — aplicar só a inserções futuras ou migrar os hashes existentes de forma controlada.

> **Nota do verificador:** Três ressalvas que calibram o achado sem invalidá-lo:

(a) O subcenário "reordenação de chaves a cada resposta" NÃO está ocorrendo em produção: o sistema está no ar (Fase 5, TJPR/Marta) e não há relato de duplicação contínua, logo a ordem por documento é estável na prática. O gatilho realista é uma mudança externa PONTUAL do schema do DataJud/CNJ (novo campo, bump de versão do Modelo Nacional de Interoperabilidade), não churn contínuo. Isso reforça severidade media (não alta): impacto alto porém probabilidade baixa e evento externo/pontual.

(b) O impacto "toda a carteira em massa" está levemente superestimado: a rajada de avisos fica limitada aos movimentos de categorias notificáveis (sync.ts:194, `notif.notificaveis.has(categoria)`) E a clientes com aviso 'automatico' (ou 'fila', que só enfileira). Ainda é grave, mas não é literalmente todo movimento de todo cliente.

(b-extra) O fix é barato porque os campos projetados que a recomendação sugere (codigo, nome, dataHora, complementos) JÁ são extraídos em MovimentoBruto (datajud.ts:281-284) — basta hashear `{codigo, nome, dataHora, complementos}` em ordem fixa em vez de `m.raw`.

(c) Ponto adicional que aumenta a confiança/urgência: o teste em processos.test.ts:98-104 dá falsa segurança — ele valida a estabilidade do hash usando um objeto LIMPO e projetado `{codigo, nome, dataHora}`, que NÃO reflete o input real de produção (`m.raw`, o objeto ES completo). O teste passaria mesmo com a fragilidade presente.

(d) A cautela de transição na recomendação é correta e essencial: trocar a função retroativamente causaria exatamente a rajada de duplicatas que o achado alerta — aplicar só a inserções futuras (backfill controlado dos raw_hash existentes recomputando a projeção a partir do `raw` já gravado na coluna `processo_movimentos.raw`).

### 7. Recuperação de órfãos pode reenfileirar aviso que já foi entregue

- **Onde:** `src/app/api/cron/funil-consultas/route.ts:57` · **Dimensão:** Corretude · **Esforço:** pequeno

O fluxo automático faz: claim pendente→aprovada, envia o WhatsApp, e SÓ DEPOIS grava notif_status='enviada'+notif_enviada_em em um UPDATE separado (sync.ts:245-251, djen.ts:744-750). Se a função morrer entre o envio bem-sucedido e esse UPDATE, a linha fica 'aprovada' com notif_enviada_em=null — indistinguível de 'reclamada mas nunca enviada'. A varredura de órfãos devolve essas linhas para 'pendente', reabrindo-as na fila de Movimentações; um humano aprova → o cliente recebe o MESMO aviso de novo. O comentário assume que o crash foi ANTES do envio, mas não há como o sweep saber.

```
.update({ notif_status: 'pendente' }).eq('notif_status', 'aprovada').is('notif_enviada_em', null).lt('created_at', new Date(Date.now() - 30 * 60_000).toISOString())
```

**Recomendação:** Registrar uma tentativa de envio ANTES do fetch (ex.: notif_tentativa_em no mesmo UPDATE do claim, ou um marcador otimista) e fazer o sweep recuperar apenas linhas SEM tentativa registrada; ou combinar com a chave de idempotência do achado 1 para que o reenvio seja deduplicado na entrega.

> **Nota do verificador:** Reforço de alcançabilidade que o auditor subestimou: o UPDATE que grava 'enviada' NÃO checa o retorno de erro (sync.ts:248-251 e djen.ts:747-750 descartam o objeto retornado). Se esse UPDATE falhar (erro transitório do PostgREST / blip de rede na própria requisição), a linha fica presa em 'aprovada'+null SEM nenhum crash — apenas silêncio — e o sweep a devolve para 'pendente'. Ou seja, não depende de a função morrer no milissegundo exato entre send e marca; um UPDATE que retorna erro e não é reprocessado já basta. Sobre a recomendação: um marcador notif_tentativa_em no mesmo UPDATE do claim, sozinho, NÃO resolve — a tentativa é registrada imediatamente antes do fetch, então continua ambíguo se o send chegou a completar. A correção robusta é a chave de idempotência (o 'achado 1' referido): enviar um dedup-key ao /notify do VPS para que o reenvio seja descartado na entrega, mesmo que a linha seja revertida e re-aprovada. Alternativa mais barata sem tocar o VPS: em vez de o sweep devolver para 'pendente' (que reentra na fila e será re-enviado como se fosse novo), colocar as linhas 'aprovada'+null antigas num status próprio de revisão ('verificar_envio') que exige o humano confirmar explicitamente 'não foi enviado' antes de reenfileirar — assim o duplicado deixa de ser silencioso. Esforço: pequeno para o status de revisão; médio se for a chave de idempotência ponta-a-ponta com o VPS (outro repo).

### 8. Filas de sincronização sem contador de tentativas nem dead-letter: item com erro terminal é reprocessado para sempre, em silêncio

- **Onde:** `src/lib/drive/espelho.ts:547` · **Dimensão:** Resiliência · **Esforço:** medio

drive_sync_fila e calendar_sync_fila têm apenas enfileirado_em e processando_em (claim/stale) — nenhuma coluna de tentativas ou estado terminal (confirmado nas migrations 066 e 068). No dreno, sucesso deleta a linha; QUALQUER erro (erros>0) apenas libera o claim (processando_em=null) e deixa a linha na fila. Um item com falha PERMANENTE — documento corrompido que nunca baixa do bucket, evento que o Google sempre rejeita com HTTP 400, arquivo grande demais — volta a ser tentado em todo ciclo de cron e em todo dreno pós-mutação, indefinidamente, consumindo orçamento de tempo e sem jamais emitir alarme. O mesmo padrão vale para processos: 'sync_pendente' só é limpo no sucesso (sync.ts), então um CNJ inválido/tribunal_alias errado que sempre retorna 'nao_encontrado' fica pendente e é consultado no DataJud todo dia para sempre. Não é o caso de item 'preso' por claim vencido (isso está protegido); é erro terminal sem caminho de saída nem visibilidade.

```
if (r.erros === 0) { await admin.from('drive_sync_fila').delete()... } else { await admin.from('drive_sync_fila').update({ processando_em: null })... } // nenhum incremento de tentativa; migration 066: colunas = enfileirado_em, processando_em
```

**Recomendação:** Adicionar coluna 'tentativas' (int) e 'ultimo_erro' às filas; incrementar a cada falha; após N (ex.: 5) mover para estado dead-letter (ou setar 'processando_em' num futuro distante) e registrar em capturas/auditoria + Sentry para aparecer no card de status em Configurações. Para processos, um teto de tentativas em sync_pendente com marcação de 'sync_falhou' idem. Assim um item podre para de queimar orçamento e vira algo que um humano vê.

> **Nota do verificador:** Mantenho severidade media, mas ela está no limite inferior: não há perda de dados nem risco de segurança, e como o tenant piloto está com base zerada e o cron é diário com budget de 45s, o desperdício de compute hoje é pequeno. O valor real do achado é OBSERVABILIDADE — uma sincronização genuinamente quebrada (documento de cliente que nunca espelha para o Drive, evento que o Google sempre rejeita) some de vista do dono num produto que quer ser o Drive/agenda de referência do escritório; esse ponto justifica media. Duas ressalvas na recomendação: (1) para PROCESSOS, o retry diário em 'nao_encontrado' é PARCIALMENTE intencional — o próprio comentário diz que a cobertura do DataJud é eventual, então CNJ válido ainda não indexado DEVE ser reconsultado; um teto de tentativas cru marcaria como falho um processo real que só está atrasado no DataJud. A correção certa aqui é distinguir transitório (nao_encontrado → seguir tentando, talvez com backoff) de terminal (CNJ malformado / tribunal_alias inexistente → marcar sync_falhou), não um contador único. (2) Para CALENDAR já existe o conceito de estado terminal ('ignorado' sai da fila), então estender para 'após N erros → dead-letter/visível' é um passo pequeno e natural. Priorizar: adicionar tentativas+ultimo_erro nas duas filas de espelho, mover para dead-letter após N e expor no card de status de Configurações + logger.warn (respeitando LGPD: só ids/contagens) — deixa o item podre parar de queimar budget e vira algo que um humano vê. Esforço: pequeno-a-medio (migration com 2 ALTER + ~3 pontos de código).

### 9. Vigia de captura DJEN é cego para OABs configuradas só em config.djen_oabs (e para tenant sem OAB) — cron diário pode morrer 100% em silêncio

- **Onde:** `src/app/api/cron/lembretes-prazo/route.ts:111` · **Dimensão:** Resiliência · **Esforço:** pequeno

O único alarme para 'o ciclo diário de captura não rodou' é o vigia cruzado no cron lembretes-prazo, que só entra em ação se existir tenant com tenants.oab_numero preenchido. Mas o conjunto REAL de OABs monitoradas vem de oabsDoTenant(), que também monitora as extras em config.djen_oabs mesmo quando oab_numero é null (linhas 387-394 de djen.ts). Ou seja: um tenant que monitora publicações apenas via config.djen_oabs captura normalmente todos os dias, porém o vigia calcula 'nenhuma OAB configurada' → o bloco inteiro é pulado → se a captura parar de rodar (falha silenciosa), NENHUM alerta é disparado. Pior no estado atual do piloto: a base foi zerada em 2026-07-05 e a OAB ainda será recadastrada; enquanto oab_numero estiver null, um funil-consultas totalmente morto (ex.: CRON_SECRET desalinhado devolvendo 401 todo dia) não gera alarme algum, porque este é o único watchdog e ele está inerte.

```
.from('tenants').select('id').not('oab_numero', 'is', null).limit(1)  — mas oabsDoTenant lê extras de config.djen_oabs mesmo com oab_numero null
```

**Recomendação:** Fazer o vigia usar a MESMA fonte de verdade que a captura (oabsDoTenant / também considerar config.djen_oabs), e adicionar um heartbeat incondicional: gravar 'cron.funil_consultas.ultimo_sucesso' a cada rodada e o vigia alertar se não houver heartbeat em 26h — independente de OAB. Isso cobre também o caso de o cron morrer antes de chegar na etapa DJEN.

> **Nota do verificador:** Mantenho severidade média, mas o achado está descrito de forma mais alarmante do que o gatilho real: (1) O bug só se manifesta na config "só djen_oabs com oab_numero null", que NÃO é o setup esperado do piloto — a OAB principal vem do perfil readonly e cai em oab_numero, restaurando o vigia. (2) O "Scenario B" do achado (oab_numero null → funil morto → sem alarme) é, na maior parte, comportamento CORRETO: se oab_numero é null E djen_oabs vazio, nada está sendo monitorado, então não há captura esperada nem alarme devido; o defeito só morde quando djen_oabs está populado. (3) Existe detecção secundária humana em /api/publicacoes/saude (staleness de ultimaSucessoEm + alertas falha/parcial por OAB via oabsDoTenant), então o vigia cruzado é o único alerta 100% automático, não a única detecção. Sobre a recomendação: a linha de sucesso em capturas_publicacoes já funciona como heartbeat — o conserto necessário é apenas alinhar o gate do vigia a oabsDoTenant (esforço pequeno, <1h); um heartbeat separado é opcional. Além disso, se a causa for CRON_SECRET desalinhado, ambos os crons (lembretes-prazo e funil-consultas) retornam 401 e o próprio vigia não roda — logo esse cenário específico citado não seria coberto nem com o gate corrigido.

### 10. Cliente HTTP da D4Sign faz fetch sem timeout/AbortSignal — conexão pendurada trava a função até a Vercel matar

- **Onde:** `src/lib/d4sign/client.ts:55` · **Dimensão:** Resiliência · **Esforço:** pequeno

Todo os outros clientes externos (DataJud, DJEN, Drive, Calendar, WhatsApp/Evolution, Chatwoot relay) usam AbortController com timeout. A D4Sign é a exceção: nenhum dos ~13 fetch em client.ts passa signal. O withRetry() só re-tenta em erro 5xx capturado — não protege contra um socket que fica pendurado (sem resposta), que nunca lança e prende a serverless até o kill da Vercel, consumindo o orçamento do request de assinatura. Como a integração está 'em validação', o custo de corrigir agora é mínimo.

```
const res = await fetch(`${base()}/safes${auth()}`, { headers: { Accept: 'application/json' } })  // sem signal/timeout (idem upload, sendtosigner, download, cancel...)
```

**Recomendação:** Envolver os fetch da D4Sign em um helper com AbortController (ex.: 15-30s conforme upload/download), à imagem de drive/api.ts, e tratar timeout como transitório no withRetry.

> **Nota do verificador:** Precisão: 'trava até a Vercel matar' é levemente exagerado — o fetch do Node (undici) tem headersTimeout/bodyTimeout default (~300s), logo não é infinito; mas na serverless o maxDuration da Vercel mata antes, e o resultado prático (request pego pelo tempo todo + erro opaco de plataforma em vez de erro limpo/re-tentável) se sustenta. Correção é pequena (<1h): extrair um helper com AbortController (ex.: 15s para chamadas JSON, 30s para upload/download) espelhando drive/api.ts, e tratar o AbortError como transitório dentro de withRetry para permitir 1 retry. Severidade media está correta (robustez concreta, sem risco de dado/segurança).

### 11. Rede de segurança pós-stream de peças: falha do after() só vai para console.error — peça gerada pode se perder sem ninguém ver

- **Onde:** `src/lib/ia/pecas/motor.ts:60` · **Dimensão:** Resiliência · **Esforço:** pequeno

salvarPecaPosStreamSeVazia é a ÚLTIMA linha de defesa contra perder uma peça quando o cliente fecha a aba/cai no meio do stream: roda em after() e grava o conteúdo se a peça ficou vazia. Se esse after() falhar (download do texto final, update no banco), o erro só é escrito com console.error — não passa pelo logger estruturado nem pelo Sentry, e o usuário já recebeu a resposta e acredita que a peça foi gerada. Resultado: peça silenciosamente perdida (exatamente o padrão 'usuário acha que funcionou'). Vale para os demais efeitos após a resposta também (dreno do Calendar, anexo do Chatwoot): todos logam mas nenhum alerta — a observabilidade de efeitos pós-resposta é log-only.

```
} catch (e) { console.error('[motor] rede de segurança pós-stream falhou:', e instanceof Error ? e.message : e) }
```

**Recomendação:** No catch do after() de motor.ts, rotear para Sentry.captureException (a peça vazia é perda de trabalho do usuário, não ruído). Opcional: marcar a peça/atendimento com um flag 'save_falhou' para a UI mostrar 'não foi possível salvar, gere de novo' em vez de deixar rascunho vazio silencioso.

> **Nota do verificador:** Severidade media está correta (não alta): a perda real exige falha composta — o cliente falhar em salvar E o after() lançar exceção; é o fallback do fallback falhando, portanto mais raro que perda por falha única. Fica acima de baixa porque, quando ocorre, é perda silenciosa de trabalho do usuário com a UI indicando sucesso. Escopo da correção: o núcleo (trocar console.error por logger.error/Sentry.captureException, seguindo o padrão de alertas.ts) é esforço pequeno (<1h). O flag 'save_falhou' na UI sugerido é uma mudança separada e maior (médio) — não deve ser tratado como parte obrigatória do mesmo achado.

### 12. by-phone carrega TODOS os clientes por mensagem de WhatsApp e faz N+1 em movimentos

- **Onde:** `src/app/api/integracao/processos/by-phone/[telefone]/route.ts:66` · **Dimensão:** Performance · **Esforço:** medio

Endpoint chamado pelo ai-attendant a cada mensagem recebida (maxDuration=20). Faz três coisas custosas que pioram com a base migrada (1.861 clientes / 1.314 processos): (1) SELECT de TODOS os clientes do tenant (id,nome,telefone) sem filtro por telefone, porque o match é feito em JS com `.find((c) => mesmoTelefone(...))` — telefone não é criptografado (só cpf/rg em encryption.ts), então esse full scan é evitável; (2) depois roda `sincronizarProcessosDoClienteSeVelho`; (3) para CADA processo do cliente dispara uma query separada em processo_movimentos (N+1). Com a base crescendo, o passo (1) sozinho (todos os clientes trafegados a cada msg) tende a estourar o budget de 20s e o bot devolve nada.

```
const { data: clientes } = await admin.from('clientes').select('id, nome, telefone').eq('tenant_id', tenantId)...
const cliente = (clientes ?? []).find((c) => mesmoTelefone(c.telefone, alvo))
...
for (const p of processos) {
  const { data: movs } = await admin.from('processo_movimentos').select('nome, resumo_ia, data_hora').eq('processo_id', p.id).order('data_hora',...).limit(5)
```

**Recomendação:** (a) Guardar um telefone normalizado (só dígitos, sufixo) numa coluna indexada e filtrar no banco em vez de baixar todos os clientes e varrer em JS. (b) Trocar o loop de movimentos por 1 query: `.in('processo_id', ids)` ordenada por data_hora e agrupar em memória (o índice idx_movimentos_processo(processo_id,data_hora) já existe).

> **Nota do verificador:** Rebaixado para BAIXA (micro-otimizacao), com tres ressalvas verificadas no codigo:

1) O passo (1) NAO estoura 20s. Ler ~1.861 linhas de 3 colunas pequenas (id,nome,telefone) e da ordem de dezenas de ms. O real consumidor da janela de 20s e o passo (2) sincronizarProcessosDoClienteSeVelho, que chama o DataJud externo — mas isso e a arquitetura on-demand INTENCIONAL do dono (memory "arquitetura on-demand + VIPs com teto"), ja com budget curto (limit 20, ate 5 velhos, timeout 5s, 1 tentativa, Promise.all + .catch). Nao e defeito.

2) O N+1 (linhas 66-72) e real, porem cada query e range scan em idx_movimentos_processo(processo_id,data_hora) com limit(5) — milissegundos cada, sequenciais. Para o cliente tipico (0-2 processos) e irrelevante.

3) As duas recomendacoes sao mais frageis do que descritas:
   (a) mesmoTelefone/chaveTelefone faz match FUZZY (tolerancia ao 9o digito: compara ultimos 8 digitos + 2 primeiros). Um .eq() em coluna normalizada indexada NAO reproduz essa semantica; precisaria de esquema de chave-candidata, nao filtro simples. Esforco maior que "pequeno".
   (b) Um unico .in('processo_id', ids) ordenado por data_hora NAO expressa "top 5 por processo" no PostgREST. Agrupar em memoria exige puxar TODOS os movimentos de cada processo (um processo pesado tem centenas), podendo AUMENTAR o trafego vs. o limit(5) por processo de hoje. O "1 query" e enganoso.

Conclusao: padrao existe (evidencia nao fabricada), ha ganho marginal em lote de movimentos para clientes com muitos processos leves, mas a severidade media apoiada no cenario "devolve nada em 20s" nao se sustenta.</parameter>
</invoke>


### 13. Kanban de Tarefas puxa até 100 cards com embed de 7 relações e trunca em silêncio

- **Onde:** `src/app/api/tasks/route.ts:59` · **Dimensão:** Performance · **Esforço:** medio

KanbanBoard.tsx chama `fetch('/api/tasks?'+params)` sem passar `limit`, então o GET usa o default 100. Cada task vem com um SELECT aninhado de 7 relações (task_lists, atendimentos→clientes, cliente→clientes, processo→processos→clientes, users, task_tag_links→task_tags, task_assignees→users). Dois problemas: (1) payload/joins pesados por card; (2) como o Kanban mostra TODAS as colunas de uma vez e não pagina, um board com mais de 100 tarefas some cards silenciosamente conforme a base cresce.

```
.select(`id, description, ... task_lists(name), atendimentos(id, area, numero_processo, clientes(id, nome)), cliente:clientes!cliente_id(id, nome), processo:processos!processo_id(id, numero_cnj, apelido, clientes(id, nome)), users!tasks_assignee_id_fkey(id, nome), task_tag_links(tag_id, task_tags(id, name, color)), task_assignees(user_id, users(id, nome))`)
// default: limit = ... : 100  | KanbanBoard: const res = await fetch(`/api/tasks?${params}`)  // sem limit
```

**Recomendação:** Enxugar o embed para o que o card realmente mostra (nome do cliente/processo, responsáveis, tags) e, para o Kanban, ou paginar por coluna ou elevar/virtualizar o teto com aviso quando truncar, para não sumir cards à medida que a base de tarefas cresce.

> **Nota do verificador:** A correção é mais barata do que a recomendação sugere: a API JÁ retorna total (count exact) e JÁ aceita limit até 1000. Então o cliente pode (a) passar limit alto (ex.: 1000) no fetch do Kanban e (b) exibir um aviso de truncamento quando data.total > data.tasks.length — sem qualquer mudança na API para o aviso. Enxugar o embed para o que o TaskCard realmente mostra é um ganho de payload separado e opcional. Esforço geral: medio (o aviso + limit é pequeno; enxugar embed/virtualizar é o que puxa para medio).

### 14. Publicações (tela-carro-chefe) mostra "Nenhuma publicação" quando o carregamento FALHA — falso-vazio em intimações com prazo

- **Onde:** `src/components/publicacoes/CaixaPublicacoes.tsx:180` · **Dimensão:** UX/Consistência · **Esforço:** pequeno

Em `carregar()` os dados só são setados dentro de `if (r.ok)`; não há `else` nem `catch`. `dados` inicia `null` (sem seed de SSR). Se a API retornar 500 ou a rede cair, `loading` vira false e a renderização (linha 584) cai no ramo `itens.length === 0`, exibindo o estado vazio amigável "Nenhuma publicação na caixa". Um estagiário/advogado que abre a caixa do dia conclui que NÃO há intimações a tratar, quando na verdade a captura por OAB apenas falhou de carregar — risco operacional real numa tela que veicula prazos judiciais. Mesmo padrão em ProcessosCliente.tsx:127 (`if (r.ok) setProcessos(...)` sem else → lista fica vazia sem erro).

```
const r = await fetch(`/api/publicacoes?...`)
      if (r.ok) { const d: Resposta = await r.json(); setDados(d); ... }
    } finally { setLoading(false) }
// render:  ) : itens.length === 0 ? ( ... 'Nenhuma publicação na caixa' ...
```

**Recomendação:** Adicionar estado de erro dedicado (`setErro`) em `carregar()`: no `!r.ok`/`catch`, renderizar um bloco de ERRO com ícone e botão "Tentar novamente" (`onClick={carregar}`), distinto do estado vazio. Aplicar o mesmo em ProcessosCliente.carregar. Nunca deixar uma falha de rede se disfarçar de "nada para fazer".

> **Nota do verificador:** Duas ressalvas que não invalidam o achado, mas ajustam a evidência e a severidade: (1) A string citada 'Nenhuma publicação na caixa' (linha 588) só aparece no ramo `!temFiltro`; como `status` inicia 'nova' (linha 81), `temFiltro` é TRUE no load padrão, então numa falha na carga inicial o texto exibido é na verdade 'Nenhuma publicação encontrada / Ajuste os filtros…'. A string exata só é alcançada após `limpar()`. O problema de fundo (falha disfarçada de vazio, sem erro/retry) permanece em ambos os casos. (2) Existem mitigações parciais: os tiles/contadores vêm de endpoint separado (/api/publicacoes/saude); se só a lista falhar, os tiles ainda mostram contagens reais acima de uma lista vazia — contradição visível. O alerta de captura (linha 394) NÃO cobre este caso (dispara só em falha de captura DJEN, não em falha de carga da lista). O cenário de falso-vazio total (sessão expirada/outage) derruba ambos os endpoints e aí não há sinal algum.

### 15. Exclusões que falham em silêncio: usuário clica "Confirmar", spinner some, item continua na lista e nenhum aviso aparece

- **Onde:** `src/components/contratos/BotaoExcluirContrato.tsx:29` · **Dimensão:** UX/Consistência · **Esforço:** pequeno

Quatro fluxos de exclusão tratam só o caminho feliz: `if (res.ok) router.refresh()` sem `else`, e `catch { /* silently fail */ }`. Se o DELETE falhar (RLS, FK, 500, rede), o botão volta ao ícone de lixeira como se nada tivesse acontecido — o item segue lá e o usuário não faz ideia do porquê. Numa equipe não-técnica isso vira "cliquei em excluir e não some", com recliques e chamados. Atinge: BotaoExcluirContrato.tsx:29, BotaoExcluirPeca.tsx:25, BotaoExcluirAtendimento.tsx:25 e tarefas/TaskDetailModal.tsx:301 (handleDelete — e também handleComplete:288, ambos sem ramo de erro). Contrasta com ClienteAcoesClient/DocumentosDossie/EventoModal, que já mostram toast de erro.

```
const res = await fetch(`/api/contratos/${contratoId}`, { method: 'DELETE' })
  if (res.ok) { router.refresh() }
} catch {
  // silently fail
}
```

**Recomendação:** Injetar `useToast()` nos quatro componentes e, no `!res.ok`/`catch`, chamar `error('Não foi possível excluir', d.error ?? 'Tente novamente.')`. Padronizar com o tratamento já usado em ClienteAcoesClient (ler json de erro, exibir toast, manter o item).

> **Nota do verificador:** Duas correções de detalhe, sem invalidar o achado: (1) o caminho correto do atendimento é src/components/atendimento/BotaoExcluirAtendimento.tsx (o achado escreveu 'atendimentos/'); (2) a recomendação de 'injetar useToast() nos quatro componentes' só se aplica a três — TaskDetailModal.tsx JÁ importa e desestrutura o hook (linha 83: `const { success, error: toastError } = useToast()`) e já chama success no caminho feliz; ali basta adicionar o ramo de erro (`else`/`catch`) usando o `toastError` existente. Esforço: pequeno (< 1h).

### 16. Três padrões de confirmação de ação destrutiva convivendo — inclusive misturados dentro do MESMO módulo

- **Onde:** `src/components/publicacoes/CaixaPublicacoes.tsx:315` · **Dimensão:** UX/Consistência · **Esforço:** medio

As confirmações destrutivas do produto usam três estilos diferentes: (a) `ConfirmDialog` temático em 11 telas (ClienteAcoes, FinanceiroClient, EventoModal, SentinelaPanel, TaskDetailModal, etc.); (b) `window.confirm()` nativo do navegador em 9 telas (CaixaPublicacoes, PainelDetalhe, DocumentosDossie, AcoesAtendimento, PadroesDocumentos, EquipeClient...); (c) mini-confirmação inline "Sim/Não" nos BotaoExcluir*. O `confirm()` nativo é bloqueante, não segue o tema (fica branco/serifado no dark), e no MESMO módulo Publicações a caixa usa confirm() nativo enquanto o painel da Sentinela usa ConfirmDialog — inconsistência que o dono já pediu para padronizar em outro contexto (fontes de título).

```
if (!confirm('Concluir esta publicação? Ela será marcada como TRATADA e sai da fila de não tratadas.')) return  // CaixaPublicacoes
// vs SentinelaPanel.tsx → <ConfirmDialog ... />
```

**Recomendação:** Padronizar todas as confirmações destrutivas no `ConfirmDialog` já existente (temático, acessível, com estado `loading`). Substituir os 9 `window.confirm()` e, se possível, os BotaoExcluir* inline, por um único padrão. Ganho imediato de consistência e aparência profissional.

> **Nota do verificador:** Severidade media é adequada (melhora concreta de UX + manutenção; não é bug funcional nem risco de dados). Ressalva na recomendação: os `BotaoExcluir*` inline ("Sim/Não" dentro da linha da lista) são um padrão compacto provavelmente INTENCIONAL para caber em linhas de listagem sem overlay — converter esses três para modal pode piorar a UX naquele contexto e traz pouco ganho. O ganho real e barato está em substituir os ~9-10 `window.confirm()` nativos pelo `ConfirmDialog` já existente (temático, com `loading`), começando pelo módulo Publicações onde a inconsistência é mais visível ao lado do SentinelaPanel. Esforço: medio (cada substituição exige adicionar estado de open/target do dialog no componente; não é troca de 1 linha).

### 17. Contrato: PATCH que grava o conteúdo gerado por IA não é verificado — mostra "Contrato gerado!" mesmo se o salvamento falhou

- **Onde:** `src/app/(dashboard)/contratos/novo/ContratoFormClient.tsx:296` · **Dimensão:** UX/Consistência · **Esforço:** pequeno

Após gerar o texto (streaming de IA, caro em tokens), o código faz `await fetch(PATCH conteudo_markdown)` SEM checar `res.ok`, e em seguida dispara incondicionalmente `success('Contrato gerado!')` e `router.replace(/contratos/${id})`. Se o PATCH falhar (500/rede), o usuário recebe um "sucesso" falso e é levado ao editor de um contrato vazio — perdendo silenciosamente o conteúdo gerado. Numa peça contratual (documento jurídico), "gerou e sumiu o texto" é dor concreta e cara.

```
await fetch(`/api/contratos/${id}`, { method: 'PATCH', ...,
  body: JSON.stringify({ conteudo_markdown: conteudo }) })
success('Contrato gerado!', ...)
router.replace(`/contratos/${id}`)
```

**Recomendação:** Capturar a resposta do PATCH (`const rp = await fetch(...)`) e só emitir `success` + navegar quando `rp.ok`; caso contrário `toastError('Conteúdo não salvo', ...)` e manter o formulário para o usuário reaproveitar o texto (não descartar o conteúdo gerado).

> **Nota do verificador:** Severidade media está correta: há perda de trabalho/tokens e UX de 'sucesso' mentiroso, mas sem risco de segurança nem corrupção de dados persistidos (o contrato apenas nasce vazio e o texto é regerável). Precisão importante para o fix: uma falha de rede pura já cai no catch (toastError 'Falha de rede', sem navegar); o buraco real é exclusivamente as respostas de erro HTTP (500/400/404), que fetch não lança. A recomendação é válida — capturar a resposta (`const rp = await fetch(...)`), só emitir success + navegar quando `rp.ok`, e no caso contrário exibir toastError e MANTER o formulário/conteudoGerado para o usuário reaproveitar o texto (evitar re-gerar e gastar tokens de novo).

### 18. Lógica crítica de claim-e-envio do aviso de movimentação está duplicada (sync.ts ↔ djen.ts) e sem teste

- **Onde:** `src/lib/processos/sync.ts:238` · **Dimensão:** Débito técnico · **Esforço:** medio

O envio automático do aviso de movimentação ao cliente por WhatsApp é uma máquina de estados sensível a concorrência: claim atômico (UPDATE notif_status='aprovada' WHERE id=X AND notif_status='pendente' + .select('id'), pula se o claim vier vazio porque outro processo já pegou), envia, e em sucesso marca 'enviada'/logAudit, em falha marca 'erro'. Esse bloco existe DUAS vezes, quase idêntico: no caminho on-demand do DataJud (sync.ts) e no caminho do cron DJEN (djen.ts:736-760). Nenhum dos dois caminhos tem teste (djen.test.ts e processos.test.ts cobrem só as funções puras de parse/classificação/janela, não o envio). É a exata combinação que o dono pediu para caçar: 'claims de fila' + duplicação real entre módulos + lacuna de teste na lib que mais muda. Um bug/regra corrigida em um dos blocos e esquecida no outro faz o cliente receber aviso DUPLICADO ou NENHUM aviso — impacto direto voltado ao cliente final.

```
sync.ts:238 .update({ notif_status: 'aprovada' }).eq('id', r.id).eq('notif_status', 'pendente').select('id'); if (!claim || claim.length === 0) continue // outro processo já pegou — bloco idêntico em djen.ts:737-743
```

**Recomendação:** Extrair um único helper testável, ex. reivindicarEEnviarAviso(admin, movimento, telefone, { tenantId, procId, origem }), que encapsula claim → enviarAvisoWhatsApp → transição enviada/erro + logAudit, e chamá-lo dos dois pontos. Cobrir com testes de unidade (admin mockado) os três desfechos: claim perdido (não envia), envio ok (marca enviada), envio falho (marca erro).

> **Nota do verificador:** Severidade media está adequada (não é alta: ambos os blocos hoje são idênticos e corretos, sem bug ativo nem risco de segurança/perda de dados; é dívida de manutenção + lacuna de teste num caminho sensível a concorrência e voltado ao cliente). Reforço: existe um TERCEIRO trecho quase igual do rabo envio→'enviada'/'erro'→logAudit em sync.ts:431-447 (caminho 'simulado', movimento sintético SEM claim), então o helper recomendado deduplica ainda mais do que o achado afirmou. Ressalva para a extração ser segura: manter nos chamadores as diferenças de contexto — o guard por-item (djen: proc.cliente?.aviso_movimentacao) vs. o guard no topo do loop (sync: notif?.aviso), o check de `deadline` que só existe no djen, e o back-link em `publicacoes` do djen. Esforço: pequeno/medio (extrair reivindicarEEnviarAviso + 3 testes de unidade: claim perdido→não envia, envio ok→'enviada', envio falho→'erro').

### 19. Orquestrador de recebimento financeiro (processarAnexoRecebido) roteia dinheiro sem nenhum teste

- **Onde:** `src/lib/financeiro/recebimento.ts:303` · **Dimensão:** Débito técnico · **Esforço:** grande

processarAnexoRecebido (536 linhas no arquivo) é o núcleo que recebe comprovantes por WhatsApp e decide o destino: casa cliente por telefone entre todos os tenants, descarta em multi-tenant (evita vazamento cross-tenant), dedup por endToEndId e por mensagemId, filtra recebedor externo, sugere parcela e faz o CLAIM atômico da parcela (com tratamento de claim perdido → inbox e limpeza condicional do arquivo em storage). Todos os módulos VIZINHOS têm teste (parcelas, pix, comprovante, recebedor, duplicados, previsao, aviso), mas justamente este orquestrador — onde moram as decisões de roteamento de pagamento e as corridas de concorrência — tem ZERO teste. É o maior buraco de teste em código que movimenta dinheiro; uma regressão pode grudar o comprovante na parcela/cliente/tenant errado ou dar baixa indevida.

```
recebimento.ts:474 .update({ comprovante_recebido_em, comprovante_recebido_url, comprovante_recebido_dados }).eq('id', sugestao.id).eq('tenant_id', tenantId).eq('status','aberta').is('comprovante_recebido_em', null).select('id') — claim sem cobertura de teste; ramos b) multi-tenant, d) dedup e2e, l) claim perdido, todos sem teste
```

**Recomendação:** Adicionar recebimento.test.ts com um SupabaseClient fake (fila de respostas por tabela) cobrindo pelo menos: telefone sem cliente + tenant único; telefone multi-tenant (deve descartar sem inbox); dedup por mensagemId e por endToEndId; sugestão null → inbox; claim perdido → inbox + não remove arquivo referenciado. Priorizar por ser dinheiro e área de alta mudança.

> **Nota do verificador:** Severidade media está correta (não alta): a INVARIANTE DURA documentada na linha 9 é que a função NUNCA dá baixa — só stageia um comprovante_recebido para confirmação humana. Logo o 'dar baixa indevida' da descrição está superdimensionado; o pior caso real de regressão é grudar o comprovante na parcela/cliente errado, ou — mais crítico — mis-roteamento cross-tenant caso a guarda de multi-tenant (ramo e, linha 372) quebre, o que é a preocupação LGPD/segurança que justifica priorizar. Recomendação de teste é sólida e bem escopada: criar recebimento.test.ts com um SupabaseClient fake (fila de respostas por tabela) cobrindo prioritariamente (1) telefone multi-tenant → descarta sem inbox; (2) claim perdido → inbox + NÃO remove arquivo referenciado; (3) dedup por endToEndId; (4) sugestão null → inbox. Esforço: medio (o fake do SupabaseClient com encadeamento .from().eq().is().select() e storage é o que dá trabalho, não os casos em si).

### 20. Extração de texto de PDF/DOCX copiada em 5 rotas com limites de tamanho inconsistentes (uma sem limite)

- **Onde:** `src/app/api/ia/extrair-dados-cliente/route.ts:66` · **Dimensão:** Débito técnico · **Esforço:** medio

O mesmo bloco require('pdf-parse/lib/pdf-parse.js') as (...) => Promise<{text}> (com o workaround do bug conhecido do index.js do pdf-parse, pacote abandonado desde 2018) está copiado em 5 rotas: extrair-texto, atendimentos/[id]/documentos, ia/extrair-dados-cliente, modelos-documento, contratos/upload-modelo. Os tetos de tamanho divergem: 25MB, 50MB, 10MB, 10MB — e ia/extrair-dados-cliente NÃO tem teto algum antes de chamar pdf-parse, iterando sobre TODOS os documentos do caso com maxDuration=120. O próprio comentário em extrair-texto diz que o teto 'evita hang/exhaust no pdf-parse'. Em Vercel Hobby, um caso com muitos/grandes PDFs pode estourar tempo/memória da função. Além do risco, a lógica de fallback (pdf-parse → Claude Document) também está reimplementada por rota, então uma correção precisa ser replicada em N lugares.

```
extrair-dados-cliente/route.ts:67 await pdfParse(Buffer.from(arrayBuffer)) — sem checagem de .size (contraste: extrair-texto/route.ts:8 const MAX_FILE_SIZE = 25*1024*1024 e :19 if (file.size > MAX_FILE_SIZE))
```

**Recomendação:** Centralizar em src/lib/documentos/extrair-texto.ts uma função extrairTexto(buffer, mime, { maxBytes }) que aplica o teto, encapsula o require interno do pdf-parse e o fallback para Claude, e usá-la nas 5 rotas com um teto único. Adotar um teto explícito em extrair-dados-cliente.

> **Nota do verificador:** Ressalva sobre a recomendação: a lib-alvo sugerida JÁ EXISTE. src/lib/documentos/extrair-texto.ts:10 (extrairTextoDeArquivo) já encapsula o require do pdf-parse + fallback Claude + mammoth, e há uma segunda quase-duplicata em src/lib/extracao/ler-arquivo.ts:8. Só 2 rotas (documentos/[docId]/extrair e teses/extrair) as usam. Então o trabalho correto não é 'criar' a função, e sim: (1) adicionar um parâmetro maxBytes a essa lib existente e aplicar o teto único, (2) migrar as 5 rotas inline para ela, (3) consolidar as duas libs duplicadas em uma só, e (4) adotar teto explícito em extrair-dados-cliente (checar doc.tamanho_bytes/fileData.size antes do pdfParse, pulando docs acima do limite). Esforço pequeno-a-medio (< algumas horas). O ganho é real: teto uniforme + fallback único, elimina a única rota sem teto.

### 21. IA dos crons (resumos DataJud/DJEN/reparo) roda fora do logUsage e do verificarCota — custo invisível e sem teto

- **Onde:** `src/lib/processos/sync.ts:77` · **Dimensão:** Integrações · **Esforço:** pequeno

gerarResumos (sync.ts:65-95) e gerarResumosPublicacoes (djen.ts:336-363) chamam completionJSON no modelo Haiku direto, sem registrar em api_usage_log nem checar cota. reparo.ts:55 reusa gerarResumos, então três caminhos de cron (sync VIP, DJEN, reparo diário) gastam tokens Anthropic que NUNCA aparecem no painel de consumo (api/configuracoes/uso-ia) e não contam contra LIMITES_PLANO. O contraste é a rota interativa de sugestões (api/publicacoes/[id]/sugerir/route.ts:105) que faz logUsage corretamente. Num backfill (BACKFILL_DIAS=30, CHUNK 8/30, CAP 40 por tenant) o custo real do Haiku pode ser relevante e fica completamente fora do radar de custo/enforcement.

```
grep sync.ts/djen.ts: 'NENHUMA chamada de logUsage/verificarCota nos crons'. sync.ts:77 `const { result } = await completionJSON<{ resumos: string[] }>({ model: 'claude-haiku-4-5-20251001', maxTokens: 1500, ... })` — sem logUsage em volta.
```

**Recomendação:** Instrumentar as chamadas de resumo dos crons com safeLogUsage (endpoint tipo 'resumo_movimento'/'resumo_publicacao', tenantId conhecido no loop, userId sintético do sistema) para que o custo do Haiku em batch entre no painel. Cota por chamada em cron não faz sentido bloquear, mas o registro de custo/uso é essencial para visibilidade.

> **Nota do verificador:** Confirma com 3 ressalvas. (1) O ângulo de cota/enforcement é irrelevante — o próprio auditor concorda que cron não deve bloquear; o achado se reduz a VISIBILIDADE de custo. (2) "custo pode ser relevante" está exagerado: tenant piloto único + Haiku ($1/$5 por MTok) + CAP 40/tenant/execução dá centavos/dia; o valor real é CONSISTÊNCIA de observabilidade, com forte precedente no próprio código — logTranscricao (usage.ts:75-108) foi criado exatamente para fechar esse mesmo tipo de buraco para o Whisper ("antes a transcrição não entrava no painel de custo"). (3) Cuidado de implementação: api_usage_log.user_id é NOT NULL REFERENCES users(id) (migration 004), então "userId sintético do sistema" NÃO é plug-and-play — exige uma linha de usuário-sistema real ou migration tornando a coluna nullable, o que sobe o esforço de trivial para pequeno/médio. Gap é um pouco maior que o descrito: o caminho on-demand do bot (sincronizarProcessosDoClienteSeVelho, via rota by-phone) também roda gerarResumos sem logar.

### 22. Escopos Google amplos demais com domain-wide delegation: SA pode ler/alterar TODO o Drive e TODOS os calendários do usuário do Workspace

- **Onde:** `src/lib/calendar/api.ts:16` · **Dimensão:** Integrações · **Esforço:** medio

O espelho usa SCOPE_CALENDAR full 'https://www.googleapis.com/auth/calendar' (calendar/api.ts:16) e SCOPE full 'https://www.googleapis.com/auth/drive' (drive/auth.ts:11), sempre com domain-wide delegation impersonando o e-mail do usuário (montarJwtAssertion sub=impersonar). Na prática, a service account passa a poder LER, EDITAR e ENVIAR À LIXEIRA qualquer arquivo do Drive inteiro e qualquer evento de qualquer agenda de cada usuário do domínio Workspace — muito além da pasta raiz 'SIMAS' e do calendário secundário 'SIMAS' que o código realmente manipula. Se a SA_KEY vazar, o raio de dano é o Drive/Agenda completo de todos os usuários do escritório, não só o espelho.

```
calendar/api.ts:16 `const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar'`; drive/auth.ts:11 `const SCOPE = 'https://www.googleapis.com/auth/drive'` — combinados com montarJwtAssertion({ impersonar }).
```

**Recomendação:** Calendar é um ganho limpo de least-privilege: trocar por 'calendar.app.created' (gerencia só calendários secundários criados pelo app — exatamente o 'SIMAS'). No Drive, avaliar 'drive.file'; se o modelo de pasta-raiz-compartilhada-manualmente e o resgate por appProperties exigir escopo maior, ao menos documentar e isolar a credencial. Reautorizar os escopos no Admin Console.

> **Nota do verificador:** A recomendação do Calendar é o ganho limpo e acionável (esforço PEQUENO): trocar por 'https://www.googleapis.com/auth/calendar.app.created', que restringe a SA a calendários secundários criados pelo app — exatamente o 'SIMAS'. Verifiquei que garantirCalendarioSimas (api.ts:184-217) só lista/cria o calendário secundário e faz upsert/remove de eventos nele, então é compatível com esse escopo. Requer reautorizar o novo escopo na DWD do Admin Console; o código já classifica 'delegacao_pendente' (api.ts:130-131) e a UI mostra a instrução, então a migração degrada com elegância.\n\nJá o lado Drive: confirmei que 'drive.file' NÃO serve para o modelo atual, exatamente como o próprio achado pondera. Motivos vistos no código: (a) a pasta raiz é compartilhada MANUALMENTE com a SA (auth.ts:4-6, 47-50), não criada pelo app, e 'drive.file' não alcança arquivos que o app não criou; (b) o resgate buscarPorAppProperty (api.ts:104-120) faz busca GLOBAL no Drive com includeItemsFromAllDrives=true, que 'drive.file' não permite. Portanto, no Drive a ação é apenas: documentar a razão do escopo full e isolar/rotacionar a credencial (esforço MEDIO), sem trocar o escopo. Atenção operacional: qualquer mudança de escopo do Drive também exige atualizar o teste auth.test.ts:56, que hardcoda o escopo full atual.

### 23. Cliente Anthropic sem timeout/maxRetries e chamadas de IA sem AbortSignal — stall da IA mata o handler inteiro do cron

- **Onde:** `src/lib/anthropic/client.ts:11` · **Dimensão:** Integrações · **Esforço:** pequeno

O cliente é instanciado só com apiKey (`new Anthropic({ apiKey })`): sem timeout (default do SDK = 10 min) e sem maxRetries explícito (default 2, com backoff). completionJSON/completionText/streamCompletion também não aceitam AbortSignal, então os deadlines cooperativos do cron (checados só ENTRE chunks) não conseguem interromper uma chamada em andamento. Num pico de 'overloaded'/529 da Anthropic, um único chunk de resumo pode ficar dezenas de segundos em retry e, no pior caso, o handler do cron (maxDuration=300) é morto pela Vercel no meio — derrubando os drains de Drive e Calendar que rodariam DEPOIS (funil-consultas/route.ts:139-164), que ficam sem execução naquele dia.

```
client.ts:11 `_client = new Anthropic({ apiKey })` — nenhum `timeout`/`maxRetries`; nenhuma das funções (completionJSON, streamCompletion) recebe/propaga signal.
```

**Recomendação:** Instanciar `new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 })` e/ou propagar um AbortSignal derivado do deadline do cron para messages.create/stream, para que um stall da IA não consuma o orçamento de tempo compartilhado com os espelhos Drive/Calendar.

> **Nota do verificador:** Confirmo, com três ressalvas que mantêm a severidade em media (não alta): (1) o caso comum overloaded/529 retorna rápido com backoff curto — a alegação de 'dezenas de segundos em retry' é o pior caso; o risco realmente ilimitado é a conexão que aceita e não responde, que é justamente o que o `timeout` corta. (2) O impacto é recuperável: drive_sync_fila/calendar_sync_fila são filas duráveis, então pular um ciclo é drenado no próximo cron/botão — sem perda de dados; pular os drains por falta de tempo já é comportamento intencional (guard `> Date.now()+3_000`), o único desfecho ruim é o kill no meio. (3) O valor do fix vai além do cron: o timeout também blinda as ~25 rotas interativas que chamam o cliente (OCR, geração de peça/contrato), que hoje prenderiam o usuário até 10 min num socket pendurado. Esforço: pequeno — a parte de alto valor é 1 linha (`new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 })`); propagar AbortSignal derivado do deadline é opcional e mais trabalhoso.

### 24. DJEN sem circuit breaker entre OABs: bloqueio do WAF (403, já visto em produção) gasta o orçamento inteiro do cron em sleeps de backoff

- **Onde:** `src/lib/processos/djen.ts:292` · **Dimensão:** Integrações · **Esforço:** pequeno

consultarPorOab trata 403 do WAF como transitório e faz retry com backoff de 5s e 10s por página, por OAB (djen.ts:292-313). Existe retry/backoff, mas NÃO há breaker: quando o WAF do DJEN bloqueia o IP da Vercel (falha real documentada em 2026-07-10), CADA OAB do tenant repete o mesmo bloqueio, torrando ~15s de sleep por OAB dentro do deadline de 60s. Com poucas OABs o orçamento acaba só em espera, a marca d'água não avança (correto) mas nada é capturado e ainda dispara N e-mails de alerta (um por OAB). Um bloqueio é global (mesmo IP), então retentar OAB a OAB é desperdício previsível.

```
djen.ts:298 `const transitorio = res.status === 403 || res.status === 429 || res.status >= 500` seguido de `await sleep(5_000 * tentativa)` — sem short-circuit ao detectar bloqueio global do WAF.
```

**Recomendação:** Abrir um circuit breaker por rodada: ao receber 403 do WAF em uma OAB, marcar o tenant (ou a rodada) como bloqueado e PULAR as OABs restantes com 'parcial' (marca não avança, recobre amanhã) e um único alerta agregado, em vez de repetir o backoff e o e-mail por OAB.

> **Nota do verificador:** Ressalva importante que o achado subestima: o gatilho primário (WAF bloqueando o IP da Vercel, incidente 2026-07-10) JÁ é mitigado em produção pelo proxy da VPS — DJEN_BASE apontando para o Caddy `/djen/*` + `DJEN_PROXY_TOKEN` (djen.ts:39-43): as requisições saem de outro IP autenticado, então o 403 direto raramente recorre; o caminho de retry é fallback defensivo (proxy fora do ar/também bloqueado). Por isso é robustez/UX e não bug crítico: sem perda de dados, auto-recupera amanhã, e o desperdício é limitado a 60s dentro do maxDuration=300 do handler (as fases seguintes — drain, sentinela, reparo — usam deadline ancorado em t0, então ~240s ainda sobram). Severidade 'media' está adequada (não alta). Ganho real do breaker: economizar ~15s×(N-1) de sleep e trocar N e-mails por um único alerta agregado — que, ironicamente, é justo o sinal mais útil quando o proxy cai. Não consta em docs/BACKLOG.md. Esforço PEQUENO (<1h): ao receber 403 numa OAB, setar uma flag de rodada e marcar as OABs restantes como 'parcial' (marca não avança) + 1 alerta agregado, em vez de repetir backoff e e-mail por OAB.

### 25. Injeção de HTML em e-mail transacional pela rota pública /api/contato (escaparHtml existe e não é usado)

- **Onde:** `src/app/api/contato/route.ts:88` · **Dimensão:** Completude · **Esforço:** pequeno

A rota pública/anônima de contato interpola nome, email e telefone (entrada 100% controlada pelo atacante) diretamente no HTML do e-mail enviado à caixa do dono do escritório, sem escapar. O próprio módulo src/lib/email.ts define escaparHtml() e o aplica corretamente em TODAS as outras notificações (peça aprovada/rejeitada, menção em comentário) — aqui foi esquecido. Um bot/atacante pode injetar links de phishing, imagens de rastreamento ou HTML que falsifica a aparência do e-mail que a advogada recebe. Não há limite de tamanho (sem zod) nos campos, ampliando o abuso.

```
route.ts:88-90 => <td ...>${nome.trim()}</td> ... <td ...>${email.trim()}</td> ... <td ...>${telefone?.trim() || '—'}</td>  (dentro de emailTemplate, sem escaparHtml)
```

**Recomendação:** Importar escaparHtml de @/lib/email (ou exportá-lo) e envolver nome/email/telefone antes de interpolar; validar os campos com zod (formato + max length). Idealmente montar o corpo com valores já escapados.

> **Nota do verificador:** Manter severidade media. Correção: (1) exportar escaparHtml de @/lib/email (hoje é função privada); (2) envolver nome/email/telefone com escaparHtml antes de interpolar em route.ts:88-90; (3) validar os campos com zod (formato de e-mail + max length razoável, ex. 200 chars) já no início do POST. O insert no DB (l.65-69) usa Supabase parametrizado, então não há SQL injection — o problema é exclusivamente a montagem do HTML do e-mail.

### 26. Timestamps renderizados em UTC no servidor (formatarDataHora/formatarDataRelativa sem timeZone)

- **Onde:** `src/lib/utils.ts:62` · **Dimensão:** Completude · **Esforço:** pequeno

formatarDataHora e formatarDataRelativa chamam new Date(iso).toLocaleString('pt-BR', {...}) SEM timeZone: 'America/Sao_Paulo'. Em Server Components (ex.: a ficha do caso e a página do cliente, ambas sem 'use client'), a formatação roda no runtime da Vercel, que é UTC — então uma data/hora fica 3h adiantada e o DIA fica errado perto da meia-noite. Ex.: caso aberto 20/07 22:00 BRT (armazenado 2026-07-21T01:00Z) aparece como '21/07/2026 às 01:00'. Contrasta com o resto do código, que fixa 'America/Sao_Paulo' de propósito (lembretes-prazo:64, financeiro). Em sistema jurídico o 'quando' de um registro importa.

```
utils.ts:64-65 => const data = new Date(iso); return data.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })  // sem timeZone  |  usado em Server Component ficha/page.tsx:160 {formatarDataHora(at.created_at)} e :217 'Emitido em ...'
```

**Recomendação:** Passar timeZone: 'America/Sao_Paulo' (e locale 'pt-BR') em formatarDataHora e no fallback de formatarDataRelativa, garantindo exibição consistente independentemente de o render ocorrer no servidor (UTC) ou no cliente.

> **Nota do verificador:** A recomendação de mexer no "fallback de formatarDataRelativa" é imprecisa: o cálculo relativo usa diffs de getTime() (absolutos, imunes a fuso) e o fallback após 7 dias chama formatarData(iso), que faz split de string e não usa toLocaleString — passar timeZone ali não se aplica. A correção realmente necessária é apenas em formatarDataHora (linha 65). Opcionalmente, formatarData tem um desvio de dia próprio ao receber timestamptz (usa a porção UTC), mas é efeito desprezível e mecanismo distinto.

### 27. NEXTAUTH_URL sem guard: links de convite/reset/notificação silenciosamente apontam para localhost em produção

- **Onde:** `src/app/api/usuarios/convite/route.ts:70` · **Dimensão:** Completude · **Esforço:** pequeno

Os links de onboarding (convite), de definição de senha (reenviar-convite) e de deep-links de e-mail (email.ts urlBaseApp) usam process.env.NEXTAUTH_URL ?? 'http://localhost:3000'. Em env.ts NEXTAUTH_URL é .optional() e não há verificação no boot. Se a env não existir (ou for nomeada errado, ex.: só NEXT_PUBLIC_SITE_URL está setada), TODO o fluxo de convite e reset de senha gera links para http://localhost:3000 e os e-mails ficam inúteis — falha silenciosa e difícil de diagnosticar, exatamente no cadastro de novos membros do tenant.

```
convite:70 e reenviar-convite:76 => const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'  |  email.ts:77 => return process.env.NEXTAUTH_URL ?? 'http://localhost:3000'  |  env.ts:42 => NEXTAUTH_URL: z.string().optional()
```

**Recomendação:** Centralizar a base URL numa única função que, em produção (VERCEL_ENV/NODE_ENV==='production'), FALHA ruidosamente (throw/erro logado no boot) se NEXTAUTH_URL não estiver setada, em vez de cair para localhost. Alternativamente derivar de VERCEL_URL como fallback antes do localhost.

> **Nota do verificador:** Centralizar a base URL numa única função (ex.: consolidar em urlBaseApp de email.ts) e fazer convite/reenviar-convite importarem essa função em vez de repetir o literal. Nessa função, em produção (NODE_ENV==='production' e NEXT_PHASE!=='phase-production-build'), lançar/logar erro ruidoso se NEXTAUTH_URL estiver ausente, em vez de cair silenciosamente para localhost. Como next-auth não é usado, considerar renomear conceitualmente a var para algo como APP_BASE_URL (mantendo alias) para evitar confusão. Fallback via https://${VERCEL_URL} é possível, mas atenção: VERCEL_URL é o domínio efêmero do deploy e pode não bater com a allowlist de redirect do Supabase Auth (auth/callback) — por isso o throw ruidoso é a opção mais segura para o caso de convite/reset. Esforço pequeno (< 1h).

## 🟢 Severidade BAIXA

### 28. Lista de clientes decifra e devolve CPF/RG de todos os registros, mas a UI só precisa de um booleano

- **Onde:** `src/app/api/clientes/route.ts:62` · **Dimensão:** Dados/LGPD · **Esforço:** pequeno

O endpoint GET /api/clientes faz `.select('*')` (linha 46) e aplica `decryptClienteFields` em cada linha (linha 62), devolvendo CPF e RG em texto-plano de 20 clientes por página. Porém a tela de lista (src/app/(dashboard)/clientes/page.tsx:185) só usa `cliente.cpf` como teste de verdade para mostrar o selo 'PF' — o valor do CPF nunca é renderizado na lista (a exibição real com máscara só acontece no detalhe, clientes/[id]/page.tsx:257). Ou seja: dado sensível decifrado e trafegado no payload (visível no Network do navegador e no estado do cliente) sem necessidade, contrariando a minimização (LGPD art. 6º). A leitura é de equipe do mesmo tenant, por isso não é vazamento externo — é exposição/minimização indevida.

```
route.ts:46 `.select('*', { count: 'exact' })` + :62 `(data ?? []).map(decryptClienteFields)`; consumido em clientes/page.tsx:185 `{cliente.cpf && (<span ...>PF</span>)}` (só checa existência, não exibe o valor)
```

**Recomendação:** Na listagem, selecionar colunas explícitas e não decifrar cpf/rg: devolver um flag derivado (ex.: `temCpf: !!row.cpf` ou `tipo_pessoa`) em vez do valor. Manter a decifragem só no endpoint de detalhe /api/clientes/[id].

> **Nota do verificador:** A EVIDÊNCIA do achado está distorcida em dois pontos: (1) ela liga route.ts ao consumo em clientes/page.tsx:185, mas page.tsx NÃO consome /api/clientes — é um Server Component com query própria (linhas 52-68) e seu próprio decrypt; por ser server-side, o CPF decifrado na lista NUNCA chega ao navegador (só o selo booleano 'PF' vai no HTML). O cenário 'visível no Network' NÃO ocorre pela tela de lista. (2) A exposição real (não citada) é via os pickers typeahead client-side que fazem fetch em /api/clientes?q=. Severidade rebaixada de media para baixa porque: é staff autenticado do mesmo tenant (sem leak externo), NENHUMA fronteira de privilégio é cruzada (os mesmos usuários veem CPF/RG no detalhe de qualquer forma), e é higiene de payload / defesa-em-profundidade. Recomendação (válida, esforço pequeno): apontar os pickers para uma busca leve sem decifrar cpf/rg — já existe precedente do próprio dono em src/app/api/conversas/clientes/route.ts (.select('id, nome, telefone'), sem decrypt), cujo comentário reconhece que /api/clientes é 'pesada demais para o picker'. Não consta no docs/BACKLOG.md.

### 29. enviarEmail loga o assunto do e-mail, que frequentemente embute o nome de uma pessoa

- **Onde:** `src/lib/email.ts:101` · **Dimensão:** Dados/LGPD · **Esforço:** pequeno

Em src/lib/email.ts, `enviarEmail` loga o assunto em dois pontos: linha 87 `logger.warn('email.resend_ausente', { assunto: opts.assunto })` e linha 101 `logger.error('email.envio_falha', { assunto: opts.assunto }, err)`. O `redact()` do logger só mascara chaves como cpf/token/secret — 'assunto' passa direto. Vários assuntos embutem nome de pessoa, ex.: email.ts:167 `assunto: \`${n.nomeAutor} mencionou você em uma tarefa\`` e contato/route.ts:83 `\`Novo contato SIMAS — ${nome.trim()}\``. Assim, um nome próprio pode aterrissar nos logs sempre que um envio falha ou o Resend está desligado.

```
email.ts:101 `logger.error('email.envio_falha', { assunto: opts.assunto }, err)`; assunto de origem em email.ts:167 `\`${n.nomeAutor} mencionou você em uma tarefa\``
```

**Recomendação:** Não logar `assunto`. Logar um identificador estável do tipo de e-mail (ex.: { tipo: 'mencao_comentario' } ou um id de notificação) em vez do texto do assunto. Alternativamente, adicionar 'assunto' à lista de campos redigidos.

> **Nota do verificador:** Duas ressalvas ao achado original, sem invalidá-lo. (1) A evidência secundária está distorcida: contato/route.ts:83 (`Novo contato SIMAS — ${nome}`) é enviado por uma chamada DIRETA a resend.emails.send() dentro de contato/route.ts e NÃO passa por enviarEmail — logo nunca chega ao logger vulnerável. O único caminho real de vazamento é enviarEmailMencaoComentario (email.ts:167). A evidência primária (email.ts:167 + email.ts:101) é correta e sustenta o achado. (2) A exposição é estreita e de baixa sensibilidade — apenas o nome de um usuário interno (autor de comentário), só na trilha de @menção, só em warn/error — por isso mantenho severidade baixa (a nota original está correta), ainda que a regra #6 justifique corrigir. Correção recomendada (esforço pequeno, <1h): em vez de logar o texto do assunto, logar um identificador estável do tipo de e-mail (ex.: { tipo: 'mencao_comentario' }); OU, mais simples e abrangente, adicionar 'assunto' ao CAMPOS_SENSIVEIS em logger.ts para blindar qualquer chamador futuro que embuta PII no assunto.

### 30. WhatsApp pode ser entregue em duplicidade apesar do invariante "nunca 2x"

- **Onde:** `src/lib/processos/notificar.ts:62` · **Dimensão:** Corretude · **Esforço:** medio

enviarAvisoWhatsApp (canal único de TODO aviso ao cliente: movimentações automáticas em sync.ts/djen.ts, aprovação manual na fila e cobranças D-3/D-0 no cron) faz 1 retry a cada falha, inclusive o AbortError do timeout de 5s, e NÃO envia nenhuma chave de idempotência no corpo do POST /notify. Se o ai-attendant recebeu e já mandou a mensagem à Evolution mas o HTTP response demorou >5s, o ctrl.abort() dispara e a tentativa 2 reenvia o MESMO texto → o cliente recebe 2 mensagens idênticas. O mesmo timeout-como-falha faz enviarAvisoWhatsApp retornar {ok:false} mesmo tendo entregue: o chamador então marca 'erro' (route notificacoes) ou devolve 502 (route comunicar/lembretes), e o próximo retry humano/cron entrega de novo. O claim atômico no banco garante at-most-once da DECISÃO, não da ENTREGA.

```
for (let tentativa = 1; tentativa <= 2; tentativa++) { const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 5000); ... body: JSON.stringify({ telefone, texto, ...(instancia ? { instance: instancia } : {}) }), signal: ctrl.signal ... } catch (err) { ... logger.error('processos.notificar.excecao', { tentativa }, err) }
```

**Recomendação:** Passar uma chave de idempotência estável no body do /notify (ex.: movimento_id / parcela_id+janela) para o ai-attendant deduplicar a entrega; e NÃO retransmitir em AbortError/timeout (só em erro de conexão claro, onde é certo que nada saiu). Enquanto o VPS não honrar a chave, reduzir o retry a erros de rede pré-envio.

> **Nota do verificador:** Procede, mas com duas ressalvas que rebaixam para BAIXA e restringem a recomendação: (1) Parte é decisão intencional do dono — notificar.ts:90-91 mantém media SEM retry 'porque mídia duplicada é pior que pedir reenvio' e conscientemente MANTÉM o retry para texto (duplicata de texto é barata); e o cron lembretes:305-307 documenta que sabe que {ok:false} pode ter entregue e ESCOLHE não reenviar automaticamente ('preferimos NÃO reenviar (invariante nunca 2x)', reenvio só manual). Ou seja, o trade-off duplicata-vs-retry já foi ponderado pelo dono, e a afirmação do achado de que 'o cron entrega de novo' está incorreta (o cron não reenvia a mesma janela; D-3→D-2 e D-0→vencida não disparam). (2) A metade da recomendação que passa chave de idempotência no body só ajuda se o VPS/ai-attendant deduplicar, e o VPS é outro repositório (decisão 7) — fora de escopo. A melhoria acionável AQUI é estreita e não contraria o dono: não retransmitir em AbortError/timeout (só em erro de rede claro pré-envio), pois o timeout é exatamente a janela 'talvez já entregou'. Severidade baixa: exige corrida de timing (>5s após entrega real), dano mínimo (texto informativo duplicado, sem perda de dados/segurança) e o pior caso (mídia) já está mitigado; esforço pequeno (<1h).

### 31. Envio manual de cobrança (comunicar) não tem idempotência no servidor

- **Onde:** `src/app/api/financeiro/parcelas/[id]/comunicar/route.ts:118` · **Dimensão:** Corretude · **Esforço:** pequeno

O POST envia a cobrança direto por enviarAvisoWhatsApp sem nenhum claim/guarda de idempotência (diferente da rota de notificações de processo, que faz claim atômico). Um duplo-clique ou reenvio da request manda a sequência (aviso + Pix + chave) duas vezes ao cliente. Pior: em falha parcial devolve 502 orientando 'reenvie pelo botão', e o reenvio manda TODA a sequência de novo, incluindo o texto do aviso já entregue. Combinado com o timeout-como-falha do achado 1, o 502 pode acontecer mesmo com a 1ª mensagem já entregue.

```
const r = await enviarAvisoWhatsApp(ctx.cliente.telefone, parsed.data.texto)
  if (!r.ok) return jsonError('Falha ao enviar pelo WhatsApp — tente novamente', 502)
  for (const extra of ctx.mensagens.slice(1)) { const r2 = await enviarAvisoWhatsApp(...); if (!r2.ok) return jsonError('Aviso enviado, mas o Pix não foi — reenvie pelo botão', 502) }
```

**Recomendação:** Registrar um marcador de 'comunicado_em' (ou dedup por janela curta) para tornar o POST idempotente e distinguir 'aviso já saiu' de 'nada saiu' no reenvio; enviar as mensagens técnicas (Pix/chave) sem re-enviar o texto do aviso quando só elas faltaram.

> **Nota do verificador:** Duas ressalvas. (1) O vetor "duplo-clique" está superestimado: o front já guarda — ModalComunicar.tsx:67 tem `if (!parcela || enviando) return` e o botão usa `loading={enviando}` que em button.tsx:46 faz `disabled={disabled || loading}`, então um duplo-clique não dispara duas requests. O vetor real e desprotegido é o reenvio pós-502, que o próprio texto de erro instrui. (2) O envio manual é stateless por decisão do dono (route.ts:12-19: "NÃO consome os avisos automáticos"), então a parte mais valiosa e não-conflitante da recomendação é: no reenvio, mandar apenas as mensagens técnicas que faltaram (Pix/chave) sem re-mandar o texto do aviso — em vez de um marcador comunicado_em persistente que precisaria ser campo separado para não tocar o cron D-3/D-0. Esforço: pequeno (<1h). Não consta em docs/BACKLOG.md.

### 32. Claim do aviso de parcela não reconfere comprovante recém-enviado

- **Onde:** `src/app/api/cron/lembretes-prazo/route.ts:255` · **Dimensão:** Corretude · **Esforço:** pequeno

A busca de parcelas para D-3/D-0 filtra comprovante_recebido_em IS NULL (linha 204), mas o CLAIM atômico que precede o envio só reconfere status='aberta' e aviso_dX_em IS NULL — não reconfere comprovante_recebido_em. Entre o fetch (paginado, pode ir até o deadline) e o claim, o webhook processarAnexoRecebido pode fazer staging de um comprovante nessa mesma parcela; o claim não percebe e o cliente que ACABOU de enviar o comprovante recebe a cobrança automática. Janela curta (uma rodada do cron), mas é justamente o cenário 'cobrar quem já pagou', sensível ao dono.

```
.update({ [campo]: new Date().toISOString() }).eq('id', p.id).eq('status', 'aberta').is(campo, null).select('id') // sem .is('comprovante_recebido_em', null)
```

**Recomendação:** Acrescentar .is('comprovante_recebido_em', null) ao UPDATE do claim, fechando a janela entre o fetch e o envio da mesma forma que a busca já faz.

> **Nota do verificador:** Severidade baixa está adequada: probabilidade genuinamente baixa (cron diário; exige comprovante enviado exatamente na janela do cron para parcela D-0/D-3 de cliente com aviso_cobranca ligado). Mas a consequência (cobrar quem acabou de enviar comprovante) é o cenário sensível ao dono, e o fix é trivial e alinhado com a intenção já documentada no próprio código. Recomendação correta: acrescentar .is('comprovante_recebido_em', null) ao UPDATE do claim (linha 260), fechando a janela grande fetch→claim. Nota: ainda restaria uma janela mínima (comprovante chegando DEPOIS do claim, durante o envio) inerente e muito mais estreita — o fix não a elimina, mas fecha a janela relevante. Esforço pequeno (< 1h).

### 33. Lembretes de prazo: marca 'lembrete_enviado' em lote no fim e sem checar erro — kill da função reenviando tudo no dia seguinte

- **Onde:** `src/app/api/cron/lembretes-prazo/route.ts:96` · **Dimensão:** Resiliência · **Esforço:** pequeno

O laço envia os e-mails primeiro (acumulando idsLembrados) e só DEPOIS de todos executa um único UPDATE em lote de lembrete_enviado_em, cujo erro não é verificado. O laço de envio também não tem guarda de deadline (diferente do laço de parcelas, que respeita o deadline). Duas falhas: (1) se a função for morta entre o envio e o UPDATE final — janela ampliada pelo achado do maxDuration=60 acima —, os e-mails saíram mas nada é marcado, e no dia seguinte tudo é reenviado; (2) se o UPDATE falhar, ninguém fica sabendo e ocorre reenvio duplicado. São e-mails internos (equipe), então o impacto é incômodo, não perda de dado.

```
if (idsLembrados.length > 0) { await admin.from('tasks').update({ lembrete_enviado_em: new Date().toISOString() }).in('id', idsLembrados) }  // erro ignorado; marca só no fim
```

**Recomendação:** Marcar as tarefas de cada pessoa logo após o envio bem-sucedido dela (incremental, não em lote no fim), checar o error do UPDATE e logá-lo, e adicionar guarda de deadline no laço de e-mails como já existe no de parcelas.

> **Nota do verificador:** Confirmo com duas ressalvas que corrigem exageros do achado: (1) A ligação com o maxDuration=60 está distorcida. O UPDATE de marcação roda na linha 97, ANTES do vigia (108+) e do longo enviarAvisosParcelas (152). O processamento demorado de parcelas ocorre DEPOIS da marcação, logo NÃO amplia esta janela específica de kill entre envio e marca. Para o kill atingir entre um e-mail enviado e a marcação, teria que cair durante o próprio laço de e-mails — que, no tenant piloto único com equipe pequena, é rápido e pouco provável. (2) A recomendação de 'guarda de deadline no laço de e-mails' tem valor baixo pelo mesmo motivo: esse laço roda primeiro, com orçamento de tempo fresco, sobre poucos responsáveis. O ganho real e barato é: checar o error do UPDATE da linha 97 e logá-lo (só ids/contagens, LGPD), e opcionalmente marcar as tarefas de cada pessoa logo após o envio dela (incremental) em vez de em lote no fim, encurtando a janela. Arquivo: src/app/api/cron/lembretes-prazo/route.ts:96-98. Evidência real: `if (idsLembrados.length > 0) { await admin.from('tasks').update({ lembrete_enviado_em: new Date().toISOString() }).in('id', idsLembrados) }` — sem { error }.

### 34. /clientes faz full scan de TODOS os nomes a cada abertura só para montar o índice alfabético

- **Onde:** `src/app/(dashboard)/clientes/page.tsx:36` · **Dimensão:** Performance · **Esforço:** pequeno

Além da query paginada (limit 20, correta), a página carrega `select('nome')` de TODOS os clientes do tenant a cada render, sem paginação, apenas para calcular as letras iniciais disponíveis (letrasDisponiveis). Hoje são ~1.861 linhas por load; cresce linearmente com a base. Nome não é criptografado, então é um scan de string puro. Detalhe extra: essa query não filtra `deleted_at is null` (a paginada filtra), então nomes de clientes apagados ainda entram no índice de letras.

```
const { data: todosNomes } = await supabase.from('clientes').select('nome').eq('tenant_id', usuario.tenant_id).neq('status_cadastro', 'pre_cadastro')
const letrasDisponiveis = [...new Set((todosNomes ?? []).map(c => c.nome?.charAt(0).toUpperCase()).filter(Boolean))].sort()
```

**Recomendação:** Calcular as letras via agregação no banco (RPC `SELECT DISTINCT upper(left(nome,1))` com os mesmos filtros, incluindo deleted_at is null) ou materializar num pequeno cache/coluna. Evita trafegar milhares de nomes a cada visita de /clientes.

> **Nota do verificador:** Rebaixei de media para baixa. No cenário atual (tenant piloto único, ~1.861 nomes curtos em texto-plano) o custo é da ordem de dezenas de KB por load e um index scan trivial no Postgres — não há risco de quebra em produção hoje; é escalabilidade/polimento (custo O(n) na página mais visitada). A parte que realmente vale a pena e é barata (esforço pequeno, <1h) é adicionar `.is('deleted_at', null)` à query das letras para corrigir o índice mostrar letras de clientes apagados. A otimização recomendada (RPC com `SELECT DISTINCT upper(left(nome,1))` com os mesmos filtros) é um nice-to-have que só compensa conforme a base crescer para muitos milhares de clientes.

### 35. Índice duplicado em clientes(tenant_id, nome)

- **Onde:** `supabase/migrations/030_indices_performance.sql:18` · **Dimensão:** Performance · **Esforço:** pequeno

Existem dois índices idênticos sobre clientes(tenant_id, nome): idx_clientes_nome, criado em 002_clientes.sql, e idx_clientes_tenant_nome, criado em 030_indices_performance.sql. São a mesma definição de colunas na mesma ordem — o segundo é redundante e só adiciona custo de escrita/manutenção e espaço, sem ganho de leitura.

```
002_clientes.sql: CREATE INDEX idx_clientes_nome ON clientes(tenant_id, nome);
030_indices_performance.sql: CREATE INDEX IF NOT EXISTS idx_clientes_tenant_nome ON clientes (tenant_id, nome);
```

**Recomendação:** Dropar um dos dois (ex.: DROP INDEX IF EXISTS idx_clientes_tenant_nome) numa nova migration, mantendo apenas idx_clientes_nome.

> **Nota do verificador:** Nuance que reforça o achado: o comentário na linha 17 de 030 descreve "índice alfabético (LEFT(nome,1)) por tenant", mas o índice criado NÃO é um índice de expressão LEFT(nome,1) — é literalmente (tenant_id, nome), duplicando o idx_clientes_nome já existente. Ou seja, ou a intenção era um índice de prefixo que nunca foi materializado, ou é duplicado puro. Em ambos os casos, dropar idx_clientes_tenant_nome é correto. Impacto prático é mínimo (base-piloto zerada), por isso severidade baixa é adequada; esforço pequeno.

### 36. Dialog usa `id="dialog-title"` fixo — ao empilhar ConfirmDialog sobre um Dialog há dois IDs iguais e o leitor de tela anuncia o título errado

- **Onde:** `src/components/ui/dialog.tsx:56` · **Dimensão:** UX/Consistência · **Esforço:** pequeno

Todo `Dialog` renderiza `aria-labelledby="dialog-title"` apontando para um `<h2 id="dialog-title">` com id constante. Vários fluxos abrem um ConfirmDialog POR CIMA de um Dialog já aberto (EventoModal: modal do evento + confirmar exclusão; TaskDetailModal; FinanceiroClient; PainelAssinatura). Nesses momentos existem dois elementos com `id="dialog-title"` no DOM; `aria-labelledby` resolve para o PRIMEIRO, então o diálogo de confirmação é anunciado com o título do modal de trás. Quebra a rotulação para quem usa leitor de tela.

```
aria-labelledby="dialog-title"
...
<h2 id="dialog-title" className="text-xl font-semibold ...">{title}</h2>
```

**Recomendação:** Gerar um id único por instância com `React.useId()` e usá-lo tanto no `aria-labelledby` quanto no `id` do `<h2>`. Correção de poucas linhas no primitivo, corrige todas as telas de uma vez.

> **Nota do verificador:** Severidade baixa está correta: afeta só usuários de leitor de tela e apenas no instante em que dois diálogos coexistem; sem impacto em dados, segurança ou render visual. A recomendação está certa e barata (esforço pequeno): substituir o id fixo por React.useId() no primitivo dialog.tsx, usando-o tanto no aria-labelledby quanto no id do <h2>. Como Dialog é o primitivo compartilhado, a correção resolve todas as telas citadas (EventoModal, TaskDetailModal, FinanceiroClient, PainelAssinatura) de uma vez.

### 37. Código morto: 5 componentes + 1 módulo de lib sem nenhuma referência (~531 linhas)

- **Onde:** `src/components/atendimento/DocumentosDoCaso.tsx:1` · **Dimensão:** Débito técnico · **Esforço:** pequeno

Seis arquivos não são importados/renderizados em lugar nenhum do repo (varredura por nome de símbolo e por caminho, zero hits fora do próprio arquivo/seu teste): src/components/pecas/PainelLateral.tsx (79L), src/components/pecas/BotaoExportar.tsx (62L), src/components/clientes/DocumentoLink.tsx (48L), src/components/atendimento/ComandosRapidos.tsx (102L), src/components/atendimento/DocumentosDoCaso.tsx (185L) e src/lib/conversas/resolver-conversa.ts (55L). A maioria ficou órfã em refactors de Fev–Jun/2026. Chama atenção resolver-conversa.ts (tocado em 2026-07-15, ainda sem chamador): é um helper server-only 'pronto' que resolve a conversa aberta do Chatwoot por telefone — pode ser fiação esquecida de um recurso que silenciosamente não funciona, vale confirmar antes de apagar.

```
grep -rn nos nomes (PainelLateral, BotaoExportar, DocumentoLink, ComandosRapidos, DocumentosDoCaso, resolver-conversa) fora dos próprios arquivos retornou vazio; export async function resolverConversaPorTelefone em lib/conversas/resolver-conversa.ts nunca é importado
```

**Recomendação:** Apagar os 5 componentes órfãos. Para resolver-conversa.ts, confirmar com o dono se era pra estar ligado no fluxo de anexos do modal de WhatsApp; se não, remover também. Reduz superfície de manutenção e ruído em buscas.

> **Nota do verificador:** Uma ressalva do auditor é REFUTADA: a especulação de que resolver-conversa.ts seria 'fiação esquecida de um recurso que silenciosamente não funciona' está errada. O recurso de anexo no modal Enviar WhatsApp funciona por DESIGN — src/app/api/atendimentos/[id]/whatsapp/route.ts:16-20 documenta que tudo vai pelo canal do bot via enviarMediaWhatsApp (sendMedia), que 'funciona para QUALQUER número, inclusive cliente novo SEM conversa aberta no Chatwoot (decisão do dono após testar com número novo)'. Esse caminho nunca resolve conversa por telefone, então resolver-conversa.ts é código morto SUPERSEDIDO, não fiação faltante — pode ser apagado sem risco de quebrar recurso; a confirmação com o dono é cortesia, não obrigatória. Notas adicionais: (1) ComandosRapidos.tsx já é reconhecido como órfão nos próprios docs do projeto (PLANO-DESENVOLVIMENTO-OPUS.md:37 'está órfão — só manter compilando'; ANALISE-COMPLETA-2026-07.md:61 'sem montagem'), embora NÃO conste em docs/BACKLOG.md; (2) o auditor citou 'seu teste' para estes arquivos, mas na verdade NÃO existe nenhum arquivo de teste para os seis — pequeno exagero que não altera a conclusão.

### 38. Formatadores reimplementados em vários lugares (brl 3x, guarda de telefone 2x, R$ ad-hoc)

- **Onde:** `src/components/funil/DrawerLead.tsx:14` · **Dimensão:** Débito técnico · **Esforço:** pequeno

Há duplicação real de formatação. O formatador de moeda brl = new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}) está definido em 3 arquivos do funil (estilos.ts:74 exporta, mas DrawerLead.tsx:14 e MetricasFunil.tsx:18 redefinem localmente em vez de importar). A guarda 'só formata se 10/11 dígitos' em volta de formatarTelefone está copiada verbatim em AtendimentosClient.tsx:53 e CartaoContatoCliente.tsx:24. E a formatação de reais 'R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2})}' aparece solta em contratos/page.tsx, clientes/[id]/page.tsx, casos/[atendimentoId]/page.tsx e AtendimentosClient.tsx, enquanto o financeiro usa formatarValor(centavos) — dois vocabulários de moeda (reais vs centavos) sem um util reais compartilhado. Baixo risco, mas é atrito de manutenção e fonte de divergência sutil de formato.

```
const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v) — idêntico em DrawerLead.tsx:14, MetricasFunil.tsx:18 e estilos.ts:74; return d.length === 10 || d.length === 11 ? formatarTelefone(tel) : tel — idêntico em AtendimentosClient.tsx:53 e CartaoContatoCliente.tsx:24
```

**Recomendação:** Consolidar em src/lib/utils.ts: exportar formatarReais(v) (reais) ao lado do formatarValor(centavos) já existente, e uma exibirTelefone(tel) com a guarda 10/11. Fazer DrawerLead/MetricasFunil importarem o brl de estilos.ts (ou do utils). Remove ~5 cópias.

> **Nota do verificador:** Dois reparos de precisão que não refutam o achado, apenas o reforçam: (a) os caminhos citados no achado estão com pastas erradas — os arquivos reais são src/app/(dashboard)/atendimentos/AtendimentosClient.tsx e src/components/atendimento/CartaoContatoCliente.tsx (não em components/funil) —, mas o conteúdo bate exatamente; (b) o achado diz que clientes/[id]/page.tsx usa minimumFractionDigits:2, porém em clientes/[id]/page.tsx:502 o código é `R$ ${Number(contrato.valor_fixo).toLocaleString('pt-BR')}` SEM minimumFractionDigits — ou seja, mostra 'R$ 1.234' sem centavos, o que é uma divergência de formato concreta e comprova o ponto do achado sobre inconsistência sutil. Ressalva de escopo: parte das ocorrências de `R$ ...toLocaleString` está em src/lib/prompts/contratos/honorarios.ts e api/ia/gerar-contrato/route.ts, que montam texto de prompt para a IA / placeholders de contrato (não UI) — essas não são alvo da consolidação num util de exibição. Recomendação válida e de esforço pequeno: exportar formatarReais(v) em src/lib/utils.ts ao lado do formatarValor(centavos), criar exibirTelefone(tel) com a guarda 10/11 em utils, e fazer DrawerLead/MetricasFunil importarem o brl de estilos.ts; ao migrar, padronizar o caso de clientes/[id]/page.tsx:502 para exibir centavos.

### 39. Redação de logs é por allowlist e não cobre telefone/email/nome (LGPD, defesa em profundidade)

- **Onde:** `src/lib/logger.ts:11` · **Dimensão:** Débito técnico · **Esforço:** pequeno

O logger redige campos sensíveis por um conjunto FIXO de chaves (cpf, rg, token, senha, cpf_cnpj, etc.), mas telefone, email, nome, endereco e whatsapp NÃO estão na lista. Auditei todas as chamadas logger.* com essas chaves e hoje NÃO há vazamento — os logs carregam só ids/contagens/tenantId, disciplina que o dono exige. Porém, como a redação depende de a chave estar na allowlist, um futuro logger.info('evento', { telefone }) passaria dados pessoais em texto plano para o console/APM sem ninguém perceber. Dado que o telefone é justamente o identificador que liga cliente↔WhatsApp e é dado pessoal sob LGPD, adicioná-lo é blindagem barata na exata área que o dono marcou como valiosa.

```
logger.ts:11 const CAMPOS_SENSIVEIS = new Set(['cpf','rg','password','senha','token', ... ,'cpf_cnpj']) — sem 'telefone','email','nome','endereco','whatsapp'
```

**Recomendação:** Acrescentar 'telefone','email','e-mail','nome','endereco','whatsapp','numero_processo' ao CAMPOS_SENSIVEIS como rede de segurança (a prática de logar só ids continua sendo a regra). Custo ~1 linha; evita um vazamento LGPD acidental futuro.

> **Nota do verificador:** Aceitar apenas as chaves pessoais claras: 'telefone','email','e-mail','whatsapp','endereco'. Recusar 'numero_processo' da recomendação — número CNJ é dado PÚBLICO (registro processual público, não dado pessoal LGPD) e redigi-lo só atrapalha debug. Incluir 'nome' apenas com ressalva: é chave sobrecarregada que também aparece para nome de peça/tese/status/template/arquivo, então redação cega dela esconderia contexto não-pessoal útil. A regra de logar só ids/contagens continua sendo a prática principal; a allowlist expandida é só rede de segurança.

### 40. Contrato frágil do DataJud: hit com campo 'movimentos' ausente/renomeado é indistinguível de 'zero movimentos' → congelamento silencioso da timeline

- **Onde:** `src/lib/jurisprudencia/datajud.ts:273` · **Dimensão:** Integrações · **Esforço:** medio

buscarProcessoCompletoPorNumero faz `(src.movimentos as ...) ?? []` sem validar o shape. Se o CNJ renomear/reestruturar o campo 'movimentos' (ou 'assuntos'/'orgaoJulgador'), a consulta ainda retorna um hit válido, rawMovs vira [], o sync (sync.ts) trata como 'sucesso com 0 novos', seta ultima_sincronizacao e limpa sync_pendente. A UI (ProcessosCliente.tsx:346 'Sincronizado …' e o toast 'Sincronizado, 0 novas movimentações') afirma que está em dia enquanto os andamentos param de chegar sem qualquer erro/alerta. Diferente do DJEN (parseItemDjen aceita camelCase e snake_case nos campos críticos), o DataJud não tem essa defesa.

```
datajud.ts:273 `const rawMovs = (src.movimentos as Array<Record<string, unknown>>) ?? []` — hit presente sem a chave 'movimentos' colapsa em [] e é reportado como sync bem-sucedido.
```

**Recomendação:** Distinguir 'hit presente mas chave movimentos AUSENTE' (provável mudança de contrato → tratar como inconclusivo/null e disparar alerta Sentry/e-mail via alertas.ts) de 'movimentos: []' legítimo. Alertar também quando um processo que já tinha N movimentos volta com 0. Uma checagem barata de shape protege contra a quebra silenciosa.

> **Nota do verificador:** Rebaixo de media para baixa por três motivos que o achado ignora. (1) O gatilho é especulativo: exige o CNJ RENOMEAR/reestruturar um campo estável e documentado de uma API pública governamental mantendo o resto do hit íntegro — evento de baixa probabilidade. A falha REAL e comum do DataJud (5xx/429/timeout/es_rejected) já é tratada em fetchProcessoRaw: retorna null → 'inconclusivo' → NÃO limpa sync_pendente (fica na fila durável 059 p/ retry). (2) O impacto de maior gravidade alegado (prazo perdido) é mitigado: por decisão de arquitetura o DJEN é a fonte oficial/exclusiva de PUBLICAÇÕES/intimações (comentário em sentinela.ts) e roda independente do DataJud; um congelamento do DataJud pararia a timeline de andamentos e o aviso-de-movimentação WhatsApp dos VIPs, mas NÃO silenciaria as intimações que geram prazo. (3) A comparação com o DJEN está embelezada: parseItemDjen (djen.ts:166) não faz "camelCase e snake_case" genérico — só um fallback entre dois nomes documentados (numero_processo ?? numeroprocessocommascara); não é uma blindagem contra mudança de contrato. Recomendação com ressalva: a parte VALIOSA e barata é "alertar quando um processo que já tinha N movimentos volta com 0" (regressão), que pega tanto mudança de contrato quanto anomalia de índice e reaproveita alertarFalhaPublicacoes (alertas.ts, email+Sentry já prontos). Já a checagem "chave ausente → alerta" é mais frágil: um processo legítimo pode vir com movimentos:[] ou até sem a chave, gerando ruído no onboarding. Esforço pequeno (<1h).

### 41. Open redirect em /auth/callback via parâmetro next não validado

- **Onde:** `src/app/auth/callback/route.ts:16` · **Dimensão:** Completude · **Esforço:** pequeno

O callback de auth lê next da querystring e faz NextResponse.redirect(`${origin}${next}`) sem validar que next é um caminho relativo iniciando por '/'. Como é concatenação de strings, next='.evil.com' produz https://simas.app.evil.com (host controlado pelo atacante) e next='@evil.com'/'//x' abrem variações. O redirect só dispara após exchangeCodeForSession válido, o que reduz o alcance (o atacante precisa de um code válido, ex.: um reset da própria conta), mas combinado com o login que o code estabelece vira redirect pós-autenticação para domínio externo — vetor clássico de phishing.

```
callback/route.ts:9 => const next = searchParams.get('next') ?? '/definir-senha'  ...  :16 => return NextResponse.redirect(`${origin}${next}`)
```

**Recomendação:** Validar next antes de usar: aceitar apenas se começar com '/' e não com '//' (senão usar '/definir-senha'). Idealmente restringir a uma allowlist de rotas de destino.

> **Nota do verificador:** Validar `next` antes do redirect: aceitar somente caminho interno relativo. Ex.: `const next = searchParams.get('next') ?? '/definir-senha'; const dest = next.startsWith('/') && !next.startsWith('//') ? next : '/definir-senha'; return NextResponse.redirect(`${origin}${dest}`)`. Isso cobre @host, .host e //host. Idealmente restringir a uma allowlist de rotas de destino (hoje só /definir-senha). Corrigir também no texto do achado o exemplo `//x`, que não é explorável nesta concatenação.

### 42. Injeção no header Content-Disposition via título de documento na exportação DOCX

- **Onde:** `src/app/api/exportar-documento/route.ts:38` · **Dimensão:** Completude · **Esforço:** pequeno

titulo vem do corpo da requisição e é colocado no header Content-Disposition apenas trocando espaços por underscore — sem remover aspas/caracteres de controle. Um titulo contendo '"' quebra/altera o filename entregue (e caracteres de controle podem gerar header inválido). As rotas irmãs de exportação de contrato sanitizam com regex de allowlist (contratos exportar-docx:44 usa .replace(/[^a-zA-Z0-9\s_-]/g,'')), evidenciando a inconsistência. É autenticado (alvo é o próprio usuário), daí severidade baixa, mas é uma inconsistência de robustez fácil de corrigir.

```
exportar-documento:38 => const fileName = `${(titulo ?? 'documento').replace(/\s+/g, '_')}.docx`  ...  :43 => 'Content-Disposition': `attachment; filename="${fileName}"`
```

**Recomendação:** Sanitizar o título com a mesma allowlist das rotas de contrato (remover tudo fora de [a-zA-Z0-9 _-] e acentos) antes de compor o header, ou usar filename*=UTF-8'' com encodeURIComponent.

> **Nota do verificador:** Corrigir referência de linha da rota irmã: em src/app/api/contratos/[id]/exportar-docx/route.ts o replace de allowlist está na linha 45 (não 44) e o Content-Disposition na linha 50. Esforço: pequeno (< 1h). Recomendação: sanitizar titulo com .normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9\s_-]/g,'').trim() (ou allowlist com acentos como exportar-pdf:38) antes de compor o header, com fallback 'documento' quando resultar vazio; alternativamente usar filename*=UTF-8''${encodeURIComponent(...)} para preservar acentos.

---

## Achados refutados na verificação (não procedem)

- **SSRF: validação de URL de anexo apenas por protocolo, sem bloquear IPs privados/link-local (defesa em profundidade)** — A premissa central do achado está distorcida: o servidor SIMAS NÃO baixa o data_url do anexo. Em recebimento.
- **audit_log persiste nome do cliente e e-mail do convidado no metadata** — A evidência textual existe (clientes/[id]/route.ts:151 grava `metadata: { nome: cliente.
- **Cron funil-consultas orça 300s de trabalho, mas o plano Hobby mata a função aos 60s** — A premissa factual do achado — "no plano Hobby o teto de duração de função é 60s, então maxDuration=300 é silenciosamente reduzido" — está DESATUALIZADA. Em jun/2025 a Vercel elevou o teto do Hobby para 300s com o Fluid Compute (ligado por padrão em projetos novos).
- **Listagem de Publicações trafega o inteiro teor (HTML completo) de cada linha** — Achado refutado: a premissa central está distorcida. O GET /api/publicacoes NÃO serializa o HTML inteiro para o cliente.
- **Funil carrega todos os leads sem paginação, incluindo o texto da última mensagem** — O SELECT é citado corretamente (funil/page.tsx:21-31 traz ultima_mensagem sem limit), mas o miolo do achado está distorcido e a recomendação não traz ganho — na verdade pioraria a UX.
- **Resumo financeiro soma parcelas 'prevista' em memória sem recorte temporal** — O trecho de código citado é real (a query 'prevista' não tem filtro de data e a soma é feita em JS via reduce), mas a PREMISSA de performance do achado está distorcida pelo modelo de dados. A migration 065_parcelas_previsao.
