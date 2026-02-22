# Advogado Virtual — Arquitetura de Software & Plano de Execução por Fases

> **Objetivo deste documento:** Servir como especificação técnica completa para construção do sistema "Advogado Virtual" — um SaaS jurídico multiusuário para escritórios de advocacia. Este documento é estruturado para ser usado como prompt de referência no Claude Code.

---

## 1. VISÃO GERAL DO PRODUTO

### 1.1 O que é
SaaS jurídico que permite escritórios de advocacia realizar atendimentos, analisar documentos, gerar consultoria jurídica estruturada e produzir peças processuais com auxílio de IA (Claude/Anthropic API).

### 1.2 Áreas de atuação (v1)
- Previdenciário (prioridade máxima — MVP)
- Cível
- Trabalhista
- Criminal

### 1.3 Fluxo principal do usuário
```
Login → Selecionar Cliente/Criar Novo → Novo Atendimento → Gravar/Transcrever →
Anexar Documentos → Análise Jurídica (IA + extração) → Consultoria Estruturada →
"Cortar Caminho" (gerar peça) → Revisão/Validação → Exportar DOCX/PDF →
Salvar no Dossiê do Cliente
```

### 1.4 Princípios arquiteturais
- **Entregáveis rápidos:** MVP funcional na Fase 1 (4-6 semanas)
- **Escalonável:** Arquitetura preparada para multi-tenant desde o dia 1
- **Modular:** Cada capacidade é um módulo independente (auth, atendimento, análise, geração, etc.)
- **API-first:** Backend expõe REST API; frontend é SPA desacoplada
- **IA como serviço interno:** Chamadas à Anthropic API ficam no backend (nunca no browser)

---

## 2. ARQUITETURA TÉCNICA

### 2.1 Stack recomendada

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND (SPA)                    │
│           Next.js 14+ / React / Tailwind            │
│              shadcn/ui components                    │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS (REST + WebSocket)
┌──────────────────────▼──────────────────────────────┐
│                  API GATEWAY / BFF                   │
│              Next.js API Routes ou                   │
│           Node.js (Express/Fastify)                  │
│  ┌────────────┐ ┌──────────┐ ┌───────────────────┐  │
│  │ Auth Module │ │ Rate     │ │ Tenant Middleware  │  │
│  │ (NextAuth/  │ │ Limiter  │ │ (isolamento por   │  │
│  │  Clerk)     │ │          │ │  escritório)       │  │
│  └────────────┘ └──────────┘ └───────────────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                 CAMADA DE SERVIÇOS                   │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Atendimento  │  │  Análise     │  │ Geração   │  │
│  │ Service      │  │  Service     │  │ Service   │  │
│  └──────────────┘  └──────────────┘  └───────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Documento    │  │ Transcrição  │  │ Exportação│  │
│  │ Service      │  │  Service     │  │ Service   │  │
│  └──────────────┘  └──────────────┘  └───────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                  INFRAESTRUTURA                      │
│                                                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │PostgreSQL│  │ Object Store │  │ Redis (cache  │  │
│  │ (Supabase│  │ (S3/Supabase │  │  + filas)     │  │
│  │  ou RDS) │  │  Storage)    │  │               │  │
│  └──────────┘  └──────────────┘  └───────────────┘  │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │         Anthropic API (Claude)               │    │
│  │    Chave gerenciada no servidor (Modelo B)   │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │   Whisper API / Deepgram (transcrição)       │    │
│  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### 2.2 Modelo de dados principal (schema conceitual)

```
Tenant (escritório)
├── id, nome, cnpj, plano, status, created_at
│
├── User (usuários do escritório)
│   ├── id, tenant_id, nome, email, senha_hash, role (admin|advogado|revisor|estagiario)
│   └── status, last_login, created_at
│
├── Cliente (pasta/dossiê)
│   ├── id, tenant_id, nome, cpf_encrypted, contato, notas
│   └── created_by, created_at
│
├── Atendimento
│   ├── id, tenant_id, cliente_id, user_id, area (previdenciario|civel|trabalhista|criminal)
│   ├── audio_url (nullable), transcricao_raw, transcricao_editada
│   ├── pedidos_especificos, status (rascunho|analisado|finalizado)
│   └── metadados_extraidos (JSONB), created_at, updated_at
│
├── Documento
│   ├── id, atendimento_id, tenant_id, tipo (cnis|indeferimento|cessacao|laudo|procuracao|outro)
│   ├── file_url, file_name, mime_type
│   ├── dados_extraidos (JSONB), confirmado_por_usuario (boolean)
│   └── created_at
│
├── Analise (consultoria jurídica gerada)
│   ├── id, atendimento_id, tenant_id
│   ├── resumo_fatos, plano_a, plano_b, riscos, checklist_docs, perguntas_faltantes
│   ├── fontes_utilizadas (JSONB), status (gerada|revisada|aprovada)
│   └── created_by, created_at
│
├── Peca (peça processual gerada)
│   ├── id, analise_id, atendimento_id, tenant_id
│   ├── tipo (peticao_inicial|contestacao|replica|apelacao|agravo|embargos|tutela|cumprimento)
│   ├── conteudo_markdown, conteudo_html
│   ├── versao (int), status (rascunho|revisada|aprovada|exportada)
│   ├── validacao_coerencia (JSONB), validacao_fontes (JSONB)
│   └── created_by, created_at
│
└── Exportacao
    ├── id, peca_id, tenant_id, formato (docx|pdf|txt)
    ├── file_url, versao_snapshot
    └── exported_by, created_at
```

### 2.3 Decisão de chave da API (Modelo B — recomendado)

```
Modelo adotado: Chave centralizada no servidor (Modelo B)

Razões:
- Cliente não precisa ter conta na Anthropic
- Controle total de uso, custos e limites por tenant
- Auditoria centralizada de todos os prompts/respostas
- Mais simples para o usuário final

Implementação:
- Chave da Anthropic armazenada em variável de ambiente no servidor
- Cada chamada registra: tenant_id, user_id, tokens_in, tokens_out, custo_estimado
- Rate limiting por tenant (ex: 100 chamadas/hora no plano básico)
- Tabela: api_usage_log (tenant_id, user_id, endpoint, tokens, cost, created_at)
```

---

## 3. FASES DE ENTREGA

---

### FASE 1 — MVP FUNCIONAL (Semanas 1-6)

> **Objetivo:** Sistema funcional que um escritório pode usar para atender cliente, transcrever, anexar documentos, gerar análise por IA e produzir peça processual. Foco: área Previdenciária.

#### 3.1.1 Escopo da Fase 1

```
[x] Auth básico (login/registro, 1 tenant fixo, roles: admin + advogado)
[x] CRUD de Clientes (nome, CPF, contato, notas)
[x] Novo Atendimento com:
    - Seleção de área (Previdenciário fixo no MVP)
    - Gravação de áudio no browser (MediaRecorder API)
    - Transcrição via Whisper API (server-side)
    - Campo de edição da transcrição
    - Campo "Pedidos / solicitação específica"
    - Upload de documentos (PDF/imagem, até 5 por atendimento)
[x] Análise por IA:
    - Prompt estruturado que recebe: transcrição + pedidos + documentos (como texto/OCR)
    - Retorna: resumo dos fatos, tese principal, riscos, checklist, sugestão de peça
    - Exibição em cards organizados
[x] Geração de peça (1 tipo: Petição Inicial Previdenciária):
    - Botão "Gerar Petição Inicial baseada na análise"
    - Prompt que recebe dossiê estruturado e gera peça completa
    - Exibição com editor simples (textarea com markdown)
[x] Exportação: Download como .docx (usando docx-js no backend)
[x] Histórico: lista de atendimentos e peças do cliente
[x] Deploy: Vercel (frontend) + Supabase (DB + Storage + Auth)
```

#### 3.1.2 Estrutura de diretórios (Next.js App Router)

```
advogado-virtual/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── registro/page.tsx
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx                  # Sidebar + header com tenant/user
│   │   │   ├── page.tsx                    # Dashboard home
│   │   │   ├── clientes/
│   │   │   │   ├── page.tsx                # Lista de clientes
│   │   │   │   ├── novo/page.tsx           # Criar cliente
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx            # Dossiê do cliente
│   │   │   │       └── atendimentos/
│   │   │   │           ├── novo/page.tsx   # Novo atendimento (fluxo principal)
│   │   │   │           └── [atendId]/
│   │   │   │               ├── page.tsx    # Detalhes do atendimento
│   │   │   │               ├── analise/page.tsx    # Análise gerada
│   │   │   │               └── pecas/
│   │   │   │                   ├── nova/page.tsx   # Gerar peça
│   │   │   │                   └── [pecaId]/page.tsx # Visualizar/editar peça
│   │   │   ├── historico/page.tsx          # Histórico geral
│   │   │   └── configuracoes/page.tsx      # Config do escritório
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── clientes/route.ts
│   │       ├── atendimentos/route.ts
│   │       ├── documentos/
│   │       │   ├── upload/route.ts
│   │       │   └── ocr/route.ts
│   │       ├── transcricao/route.ts        # Recebe áudio, retorna texto
│   │       ├── analise/route.ts            # Chama Claude para análise
│   │       ├── pecas/
│   │       │   ├── gerar/route.ts          # Chama Claude para gerar peça
│   │       │   └── exportar/route.ts       # Gera .docx
│   │       └── ai/
│   │           └── usage/route.ts          # Log de uso da API
│   ├── lib/
│   │   ├── db.ts                           # Cliente Supabase
│   │   ├── anthropic.ts                    # Cliente Anthropic (singleton)
│   │   ├── prompts/
│   │   │   ├── analise-previdenciario.ts   # Prompt de análise
│   │   │   ├── peticao-inicial-prev.ts     # Prompt de petição
│   │   │   └── utils.ts                    # Helpers de prompt
│   │   ├── ocr.ts                          # Extração de texto de PDFs
│   │   ├── transcricao.ts                  # Integração Whisper
│   │   └── exportar-docx.ts               # Geração de .docx
│   ├── components/
│   │   ├── ui/                             # shadcn/ui components
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── TenantProvider.tsx
│   │   ├── atendimento/
│   │   │   ├── GravadorAudio.tsx
│   │   │   ├── EditorTranscricao.tsx
│   │   │   ├── UploadDocumentos.tsx
│   │   │   └── FormAtendimento.tsx
│   │   ├── analise/
│   │   │   ├── CardAnalise.tsx
│   │   │   ├── ResumoFatos.tsx
│   │   │   ├── Riscos.tsx
│   │   │   └── AcoesRapidas.tsx            # Botões "Cortar Caminho"
│   │   └── pecas/
│   │       ├── EditorPeca.tsx
│   │       ├── PreviewPeca.tsx
│   │       └── BotaoExportar.tsx
│   ├── types/
│   │   └── index.ts                        # Tipos TypeScript centrais
│   └── middleware.ts                       # Auth + tenant guard
├── supabase/
│   └── migrations/
│       ├── 001_tenants_users.sql
│       ├── 002_clientes.sql
│       ├── 003_atendimentos_documentos.sql
│       ├── 004_analises_pecas.sql
│       └── 005_rls_policies.sql            # Row Level Security por tenant
├── .env.local
├── package.json
└── tsconfig.json
```

#### 3.1.3 Migrations SQL — Fase 1

```sql
-- 001_tenants_users.sql

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cnpj TEXT,
  plano TEXT DEFAULT 'trial', -- trial | basico | profissional
  status TEXT DEFAULT 'ativo', -- ativo | suspenso | cancelado
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'advogado', -- admin | advogado | revisor | estagiario
  status TEXT DEFAULT 'ativo',
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);

-- 002_clientes.sql

CREATE TABLE clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  nome TEXT NOT NULL,
  cpf TEXT, -- será criptografado na aplicação
  telefone TEXT,
  email TEXT,
  endereco TEXT,
  notas TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_clientes_tenant ON clientes(tenant_id);
CREATE INDEX idx_clientes_nome ON clientes(tenant_id, nome);

-- 003_atendimentos_documentos.sql

CREATE TABLE atendimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  cliente_id UUID NOT NULL REFERENCES clientes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  area TEXT NOT NULL DEFAULT 'previdenciario',
  -- Transcrição
  audio_url TEXT,
  transcricao_raw TEXT,
  transcricao_editada TEXT,
  -- Pedidos
  pedidos_especificos TEXT,
  -- Metadados extraídos pela IA
  metadados_extraidos JSONB DEFAULT '{}',
  -- Status
  status TEXT DEFAULT 'rascunho', -- rascunho | analisado | finalizado
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_atendimentos_tenant ON atendimentos(tenant_id);
CREATE INDEX idx_atendimentos_cliente ON atendimentos(cliente_id);

CREATE TABLE documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atendimento_id UUID NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  tipo TEXT DEFAULT 'outro', -- cnis | indeferimento | cessacao | laudo | procuracao | carta_concessao | outro
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  tamanho_bytes BIGINT,
  -- Dados extraídos por OCR + IA
  texto_extraido TEXT,
  dados_extraidos JSONB DEFAULT '{}',
  confirmado_por_usuario BOOLEAN DEFAULT false,
  confirmado_por UUID REFERENCES users(id),
  confirmado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_documentos_atendimento ON documentos(atendimento_id);

-- 004_analises_pecas.sql

CREATE TABLE analises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atendimento_id UUID NOT NULL REFERENCES atendimentos(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  -- Conteúdo da análise
  resumo_fatos TEXT,
  tese_principal TEXT,
  plano_a JSONB, -- { titulo, descricao, fundamento, probabilidade }
  plano_b JSONB,
  riscos JSONB, -- [{ tipo, descricao, severidade }]
  checklist_documentos JSONB, -- [{ documento, status, observacao }]
  perguntas_faltantes JSONB, -- [{ pergunta, motivo }]
  acoes_sugeridas JSONB, -- [{ tipo_peca, label, descricao }]
  -- Rastreabilidade
  fontes_utilizadas JSONB DEFAULT '{}',
  prompt_utilizado TEXT,
  modelo_ia TEXT,
  tokens_utilizados JSONB, -- { input, output, custo_estimado }
  -- Status
  status TEXT DEFAULT 'gerada', -- gerada | revisada | aprovada
  revisada_por UUID REFERENCES users(id),
  revisada_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_analises_atendimento ON analises(atendimento_id);

CREATE TABLE pecas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analise_id UUID REFERENCES analises(id),
  atendimento_id UUID NOT NULL REFERENCES atendimentos(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  -- Tipo
  tipo TEXT NOT NULL, -- peticao_inicial | contestacao | replica | apelacao | agravo | embargos | tutela | cumprimento
  area TEXT NOT NULL DEFAULT 'previdenciario',
  -- Conteúdo
  conteudo_markdown TEXT,
  conteudo_html TEXT,
  -- Validação
  validacao_coerencia JSONB, -- { aprovado, problemas: [] }
  validacao_fontes JSONB,    -- { citacoes_verificadas, citacoes_nao_verificadas }
  -- Versionamento
  versao INT DEFAULT 1,
  status TEXT DEFAULT 'rascunho', -- rascunho | revisada | aprovada | exportada
  -- Rastreabilidade
  prompt_utilizado TEXT,
  modelo_ia TEXT,
  tokens_utilizados JSONB,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pecas_atendimento ON pecas(atendimento_id);

CREATE TABLE pecas_versoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id UUID NOT NULL REFERENCES pecas(id) ON DELETE CASCADE,
  versao INT NOT NULL,
  conteudo_markdown TEXT,
  alterado_por UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE exportacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id UUID NOT NULL REFERENCES pecas(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  formato TEXT NOT NULL DEFAULT 'docx', -- docx | pdf | txt
  file_url TEXT NOT NULL,
  versao_snapshot INT,
  exported_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 005_rls_policies.sql (Row Level Security)

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE atendimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE analises ENABLE ROW LEVEL SECURITY;
ALTER TABLE pecas ENABLE ROW LEVEL SECURITY;
ALTER TABLE exportacoes ENABLE ROW LEVEL SECURITY;

-- Política base: cada tabela só retorna registros do tenant do usuário
-- (implementar via function que extrai tenant_id do JWT)

CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID;
$$ LANGUAGE sql SECURITY DEFINER;

-- Exemplo para clientes (replicar para cada tabela):
CREATE POLICY tenant_isolation ON clientes
  USING (tenant_id = current_tenant_id());

-- 006_api_usage_log.sql

CREATE TABLE api_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL, -- analise | geracao_peca | transcricao
  modelo TEXT,
  tokens_input INT,
  tokens_output INT,
  custo_estimado DECIMAL(10,6),
  latencia_ms INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_api_usage_tenant ON api_usage_log(tenant_id, created_at);
```

#### 3.1.4 Prompts de IA — Fase 1

```typescript
// src/lib/prompts/analise-previdenciario.ts

export function buildPromptAnalise(dados: {
  transcricao: string;
  pedidos: string;
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>;
}): string {
  return `
Você é um analista jurídico especializado em Direito Previdenciário brasileiro.

## TAREFA
Analise os dados do atendimento abaixo e produza uma consultoria jurídica estruturada.

## DADOS DO ATENDIMENTO

### Transcrição do atendimento:
${dados.transcricao}

### Pedidos/solicitação específica do advogado:
${dados.pedidos || "Nenhum pedido específico informado."}

### Documentos anexados:
${dados.documentos.map((d, i) => `
--- DOCUMENTO ${i + 1}: ${d.file_name} (Tipo: ${d.tipo}) ---
${d.texto_extraido}
`).join('\n')}

## INSTRUÇÕES DE ANÁLISE

1. **Extraia e liste** todos os dados objetivos encontrados:
   - Datas: DER, DCB/cessação, DIB, admissões, demissões
   - Números: NB, NIT/PIS, CPF, valores (RMI, salários)
   - Vínculos empregatícios e períodos contributivos
   - CIDs e diagnósticos (se houver laudos)
   - Motivos de indeferimento/cessação (se houver)

2. **Resumo dos fatos** (narrativa objetiva, 3-5 parágrafos)

3. **Tese principal** recomendada com fundamentação legal

4. **Plano A e Plano B** de ação:
   Para cada plano, informe: título, descrição, fundamento legal, probabilidade estimada de êxito (alta/média/baixa), e pré-requisitos

5. **Riscos identificados:**
   - Qualidade de segurado / perda de qualidade
   - Carência insuficiente
   - Decadência ou prescrição
   - Prova fraca / necessidade de perícia
   - Outros riscos específicos

6. **Checklist de documentos:**
   - Documentos já fornecidos (e se estão completos)
   - Documentos faltantes necessários

7. **Perguntas faltantes** que o advogado deve fazer ao cliente

8. **Ações sugeridas** (lista de peças/ações possíveis):
   Para cada ação, indique o tipo de peça processual

## FORMATO DE RESPOSTA
Responda EXCLUSIVAMENTE em JSON válido com esta estrutura:
{
  "dados_extraidos": { ... },
  "resumo_fatos": "...",
  "tese_principal": "...",
  "plano_a": { "titulo": "...", "descricao": "...", "fundamento": "...", "probabilidade": "alta|media|baixa", "pre_requisitos": "..." },
  "plano_b": { "titulo": "...", "descricao": "...", "fundamento": "...", "probabilidade": "alta|media|baixa", "pre_requisitos": "..." },
  "riscos": [{ "tipo": "...", "descricao": "...", "severidade": "alta|media|baixa" }],
  "checklist_documentos": [{ "documento": "...", "status": "fornecido|incompleto|faltante", "observacao": "..." }],
  "perguntas_faltantes": [{ "pergunta": "...", "motivo": "..." }],
  "acoes_sugeridas": [{ "tipo_peca": "peticao_inicial|tutela|recurso|...", "label": "...", "descricao": "..." }]
}

IMPORTANTE:
- Cite APENAS legislação e jurisprudência que você tem CERTEZA que existem
- Quando não tiver certeza de uma referência, indique como "verificar"
- Não invente números de processos, súmulas ou artigos
- Toda informação deve ser rastreável à transcrição ou aos documentos
`.trim();
}
```

```typescript
// src/lib/prompts/peticao-inicial-prev.ts

export function buildPromptPeticaoInicial(dados: {
  analise: AnaliseCompleta;
  atendimento: AtendimentoComDocumentos;
  tipo_acao: string;
}): string {
  return `
Você é um advogado previdenciarista experiente redigindo uma petição inicial.

## DADOS DO CASO (já analisados e confirmados)
${JSON.stringify(dados.analise, null, 2)}

## TRANSCRIÇÃO ORIGINAL
${dados.atendimento.transcricao_editada || dados.atendimento.transcricao_raw}

## DOCUMENTOS DISPONÍVEIS
${dados.atendimento.documentos.map(d =>
  \`- \${d.file_name} (Tipo: \${d.tipo}): \${JSON.stringify(d.dados_extraidos)}\`
).join('\\n')}

## TIPO DE AÇÃO
${dados.tipo_acao}

## INSTRUÇÕES DE REDAÇÃO

Redija uma PETIÇÃO INICIAL completa seguindo este formato:

1. **Endereçamento** (Vara Federal / JEF conforme valor da causa)
2. **Qualificação das partes** (Autor e INSS)
3. **Dos Fatos** (narrativa baseada EXCLUSIVAMENTE nos dados extraídos)
4. **Do Direito** (fundamentação legal com artigos específicos)
5. **Da Tutela de Urgência** (se aplicável, conforme análise de riscos)
6. **Dos Pedidos** (lista numerada, específica)
7. **Do Valor da Causa**
8. **Fechamento** (local, data, assinatura)

## REGRAS OBRIGATÓRIAS
- Use APENAS os fatos e dados que constam na análise e nos documentos
- Cite artigos de lei com precisão (Lei 8.213/91, Decreto 3.048/99, CPC, CF)
- NÃO invente jurisprudência — use apenas referências que você tem CERTEZA
- Marque com [VERIFICAR] qualquer referência sobre a qual não tenha certeza absoluta
- Marque com [PREENCHER] campos que dependem de dados faltantes
- Use linguagem técnica jurídica formal
- Mantenha parágrafos concisos e objetivos

Responda com a petição completa em Markdown.
`.trim();
}
```

#### 3.1.5 Telas do MVP (wireframe textual)

```
TELA 1: Login
┌─────────────────────────────┐
│      Advogado Virtual       │
│                             │
│  Email:    [____________]   │
│  Senha:    [____________]   │
│                             │
│  [      Entrar        ]     │
│  Criar conta | Esqueci senha│
└─────────────────────────────┘

TELA 2: Dashboard
┌──────┬──────────────────────────────────┐
│      │  Bem-vindo, Dr. João             │
│ ☰    │                                  │
│      │  ┌──────────┐ ┌──────────┐       │
│ Dash │  │ 12       │ │ 5        │       │
│      │  │ Clientes │ │ Atend.   │       │
│Client│  │ ativos   │ │ este mês │       │
│      │  └──────────┘ └──────────┘       │
│Histor│                                  │
│      │  Últimos atendimentos:           │
│Config│  • Maria S. - Aposentadoria 19/02│
│      │  • José P. - Auxílio      18/02  │
│      │  • Ana L.  - Revisão      17/02  │
└──────┴──────────────────────────────────┘

TELA 3: Dossiê do Cliente
┌──────┬──────────────────────────────────────┐
│      │  Maria da Silva          [Editar]    │
│      │  CPF: ***.456.***-**                  │
│      │  Tel: (11) 99999-0000                 │
│      │                                       │
│      │  [+ Novo Atendimento]                 │
│      │                                       │
│      │  Atendimentos:                        │
│      │  ┌───────────────────────────────────┐│
│      │  │ 19/02 - Previdenciário            ││
│      │  │ Status: Analisado | 2 peças       ││
│      │  │ [Ver detalhes]                    ││
│      │  └───────────────────────────────────┘│
│      │  ┌───────────────────────────────────┐│
│      │  │ 10/01 - Previdenciário            ││
│      │  │ Status: Finalizado | 1 peça       ││
│      │  │ [Ver detalhes]                    ││
│      │  └───────────────────────────────────┘│
└──────┴──────────────────────────────────────┘

TELA 4: Novo Atendimento (fluxo principal)
┌──────┬──────────────────────────────────────┐
│      │  Novo Atendimento - Maria da Silva    │
│      │  Área: [Previdenciário ▼]             │
│      │                                       │
│      │  ── ETAPA 1: Registro ──              │
│      │                                       │
│      │  Gravação de áudio:                   │
│      │  [🎙 Gravar]  [⏹ Parar]  00:00:00    │
│      │                                       │
│      │  Transcrição:                         │
│      │  ┌───────────────────────────────────┐│
│      │  │ Cliente relatou que trabalhou de  ││
│      │  │ 1995 a 2010 como metalúrgico...   ││
│      │  │ (editável)                        ││
│      │  └───────────────────────────────────┘│
│      │                                       │
│      │  Pedidos / solicitação específica:     │
│      │  ┌───────────────────────────────────┐│
│      │  │ Verificar tempo de contribuição   ││
│      │  │ e possibilidade de aposentadoria  ││
│      │  └───────────────────────────────────┘│
│      │                                       │
│      │  ── ETAPA 2: Documentos ──            │
│      │                                       │
│      │  [📎 Anexar documentos]               │
│      │  ┌──────────────────────────────┐     │
│      │  │ 📄 CNIS_Maria.pdf   [x]     │     │
│      │  │    Tipo: [CNIS ▼]           │     │
│      │  │ 📄 Indeferimento.pdf [x]    │     │
│      │  │    Tipo: [Indeferimento ▼]  │     │
│      │  └──────────────────────────────┘     │
│      │                                       │
│      │  [Salvar rascunho]  [▶ Analisar]      │
└──────┴──────────────────────────────────────┘

TELA 5: Análise / Consultoria
┌──────┬──────────────────────────────────────┐
│      │  Análise - Atendimento 19/02          │
│      │  Maria da Silva | Previdenciário      │
│      │                                       │
│      │  ┌─ RESUMO DOS FATOS ───────────────┐│
│      │  │ Segurada com 15 anos de contrib.  ││
│      │  │ DER em 15/03/2024. Indeferido por ││
│      │  │ carência insuficiente...          ││
│      │  └──────────────────────────────────┘│
│      │                                       │
│      │  ┌─ DADOS EXTRAÍDOS ────────────────┐│
│      │  │ DER: 15/03/2024  NB: 123456789   ││
│      │  │ Tempo: 15a 3m  Carência: 180     ││
│      │  │ [✓ Confirmar dados]              ││
│      │  └──────────────────────────────────┘│
│      │                                       │
│      │  ┌─ PLANO A ───────────────────────┐ │
│      │  │ Aposentadoria por Tempo          │ │
│      │  │ Probabilidade: ALTA              │ │
│      │  │ Fund: Art. 201 CF + Art. 52...   │ │
│      │  └─────────────────────────────────┘ │
│      │  ┌─ PLANO B ───────────────────────┐ │
│      │  │ Aposentadoria por Idade          │ │
│      │  │ Probabilidade: MÉDIA             │ │
│      │  └─────────────────────────────────┘ │
│      │                                       │
│      │  ⚠ RISCOS: Lacuna contrib. 2008-2010 │
│      │  📋 DOCS FALTANTES: CTPS, PPP        │
│      │  ❓ PERGUNTAS: Trabalho rural?        │
│      │                                       │
│      │  ═══ CORTAR CAMINHO ═══               │
│      │  [📝 Gerar Petição Inicial]           │
│      │  [⚡ Gerar Tutela de Urgência]        │
│      │  [📋 Gerar checklist WhatsApp]        │
│      │  [📧 Gerar msg solicitar docs]        │
└──────┴──────────────────────────────────────┘

TELA 6: Peça Gerada
┌──────┬──────────────────────────────────────┐
│      │  Petição Inicial Previdenciária       │
│      │  Maria da Silva | v1 | Rascunho      │
│      │                                       │
│      │  ┌───────────────────────────────────┐│
│      │  │ EXCELENTÍSSIMO SENHOR JUIZ...     ││
│      │  │                                   ││
│      │  │ MARIA DA SILVA, brasileira...     ││
│      │  │                                   ││
│      │  │ I - DOS FATOS                     ││
│      │  │ ...                               ││
│      │  │ (editor com markdown)             ││
│      │  └───────────────────────────────────┘│
│      │                                       │
│      │  ┌─ VALIDAÇÃO ─────────────────────┐ │
│      │  │ ✓ Coerência fatos x pedidos: OK │ │
│      │  │ ⚠ 1 citação não verificada      │ │
│      │  │   [VERIFICAR] Súmula 44 TNU     │ │
│      │  └─────────────────────────────────┘ │
│      │                                       │
│      │  [Salvar] [Baixar DOCX] [Baixar PDF]  │
└──────┴──────────────────────────────────────┘
```

---

### FASE 2 — EXTRAÇÃO PRECISA E MULTI-ÁREA (Semanas 7-12)

> **Objetivo:** Tornar a extração de documentos confiável e expandir para Cível e Trabalhista.

```
[ ] Pipeline de extração por tipo de documento:
    - CNIS: vínculos, contribuições, última contribuição, lacunas
    - Indeferimento: motivo, DER, data, espécie
    - Cessação: DCB, motivo
    - Carta de concessão: DIB, RMI, espécie
    - Laudos: CID, incapacidade, data
    Cada documento gera "ficha estruturada" com campos + botão confirmar/corrigir

[ ] Transcrição profissional:
    - Substituir Web Speech API por Whisper (OpenAI) ou Deepgram server-side
    - Salvar áudio original no storage
    - Extração automática de campos da transcrição (NER jurídico)

[ ] Templates de prompts para Cível e Trabalhista
    - Prompts de análise e geração por área
    - Tipos de peça por área

[ ] Exportação DOCX profissional com formatação jurídica completa
    - Cabeçalho, numeração, formatação OAB-padrão

[ ] Confirmação de dados extraídos (UI de "ficha"):
    - Cada campo extraído é editável
    - Status: "extraído automaticamente" vs "confirmado pelo usuário"
    - Análise só roda com dados confirmados
```

---

### FASE 3 — MULTI-TENANT E CONTROLE DE ACESSO (Semanas 13-18)

> **Objetivo:** Onboarding de múltiplos escritórios com isolamento total.

```
[ ] Cadastro self-service de escritório (tenant)
[ ] Convite de membros por email
[ ] Roles completos: admin, advogado, revisor, estagiário
    - Estagiário: criar atendimento, rodar análise (sem gerar peça)
    - Advogado: tudo exceto configurações do escritório
    - Revisor: pode aprovar peças para exportação
    - Admin: tudo + gestão de membros + configurações + billing
[ ] Dashboard admin: uso de IA, custos, membros, limites
[ ] Planos e billing (Stripe):
    - Trial: 10 análises
    - Básico: 50 análises/mês
    - Profissional: ilimitado + prioridade
[ ] Auditoria: log de todas as ações (quem, quando, o quê)
```

---

### FASE 4 — VALIDAÇÃO DE FONTES E QUALIDADE (Semanas 19-24)

> **Objetivo:** Reduzir risco de citações inventadas e aumentar confiabilidade.

```
[ ] Camada de validação de citações legais:
    - Verificação de artigos de lei contra base atualizada
    - Verificação de súmulas/OJ contra base de jurisprudência
    - Flag automático: "verificada" vs "não verificada" vs "não encontrada"
[ ] Integração com bases de legislação (planalto.gov.br, JusBrasil API, etc.)
[ ] Validação de coerência peça x análise:
    - Fatos citados na peça existem na análise?
    - Pedidos são compatíveis com os fatos e o direito?
    - Valores/datas estão consistentes?
[ ] Score de confiança da peça (% verificado)
[ ] Feedback loop: advogado marca correções → melhoria dos prompts
```

---

### FASE 5 — FUNCIONALIDADES AVANÇADAS (Semanas 25+)

```
[ ] Área Criminal completa
[ ] Pesquisa de jurisprudência integrada (RAG com embeddings)
[ ] Templates personalizáveis por escritório
[ ] Workflow de aprovação (estagiário → advogado → revisor)
[ ] Integração com PJe (consulta processual)
[ ] App mobile (React Native ou PWA)
[ ] Assinatura digital de documentos
[ ] Módulo financeiro (honorários, custas)
[ ] Relatórios gerenciais (produtividade, tipos de caso, taxa de êxito)
```

---

## 4. REQUISITOS NÃO-FUNCIONAIS

### 4.1 Segurança e LGPD
- Criptografia em trânsito (TLS 1.3) e em repouso (AES-256 para dados sensíveis)
- CPF, dados de saúde e dados financeiros sempre criptografados na aplicação
- Row Level Security no banco (isolamento por tenant)
- Chave da API Anthropic NUNCA exposta ao browser
- Logs de auditoria imutáveis
- Política de retenção: dados mantidos enquanto plano ativo; após cancelamento, 90 dias para exportar, depois exclusão
- Consentimento LGPD no cadastro do cliente

### 4.2 Performance
- Tempo de resposta da análise: < 30s (streaming)
- Tempo de geração de peça: < 45s (streaming)
- Upload de documentos: < 10s para 5MB
- Suportar 50 usuários simultâneos na Fase 1, 500+ na Fase 3

### 4.3 Disponibilidade
- 99.5% uptime (Vercel + Supabase managed)
- Backups diários automáticos
- Failover para modelo de IA alternativo (opcional)

---

## 5. CONFIGURAÇÃO DE AMBIENTE (.env)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# Anthropic
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
ANTHROPIC_MAX_TOKENS=8192

# Transcrição (Fase 1: Whisper via OpenAI API)
OPENAI_API_KEY=sk-xxx

# App
NEXTAUTH_SECRET=xxx
NEXTAUTH_URL=http://localhost:3000
APP_ENV=development

# Criptografia de dados sensíveis
ENCRYPTION_KEY=xxx
```

---

## 6. COMANDOS PARA INICIAR O PROJETO (Claude Code)

```bash
# 1. Criar projeto Next.js
npx create-next-app@latest advogado-virtual --typescript --tailwind --eslint --app --src-dir

# 2. Instalar dependências core
cd advogado-virtual
npm install @supabase/supabase-js @supabase/ssr
npm install @anthropic-ai/sdk
npm install next-auth
npm install docx          # geração de DOCX
npm install mammoth        # leitura de DOCX
npm install pdf-parse      # extração de texto de PDF
npm install sharp          # processamento de imagens

# 3. UI Components
npx shadcn@latest init
npx shadcn@latest add button card input textarea label select dialog toast tabs badge separator alert scroll-area dropdown-menu avatar

# 4. Supabase
npx supabase init
npx supabase db push  # aplicar migrations
```

---

## 7. CHECKLIST DE ENTREGA — FASE 1 (MVP)

```
Sprint 1 (Semana 1-2): Fundação
  [ ] Setup do projeto Next.js + Supabase
  [ ] Migrations do banco de dados
  [ ] Auth (login/registro) com NextAuth + Supabase
  [ ] Layout base: sidebar, header, tenant context
  [ ] CRUD de clientes (lista, criar, editar, ver)

Sprint 2 (Semana 3-4): Atendimento
  [ ] Tela de novo atendimento completa
  [ ] Gravação de áudio no browser (MediaRecorder)
  [ ] Integração Whisper API para transcrição
  [ ] Upload de documentos para Supabase Storage
  [ ] Extração de texto de PDFs (pdf-parse)
  [ ] Classificação manual de tipo de documento

Sprint 3 (Semana 5-6): IA + Peças + Export
  [ ] Integração Anthropic API (server-side)
  [ ] Prompt de análise previdenciária
  [ ] Tela de análise com cards estruturados
  [ ] Botões "Cortar Caminho"
  [ ] Prompt de petição inicial previdenciária
  [ ] Tela de visualização/edição de peça
  [ ] Exportação DOCX básica
  [ ] Histórico de atendimentos e peças
  [ ] Deploy em produção (Vercel + Supabase)
```

---

## 8. OBSERVAÇÕES PARA O DESENVOLVEDOR

1. **Streaming de IA:** Usar streaming da Anthropic API para que o usuário veja a análise/peça sendo gerada em tempo real (SSE ou WebSocket).

2. **Prompts são código:** Tratar prompts como código versionado. Cada mudança no prompt deve ser rastreável e testável com casos reais.

3. **OCR não é perfeito:** A extração de texto de PDFs escaneados (imagens) exige OCR. O pdf-parse funciona para PDFs com texto nativo. Para PDFs escaneados, considerar Tesseract.js ou serviço externo. Fase 1 pode aceitar apenas PDFs com texto nativo + campo manual.

4. **Segurança desde o dia 1:** Mesmo no MVP, implementar RLS no Supabase e nunca expor a API key da Anthropic no frontend.

5. **Custo de IA:** Cada análise completa (prompt grande) pode custar ~$0.05-0.15 (Sonnet). Cada peça ~$0.10-0.30. Monitorar e logar tudo na tabela api_usage_log.

6. **Testes com dados reais:** Antes de entregar cada fase, testar com pelo menos 5 casos previdenciários reais (anonimizados) e medir qualidade, consistência e tempo.
