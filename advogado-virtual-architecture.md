# Advogado Virtual — Arquitetura de Software v2 (Pivotada)

> **Objetivo deste documento:** Especificação técnica completa para construção do SaaS "Advogado Virtual", reestruturada com base no novo desenho de produto. Este documento substitui a v1 e é o prompt de referência para o Claude Code.

---

## 1. VISÃO GERAL DO PRODUTO

### 1.1 O que é
SaaS jurídico que permite escritórios de advocacia gravar atendimentos, analisar casos com IA, gerar peças processuais e manter dossiê completo de cada cliente — tudo sem exigir que o advogado entenda de tecnologia.

### 1.2 Princípio central
> **A transcrição do atendimento é o ativo principal.** Ela é salva sempre, mesmo que nenhuma peça seja gerada. O sistema valoriza o registro do caso acima de tudo.

### 1.3 Áreas de atuação
| Área | Status no MVP |
|------|---------------|
| Previdenciário | ✅ Completo |
| Trabalhista | ✅ Completo |
| Cível | 🔒 "Em breve" |
| Criminal | 🔒 "Em breve" |
| Tributário | 🔒 "Em breve" |
| Empresarial | 🔒 "Em breve" |

### 1.4 Três pilares por área (sempre visíveis)
Dentro de cada área, o painel exibe SEMPRE três grupos fixos (para virar hábito):

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  ⚡ Peças com IA │  │  📄 Modelos     │  │  🧠 Consultoria │
│                  │  │     Prontos     │  │    / Análise IA │
│ Petição Inicial  │  │ Procuração      │  │ Análise de caso │
│ Contestação      │  │ Contrato Honor. │  │ Parecer         │
│ Réplica          │  │ Substabelecim.  │  │ Estratégia      │
│ Apelação         │  │ Declarações     │  │                 │
│ Agravo           │  │                 │  │                 │
│ Embargos         │  │                 │  │                 │
│ Recurso Ordinário│  │                 │  │                 │
│ Contrarrazões    │  │                 │  │                 │
│ Tutela           │  │                 │  │                 │
│ Cumprimento      │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 1.5 Dois perfis de uso (fluxos paralelos)

**Advogado novato (caminho guiado):**
```
Área → Gravar atendimento → "Caso novo – análise jurídica" →
Checklist docs/perguntas → Anexar documentos → Gerar peça →
Revisar e validar → Baixar
```

**Advogado experiente (caminho rápido):**
```
Área → Gravar atendimento → Gerar peça → Refinar com documentos →
Revisar e validar → Baixar
```

### 1.6 Princípios arquiteturais
- **Entregáveis rápidos:** MVP funcional vendável na primeira entrega
- **Escalonável:** Multi-tenant desde o dia 1
- **Modular:** Cada capacidade é um serviço independente
- **API-first:** Backend REST; frontend SPA desacoplado
- **IA no servidor:** Chave Anthropic nunca exposta ao browser (Modelo B)
- **Transcrição é sagrada:** Salva sempre, com ou sem peça

---

## 2. ARQUITETURA TÉCNICA

### 2.1 Stack

```
┌───────────────────────────────────────────────────────────┐
│                      FRONTEND (SPA)                       │
│               Next.js 14+ / App Router                    │
│            React + Tailwind CSS + shadcn/ui               │
└────────────────────────┬──────────────────────────────────┘
                         │ HTTPS (REST + SSE para streaming)
┌────────────────────────▼──────────────────────────────────┐
│                    BACKEND (API Layer)                     │
│                  Next.js API Routes                        │
│                                                            │
│  ┌───────────┐ ┌───────────┐ ┌──────────┐ ┌───────────┐  │
│  │   Auth    │ │  Tenant   │ │  Rate    │ │  RBAC     │  │
│  │Middleware │ │Middleware │ │ Limiter  │ │  Guard    │  │
│  └───────────┘ └───────────┘ └──────────┘ └───────────┘  │
└────────────────────────┬──────────────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────────────┐
│                   SERVICE LAYER                            │
│                                                            │
│  ┌──────────────┐ ┌──────────────┐ ┌───────────────────┐  │
│  │ Atendimento  │ │  Análise     │ │  Geração de       │  │
│  │ Service      │ │  Service     │ │  Peças Service    │  │
│  │ (gravar,     │ │ (caso novo,  │ │ (gerar, refinar,  │  │
│  │  transcrever,│ │  consultoria)│ │  revisar, validar)│  │
│  │  salvar)     │ │              │ │                   │  │
│  └──────────────┘ └──────────────┘ └───────────────────┘  │
│  ┌──────────────┐ ┌──────────────┐ ┌───────────────────┐  │
│  │ Documento    │ │ Transcrição  │ │ Exportação        │  │
│  │ Service      │ │ Service      │ │ Service           │  │
│  │ (upload,     │ │ (áudio →     │ │ (DOCX, PDF,       │  │
│  │  OCR, parse) │ │  texto)      │ │  versionamento)   │  │
│  └──────────────┘ └──────────────┘ └───────────────────┘  │
│  ┌──────────────┐ ┌──────────────┐                        │
│  │ Comando      │ │ Modelo       │                        │
│  │ Service      │ │ Pronto       │                        │
│  │ (botões de   │ │ Service      │                        │
│  │  prompt)     │ │ (templates)  │                        │
│  └──────────────┘ └──────────────┘                        │
└────────────────────────┬──────────────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────────────┐
│                    INFRAESTRUTURA                          │
│                                                            │
│  ┌──────────┐  ┌───────────────┐  ┌────────────────────┐  │
│  │PostgreSQL│  │ Supabase      │  │ Redis (cache +     │  │
│  │(Supabase)│  │ Storage       │  │  rate limiting)    │  │
│  │  + RLS   │  │ (docs/áudios) │  │  [Fase 2+]        │  │
│  └──────────┘  └───────────────┘  └────────────────────┘  │
│                                                            │
│  ┌────────────────────────────────────────────────────┐    │
│  │           Anthropic API (Claude Sonnet)            │    │
│  │     Chave centralizada · Logs de uso · Limites     │    │
│  └────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────┐    │
│  │        OpenAI Whisper API (transcrição)            │    │
│  └────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────┘
```

### 2.2 Modelo de dados completo

```sql
-- ============================================================
-- BLOCO 1: INFRAESTRUTURA (Tenants, Users, Audit)
-- ============================================================

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cnpj TEXT,
  plano TEXT DEFAULT 'trial',
  status TEXT DEFAULT 'ativo',
  config JSONB DEFAULT '{}',
  limite_analises_mes INT DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'advogado',
  oab TEXT,
  status TEXT DEFAULT 'ativo',
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  acao TEXT NOT NULL,
  entidade TEXT,
  entidade_id UUID,
  detalhes JSONB DEFAULT '{}',
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_tenant_date ON audit_log(tenant_id, created_at DESC);

-- ============================================================
-- BLOCO 2: DOSSIÊ DO CLIENTE
-- ============================================================

CREATE TABLE clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  nome TEXT NOT NULL,
  cpf_encrypted TEXT,
  telefone TEXT,
  email TEXT,
  endereco TEXT,
  notas TEXT,
  status TEXT DEFAULT 'ativo',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_clientes_tenant ON clientes(tenant_id);
CREATE INDEX idx_clientes_busca ON clientes(tenant_id, nome);

-- ============================================================
-- BLOCO 3: ATENDIMENTO (entidade sagrada)
-- ============================================================

CREATE TABLE atendimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  cliente_id UUID NOT NULL REFERENCES clientes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  area TEXT NOT NULL,
  tipo_peca_origem TEXT,
  origem TEXT DEFAULT 'peca_ia',
  modo_input TEXT DEFAULT 'gravar',
  audio_url TEXT,
  audio_duracao_seg INT,
  transcricao_raw TEXT,
  transcricao_editada TEXT,
  pedido_especifico TEXT,
  dados_extraidos JSONB DEFAULT '{}',
  status TEXT DEFAULT 'caso_novo',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_atend_tenant ON atendimentos(tenant_id);
CREATE INDEX idx_atend_cliente ON atendimentos(cliente_id);
CREATE INDEX idx_atend_status ON atendimentos(tenant_id, status);

-- ============================================================
-- BLOCO 4: DOCUMENTOS ANEXADOS
-- ============================================================

CREATE TABLE documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atendimento_id UUID NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  tipo TEXT DEFAULT 'outro',
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  tamanho_bytes BIGINT,
  texto_extraido TEXT,
  dados_extraidos JSONB DEFAULT '{}',
  ficha_confirmada BOOLEAN DEFAULT false,
  confirmado_por UUID REFERENCES users(id),
  confirmado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_docs_atendimento ON documentos(atendimento_id);

-- ============================================================
-- BLOCO 5: ANÁLISE JURÍDICA ("Caso novo – análise jurídica")
-- ============================================================

CREATE TABLE analises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atendimento_id UUID NOT NULL REFERENCES atendimentos(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  tipo TEXT DEFAULT 'caso_novo',
  caminho_processual JSONB,
  plano_a JSONB,
  plano_b JSONB,
  riscos JSONB,
  perguntas_faltantes JSONB,
  checklist_documentos JSONB,
  estrategia_probatoria JSONB,
  acoes_sugeridas JSONB,
  resumo_didatico TEXT,
  fontes JSONB DEFAULT '{}',
  prompt_utilizado TEXT,
  modelo_ia TEXT,
  tokens JSONB,
  status TEXT DEFAULT 'gerada',
  revisada_por UUID REFERENCES users(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_analises_atend ON analises(atendimento_id);

-- ============================================================
-- BLOCO 6: COMANDOS RÁPIDOS (botões de prompt)
-- ============================================================

CREATE TABLE comando_execucoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atendimento_id UUID NOT NULL REFERENCES atendimentos(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  comando TEXT NOT NULL,
  resultado TEXT,
  resultado_json JSONB,
  prompt_utilizado TEXT,
  modelo_ia TEXT,
  tokens JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_comandos_atend ON comando_execucoes(atendimento_id);

-- ============================================================
-- BLOCO 7: PEÇAS PROCESSUAIS
-- ============================================================

CREATE TABLE pecas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atendimento_id UUID NOT NULL REFERENCES atendimentos(id),
  analise_id UUID REFERENCES analises(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  area TEXT NOT NULL,
  tipo TEXT NOT NULL,
  conteudo_markdown TEXT,
  conteudo_html TEXT,
  refinada_com_documentos BOOLEAN DEFAULT false,
  historico_refinamentos JSONB DEFAULT '[]',
  validacao JSONB,
  versao INT DEFAULT 1,
  status TEXT DEFAULT 'rascunho',
  prompt_utilizado TEXT,
  modelo_ia TEXT,
  tokens JSONB,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pecas_atend ON pecas(atendimento_id);
CREATE INDEX idx_pecas_tenant ON pecas(tenant_id);

CREATE TABLE pecas_versoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id UUID NOT NULL REFERENCES pecas(id) ON DELETE CASCADE,
  versao INT NOT NULL,
  conteudo_markdown TEXT,
  origem TEXT,
  descricao_mudanca TEXT,
  alterado_por UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- BLOCO 8: MODELOS PRONTOS (Templates)
-- ============================================================

CREATE TABLE modelos_prontos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  area TEXT NOT NULL,
  tipo TEXT NOT NULL,
  nome TEXT NOT NULL,
  descricao TEXT,
  template_markdown TEXT NOT NULL,
  campos JSONB NOT NULL,
  ativo BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE modelos_gerados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id UUID NOT NULL REFERENCES modelos_prontos(id),
  atendimento_id UUID REFERENCES atendimentos(id),
  cliente_id UUID NOT NULL REFERENCES clientes(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  campos_preenchidos JSONB NOT NULL,
  conteudo_final TEXT NOT NULL,
  file_url TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- BLOCO 9: EXPORTAÇÕES
-- ============================================================

CREATE TABLE exportacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  peca_id UUID REFERENCES pecas(id),
  modelo_gerado_id UUID REFERENCES modelos_gerados(id),
  formato TEXT NOT NULL DEFAULT 'docx',
  file_url TEXT NOT NULL,
  versao_snapshot INT,
  exported_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_export_tenant ON exportacoes(tenant_id);

-- ============================================================
-- BLOCO 10: USO DA API DE IA
-- ============================================================

CREATE TABLE api_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL,
  modelo TEXT,
  tokens_input INT,
  tokens_output INT,
  custo_estimado DECIMAL(10,6),
  latencia_ms INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_usage_tenant ON api_usage_log(tenant_id, created_at DESC);

-- ============================================================
-- BLOCO 11: ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE atendimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE analises ENABLE ROW LEVEL SECURITY;
ALTER TABLE comando_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pecas ENABLE ROW LEVEL SECURITY;
ALTER TABLE pecas_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE modelos_prontos ENABLE ROW LEVEL SECURITY;
ALTER TABLE modelos_gerados ENABLE ROW LEVEL SECURITY;
ALTER TABLE exportacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE POLICY tenant_isolation ON clientes USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON atendimentos USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON documentos USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON analises USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON pecas USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON exportacoes USING (tenant_id = current_tenant_id());
```

---

## 3. ESTRUTURA DO PROJETO

```
advogado-virtual/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── registro/page.tsx
│   │   │
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx                          # Shell: header + sidebar mínima
│   │   │   ├── page.tsx                            # HOME: cards das áreas do Direito
│   │   │   │
│   │   │   ├── [area]/                             # /previdenciario, /trabalhista, etc.
│   │   │   │   ├── page.tsx                        # PAINEL DA ÁREA: 3 grupos fixos
│   │   │   │   │
│   │   │   │   ├── pecas/
│   │   │   │   │   ├── page.tsx                    # Lista de tipos de peça da área
│   │   │   │   │   └── [tipoPeca]/
│   │   │   │   │       └── page.tsx                # TELA DE ATENDIMENTO UNIFICADA
│   │   │   │   │
│   │   │   │   ├── modelos/
│   │   │   │   │   ├── page.tsx                    # Lista de modelos prontos da área
│   │   │   │   │   └── [modeloId]/
│   │   │   │   │       └── page.tsx                # Preencher modelo (campos guiados)
│   │   │   │   │
│   │   │   │   └── consultoria/
│   │   │   │       └── page.tsx                    # Consultoria/análise avulsa
│   │   │   │
│   │   │   ├── clientes/
│   │   │   │   ├── page.tsx                        # Lista de clientes
│   │   │   │   ├── novo/page.tsx
│   │   │   │   └── [clienteId]/
│   │   │   │       └── page.tsx                    # DOSSIÊ completo do cliente
│   │   │   │
│   │   │   ├── atendimentos/
│   │   │   │   ├── page.tsx                        # Histórico de todos os atendimentos
│   │   │   │   └── [atendId]/
│   │   │   │       ├── page.tsx                    # Detalhes do atendimento
│   │   │   │       ├── analise/page.tsx            # Análise gerada
│   │   │   │       └── pecas/
│   │   │   │           └── [pecaId]/page.tsx       # Visualizar/editar/validar peça
│   │   │   │
│   │   │   └── configuracoes/
│   │   │       ├── page.tsx
│   │   │       ├── equipe/page.tsx
│   │   │       ├── modelos/page.tsx
│   │   │       └── uso/page.tsx
│   │   │
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── clientes/
│   │       │   ├── route.ts
│   │       │   └── [id]/route.ts
│   │       ├── atendimentos/
│   │       │   ├── route.ts
│   │       │   └── [id]/route.ts
│   │       ├── documentos/
│   │       │   ├── upload/route.ts
│   │       │   └── [id]/route.ts
│   │       ├── transcricao/route.ts
│   │       ├── ia/
│   │       │   ├── analise/route.ts
│   │       │   ├── gerar-peca/route.ts
│   │       │   ├── refinar-peca/route.ts
│   │       │   ├── validar-peca/route.ts
│   │       │   ├── comando/route.ts
│   │       │   └── correcao-auto/route.ts
│   │       ├── modelos/
│   │       │   ├── route.ts
│   │       │   └── gerar/route.ts
│   │       └── exportar/route.ts
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts
│   │   │   ├── server.ts
│   │   │   └── admin.ts
│   │   ├── anthropic/
│   │   │   ├── client.ts
│   │   │   ├── stream.ts
│   │   │   └── usage.ts
│   │   ├── prompts/
│   │   │   ├── types.ts
│   │   │   ├── analise/
│   │   │   │   ├── previdenciario.ts
│   │   │   │   └── trabalhista.ts
│   │   │   ├── pecas/
│   │   │   │   ├── previdenciario/
│   │   │   │   │   ├── peticao-inicial.ts
│   │   │   │   │   ├── contestacao.ts
│   │   │   │   │   └── ... (demais tipos)
│   │   │   │   └── trabalhista/
│   │   │   │       ├── peticao-inicial.ts
│   │   │   │       ├── contestacao.ts
│   │   │   │       └── ... (demais tipos)
│   │   │   ├── comandos/
│   │   │   │   ├── organizar-timeline.ts
│   │   │   │   ├── listar-documentos.ts
│   │   │   │   ├── perguntas-faltantes.ts
│   │   │   │   ├── sugestao-acao.ts
│   │   │   │   ├── riscos-caso.ts
│   │   │   │   ├── adicionar-tutela.ts
│   │   │   │   ├── fortalecer-fundamentos.ts
│   │   │   │   └── refinar-documentos.ts
│   │   │   ├── validacao/
│   │   │   │   └── revisar-validar.ts
│   │   │   └── refinamento/
│   │   │       └── refinar-com-documentos.ts
│   │   ├── documents/
│   │   │   ├── pdf-extract.ts
│   │   │   ├── ocr.ts
│   │   │   └── parser.ts
│   │   ├── export/
│   │   │   ├── docx-generator.ts
│   │   │   └── pdf-generator.ts
│   │   ├── crypto.ts
│   │   ├── audit.ts
│   │   ├── rbac.ts
│   │   └── constants/
│   │       ├── areas.ts
│   │       ├── tipos-peca.ts
│   │       ├── tipos-documento.ts
│   │       └── comandos.ts
│   │
│   ├── components/
│   │   ├── ui/                                     # shadcn/ui
│   │   ├── layout/
│   │   │   ├── AppShell.tsx
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── TenantProvider.tsx
│   │   ├── home/
│   │   │   └── AreaCards.tsx
│   │   ├── area/
│   │   │   ├── PainelArea.tsx
│   │   │   ├── GrupoPecas.tsx
│   │   │   ├── GrupoModelos.tsx
│   │   │   └── GrupoConsultoria.tsx
│   │   ├── atendimento/
│   │   │   ├── TelaAtendimento.tsx                 # COMPONENTE CENTRAL
│   │   │   ├── DadosCliente.tsx
│   │   │   ├── GravadorAudio.tsx
│   │   │   ├── EditorTranscricao.tsx
│   │   │   ├── CampoDigitar.tsx
│   │   │   ├── UploadDocumentos.tsx
│   │   │   ├── ComandosRapidos.tsx
│   │   │   ├── BotaoCasoNovo.tsx
│   │   │   └── BotaoGerarPeca.tsx
│   │   ├── analise/
│   │   │   ├── RelatorioAnalise.tsx
│   │   │   ├── CaminhoProcessual.tsx
│   │   │   ├── PlanosAB.tsx
│   │   │   ├── Riscos.tsx
│   │   │   ├── ChecklistDocs.tsx
│   │   │   ├── PerguntasFaltantes.tsx
│   │   │   ├── EstrategiaProbatoria.tsx
│   │   │   └── AcoesSugeridas.tsx
│   │   ├── pecas/
│   │   │   ├── EditorPeca.tsx
│   │   │   ├── PainelLateral.tsx
│   │   │   ├── BotaoRefinar.tsx
│   │   │   ├── BotaoValidar.tsx
│   │   │   ├── RelatorioValidacao.tsx
│   │   │   ├── BotoesCorrecaoAuto.tsx
│   │   │   └── BotaoExportar.tsx
│   │   ├── modelos/
│   │   │   ├── ListaModelos.tsx
│   │   │   ├── FormularioModelo.tsx
│   │   │   └── PreviewModelo.tsx
│   │   ├── dossie/
│   │   │   ├── DossieCliente.tsx
│   │   │   ├── TimelineAtendimentos.tsx
│   │   │   └── ArvoreDossie.tsx
│   │   └── shared/
│   │       ├── StreamingText.tsx
│   │       ├── StatusBadge.tsx
│   │       ├── LoadingIA.tsx
│   │       └── ConfirmDialog.tsx
│   │
│   ├── hooks/
│   │   ├── useAudio.ts
│   │   ├── useStreaming.ts
│   │   ├── useTenant.ts
│   │   └── usePermission.ts
│   │
│   ├── types/
│   │   ├── index.ts
│   │   ├── area.ts
│   │   ├── atendimento.ts
│   │   ├── analise.ts
│   │   ├── peca.ts
│   │   ├── validacao.ts
│   │   └── comando.ts
│   │
│   └── middleware.ts

├── supabase/
│   └── migrations/
│       ├── 001_tenants_users_audit.sql
│       ├── 002_clientes.sql
│       ├── 003_atendimentos_documentos.sql
│       ├── 004_analises_comandos.sql
│       ├── 005_pecas_versoes.sql
│       ├── 006_modelos_prontos.sql
│       ├── 007_exportacoes_usage.sql
│       └── 008_rls_policies.sql
├── .env.local
├── package.json
└── tsconfig.json
```

---

## 4. CONSTANTES E CONFIGURAÇÃO POR ÁREA

```typescript
// src/lib/constants/areas.ts

export const AREAS = {
  previdenciario: {
    id: 'previdenciario',
    nome: 'Previdenciário',
    icone: 'Shield',
    cor: '#2563EB',
    ativo: true,
    pecas: [
      'peticao_inicial', 'contestacao', 'replica', 'apelacao', 'agravo',
      'embargos', 'recurso_especial', 'tutela', 'cumprimento', 'contrarrazoes'
    ],
    modelos: ['procuracao', 'contrato_honorarios', 'substabelecimento', 'declaracao_hipossuficiencia'],
    tipos_documento: [
      'cnis', 'indeferimento', 'cessacao', 'carta_concessao', 'laudo_medico',
      'ppp', 'ctps', 'procuracao', 'rg_cpf', 'comprovante_residencia', 'outro'
    ]
  },
  trabalhista: {
    id: 'trabalhista',
    nome: 'Trabalhista',
    icone: 'Briefcase',
    cor: '#D97706',
    ativo: true,
    pecas: [
      'peticao_inicial', 'contestacao', 'replica', 'recurso_ordinario',
      'recurso_revista', 'agravo', 'embargos', 'tutela', 'cumprimento',
      'contrarrazoes', 'acordo'
    ],
    modelos: ['procuracao', 'contrato_honorarios', 'substabelecimento', 'notificacao_extrajudicial'],
    tipos_documento: [
      'ctps', 'trct', 'holerites', 'contrato_trabalho', 'acordo_coletivo',
      'sentenca', 'acordao', 'ata_audiencia', 'procuracao', 'rg_cpf', 'outro'
    ]
  },
  civel:       { id: 'civel',       nome: 'Cível',        icone: 'Scale',    cor: '#059669', ativo: false, pecas: [], modelos: [], tipos_documento: [] },
  criminal:    { id: 'criminal',    nome: 'Criminal',     icone: 'Gavel',    cor: '#DC2626', ativo: false, pecas: [], modelos: [], tipos_documento: [] },
  tributario:  { id: 'tributario',  nome: 'Tributário',   icone: 'Receipt',  cor: '#7C3AED', ativo: false, pecas: [], modelos: [], tipos_documento: [] },
  empresarial: { id: 'empresarial', nome: 'Empresarial',  icone: 'Building', cor: '#0891B2', ativo: false, pecas: [], modelos: [], tipos_documento: [] },
} as const;

// src/lib/constants/tipos-peca.ts

export const TIPOS_PECA: Record<string, { id: string; nome: string; descricao: string }> = {
  peticao_inicial:   { id: 'peticao_inicial',   nome: 'Petição Inicial',      descricao: 'Peça inaugural da ação' },
  contestacao:       { id: 'contestacao',       nome: 'Contestação',          descricao: 'Defesa do réu' },
  replica:           { id: 'replica',           nome: 'Réplica',              descricao: 'Resposta à contestação' },
  apelacao:          { id: 'apelacao',          nome: 'Apelação',             descricao: 'Recurso contra sentença' },
  agravo:            { id: 'agravo',            nome: 'Agravo',               descricao: 'Recurso contra decisão interlocutória' },
  embargos:          { id: 'embargos',          nome: 'Embargos',             descricao: 'Embargos de declaração ou à execução' },
  recurso_ordinario: { id: 'recurso_ordinario', nome: 'Recurso Ordinário',    descricao: 'Recurso trabalhista contra sentença' },
  recurso_especial:  { id: 'recurso_especial',  nome: 'Recurso Especial',     descricao: 'Recurso para tribunal superior' },
  recurso_revista:   { id: 'recurso_revista',   nome: 'Recurso de Revista',   descricao: 'Recurso trabalhista para TST' },
  tutela:            { id: 'tutela',            nome: 'Tutela',               descricao: 'Tutela de urgência ou evidência' },
  cumprimento:       { id: 'cumprimento',       nome: 'Cumprimento',          descricao: 'Cumprimento de sentença' },
  contrarrazoes:     { id: 'contrarrazoes',     nome: 'Contrarrazões',        descricao: 'Resposta a recurso da parte contrária' },
  acordo:            { id: 'acordo',            nome: 'Acordo',               descricao: 'Proposta de acordo judicial/extrajudicial' },
};

// src/lib/constants/comandos.ts

export const COMANDOS_RAPIDOS = [
  { id: 'organizar_timeline',    label: 'Organizar em linha do tempo',    icone: 'Clock',         disponivel_sem_peca: true  },
  { id: 'listar_documentos',     label: 'Listar documentos necessários',  icone: 'FileCheck',     disponivel_sem_peca: true  },
  { id: 'perguntas_faltantes',   label: 'Perguntas faltantes',            icone: 'HelpCircle',    disponivel_sem_peca: true  },
  { id: 'sugestao_acao',         label: 'Sugestão de ação/recurso',       icone: 'Lightbulb',     disponivel_sem_peca: true  },
  { id: 'riscos_caso',           label: 'Riscos do caso',                 icone: 'AlertTriangle', disponivel_sem_peca: true  },
  { id: 'gerar_peca',            label: 'Gerar peça completa',            icone: 'FileText',      disponivel_sem_peca: false },
  { id: 'adicionar_tutela',      label: 'Adicionar tutela',               icone: 'ShieldAlert',   disponivel_sem_peca: false },
  { id: 'fortalecer_fundamentos',label: 'Fortalecer fundamentos',         icone: 'TrendingUp',    disponivel_sem_peca: false },
  { id: 'refinar_documentos',    label: 'Refinar com documentos',         icone: 'FilePlus',      disponivel_sem_peca: false },
  { id: 'revisar_validar',       label: 'Revisar e validar',              icone: 'CheckCircle',   disponivel_sem_peca: false },
] as const;
```

---

## 5. PROMPTS DE IA

### 5.1 Prompt: "Caso novo – análise jurídica" (Previdenciário)

```typescript
// src/lib/prompts/analise/previdenciario.ts

export function buildPromptAnalisePrev(dados: {
  transcricao: string;
  pedido_especifico?: string;
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>;
  tipo_peca_origem?: string;
}): string {
  return `
Você é um consultor jurídico especialista em Direito Previdenciário brasileiro. Seu papel é analisar o atendimento abaixo e produzir um RELATÓRIO DE CONSULTORIA PRÁTICO E DIDÁTICO, em linguagem clara, para orientar o advogado.

Você NÃO está gerando peça processual. Você está orientando o advogado sobre O QUE FAZER.

${dados.tipo_peca_origem ? `O advogado acessou a análise a partir do tipo de peça "${dados.tipo_peca_origem}", mas a análise deve ser imparcial — se outro caminho for melhor, recomende-o.` : ''}

## DADOS DO ATENDIMENTO

### Transcrição:
${dados.transcricao}

### Pedido específico do advogado:
${dados.pedido_especifico || "Nenhum pedido específico."}

### Documentos anexados:
${dados.documentos.length > 0
  ? dados.documentos.map((d, i) => `--- DOCUMENTO ${i + 1}: ${d.file_name} (Tipo: ${d.tipo}) ---\n${d.texto_extraido}`).join('\n\n')
  : "Nenhum documento anexado ainda."}

## FORMATO DE RESPOSTA — JSON VÁLIDO:

{
  "dados_extraidos": {
    "datas": { "DER": "...", "DCB": "...", "DIB": "...", "admissoes": [], "demissoes": [] },
    "numeros": { "NB": "...", "NIT_PIS": "...", "CPF": "...", "valores": [] },
    "vinculos": [{ "empregador": "...", "periodo": "...", "contribuicoes": "..." }],
    "saude": { "CIDs": [], "diagnosticos": [], "incapacidade": "..." },
    "indeferimento_cessacao": { "motivo": "...", "data": "...", "especie": "..." }
  },
  "caminho_processual": {
    "recomendado": "...",
    "motivo": "...",
    "alternativas": [{ "nome": "...", "motivo": "...", "quando_preferir": "..." }]
  },
  "plano_a": { "titulo": "...", "descricao": "...", "fundamento_legal": "...", "probabilidade": "alta|media|baixa", "pre_requisitos": "..." },
  "plano_b": { "titulo": "...", "descricao": "...", "fundamento_legal": "...", "probabilidade": "alta|media|baixa", "pre_requisitos": "..." },
  "riscos": [{ "tipo": "...", "descricao": "...", "severidade": "alta|media|baixa", "como_mitigar": "..." }],
  "perguntas_faltantes": [{ "pergunta": "...", "motivo": "..." }],
  "checklist_documentos": [{ "documento": "...", "classificacao": "indispensavel|recomendavel", "status": "fornecido|incompleto|faltante", "observacao": "..." }],
  "estrategia_probatoria": { "pericia": "...", "testemunhas": "...", "oficios": "...", "documentais": "..." },
  "acoes_sugeridas": [{ "tipo_peca": "...", "label": "...", "descricao": "...", "prioridade": 1 }],
  "resumo_didatico": "Parágrafo de 4-6 linhas resumindo a situação em linguagem acessível."
}

## REGRAS
- Cite APENAS legislação que você tem CERTEZA que existe
- NÃO invente números de processos, súmulas ou artigos
- Avalie TODOS os caminhos previdenciários possíveis (BPC/LOAS, incapacidade, concessão, restabelecimento, revisão, pensão, etc.)
`.trim();
}
```

### 5.2 Prompt: Geração de peça (Petição Inicial Previdenciária)

```typescript
// src/lib/prompts/pecas/previdenciario/peticao-inicial.ts

export function buildPromptPeticaoInicialPrev(dados: {
  analise?: any;
  transcricao: string;
  pedido_especifico?: string;
  documentos: Array<{ tipo: string; texto_extraido: string; dados_extraidos: any; file_name: string }>;
}): string {
  return `
Você é um advogado previdenciarista experiente redigindo uma Petição Inicial.

## CONTEXTO
${dados.analise ? `### Análise jurídica prévia:\n${JSON.stringify(dados.analise, null, 2)}` : '### Sem análise prévia.'}

### Transcrição: ${dados.transcricao}
### Pedido específico: ${dados.pedido_especifico || "Nenhum."}
### Documentos: ${dados.documentos.map(d => `- ${d.file_name} (${d.tipo})`).join('\n')}

## ESTRUTURA OBRIGATÓRIA
1. Endereçamento (Vara Federal / JEF)
2. Qualificação do Autor
3. Qualificação do Réu (INSS)
4. Dos Fatos
5. Do Direito (Lei 8.213/91, Decreto 3.048/99, CF/88)
6. Da Tutela de Urgência (se aplicável)
7. Dos Pedidos (lista numerada)
8. Das Provas
9. Do Valor da Causa
10. Requerimentos Finais
11. Fechamento

## REGRAS
- Use APENAS fatos dos dados disponíveis
- NÃO invente jurisprudência — marque com [VERIFICAR] se necessário
- Marque com [PREENCHER] dados faltantes
- Linguagem técnica jurídica formal

Responda com a petição completa em Markdown.
`.trim();
}
```

### 5.3 Prompt: Refinar com documentos

```typescript
// src/lib/prompts/refinamento/refinar-com-documentos.ts

export function buildPromptRefinar(dados: {
  peca_atual: string;
  documentos_novos: Array<{ tipo: string; texto_extraido: string; dados_extraidos: any; file_name: string }>;
  documentos_anteriores: Array<{ tipo: string; file_name: string }>;
}): string {
  return `
Você é um advogado revisor. Cruze a peça com os NOVOS DOCUMENTOS.

## PEÇA ATUAL
${dados.peca_atual}

## NOVOS DOCUMENTOS
${dados.documentos_novos.map((d, i) => `--- ${d.file_name} (${d.tipo}) ---\n${d.texto_extraido}\nDados: ${JSON.stringify(d.dados_extraidos)}`).join('\n\n')}

## TAREFA
1. Confirme ou corrija datas, valores, nomes e fatos
2. Fortaleça argumentação com dados dos documentos
3. Ajuste pedidos se necessário
4. Aponte divergências entre fala do cliente e documentos

## RESPOSTA EM JSON:
{
  "peca_refinada": "Markdown da peça atualizada",
  "mudancas": [{ "tipo": "correcao|fortalecimento|novo_pedido|divergencia", "descricao": "...", "documento_fonte": "..." }],
  "divergencias": [{ "fato_transcricao": "...", "fato_documento": "...", "recomendacao": "..." }]
}
`.trim();
}
```

### 5.4 Prompt: Revisar e validar

```typescript
// src/lib/prompts/validacao/revisar-validar.ts

export function buildPromptRevisarValidar(dados: {
  peca: string;
  area: string;
  tipo_peca: string;
  analise?: any;
}): string {
  return `
Você é um revisor jurídico rigoroso. Produza um RELATÓRIO DE VALIDAÇÃO.

## PEÇA (${dados.tipo_peca} — ${dados.area})
${dados.peca}

## CHECKLIST — classifique cada item como: validado | parcial | nao_validado | inconsistente

1. COERÊNCIA: fatos consistentes? fundamentos sustentam pedidos? datas/valores corretos?
2. ITENS ESSENCIAIS: endereçamento, qualificação, fatos, fundamento, pedidos, valor causa, justiça gratuita, provas?
3. LEGISLAÇÃO: cada artigo/lei citado existe? é pertinente? está vigente?
4. JURISPRUDÊNCIA: cada referência parece real? é pertinente?
5. DOUTRINA: referências verificáveis?

## RESPOSTA EM JSON:
{
  "coerencia":        { "status": "...", "itens": [{ "item": "...", "status": "...", "localizacao": "...", "sugestao": "..." }] },
  "itens_essenciais": { "status": "...", "itens": [{ "item": "...", "status": "...", "observacao": "..." }] },
  "legislacao":       { "status": "...", "citacoes": [{ "referencia": "...", "status": "...", "sugestao": "..." }] },
  "jurisprudencia":   { "status": "...", "citacoes": [{ "referencia": "...", "status": "...", "sugestao": "..." }] },
  "doutrina":         { "status": "...", "citacoes": [{ "referencia": "...", "status": "...", "sugestao": "..." }] },
  "score_confianca": 0-100,
  "correcoes_sugeridas": [{ "tipo": "remover_citacao|substituir_fundamento|ajustar_pedido|completar_item|reescrever_fatos", "descricao": "...", "trecho_atual": "...", "sugestao": "...", "prioridade": "alta|media|baixa" }]
}
`.trim();
}
```

---

## 6. TELAS — WIREFRAMES

### TELA 1: Home (Cards das áreas)
```
┌─────────────────────────────────────────────────────────────┐
│  🏛 Advogado Virtual                      Dr. João ▼  🔔   │
├──────┬──────────────────────────────────────────────────────┤
│ 🏠   │  Escolha a área do Direito                           │
│ Home │                                                      │
│ 👥   │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│Client│  │🛡Previdenciár│  │💼 Trabalhista│  │⚖ Cível    │ │
│ 📋   │  │  [Acessar →] │  │  [Acessar →] │  │  Em breve  │ │
│Histor│  └──────────────┘  └──────────────┘  └────────────┘ │
│ ⚙    │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│Config│  │🔨 Criminal   │  │💰 Tributário │  │🏢Empresarial│
│      │  │  Em breve     │  │  Em breve    │  │  Em breve  │ │
│      │  └──────────────┘  └──────────────┘  └────────────┘ │
│      │                                                      │
│      │  📊 Últimos atendimentos:                            │
│      │  Maria S. — Aposentadoria — 19/02 — caso_novo        │
│      │  José P. — Auxílio doença — 18/02 — peca_gerada      │
└──────┴──────────────────────────────────────────────────────┘
```

### TELA 2: Painel da Área (3 grupos fixos)
```
┌─────────────────────────────────────────────────────────────┐
│  ← Home    Previdenciário                                   │
├──────┬──────────────────────────────────────────────────────┤
│      │ ┌─ ⚡ Peças com IA ─────────────────────────────────┐│
│      │ │ [Petição Inicial] [Contestação] [Réplica]         ││
│      │ │ [Apelação] [Agravo] [Embargos] [Rec. Especial]   ││
│      │ │ [Tutela] [Cumprimento] [Contrarrazões]            ││
│      │ └───────────────────────────────────────────────────┘│
│      │ ┌─ 📄 Modelos Prontos ─────────────────────────────┐│
│      │ │ [Procuração] [Contrato Honorários]                ││
│      │ │ [Substabelecimento] [Declaração Hipossuf.]        ││
│      │ └───────────────────────────────────────────────────┘│
│      │ ┌─ 🧠 Consultoria / Análise IA ────────────────────┐│
│      │ │ [Análise de Caso] [Parecer] [Estratégia]          ││
│      │ └───────────────────────────────────────────────────┘│
└──────┴──────────────────────────────────────────────────────┘
```

### TELA 3: Atendimento Unificado (componente central)
```
┌─────────────────────────────────────────────────────────────┐
│  ← Previdenciário > Peças > Petição Inicial                 │
├──────┬──────────────────────────────────────────────────────┤
│      │ ┌─ CLIENTE ────────────────────────────────────────┐ │
│      │ │ [Buscar cliente... ▼]  ou  [+ Novo cliente]      │ │
│      │ └──────────────────────────────────────────────────┘ │
│      │ ┌─ REGISTRO DO ATENDIMENTO ────────────────────────┐ │
│      │ │ [🎙 Gravar]  [⌨ Digitar]                         │ │
│      │ │ Transcrição: (editável)                           │ │
│      │ │ ┌──────────────────────────────────────────┐      │ │
│      │ │ │ Cliente relatou que trabalhou como...     │      │ │
│      │ │ └──────────────────────────────────────────┘      │ │
│      │ │ Pedido específico: (opcional)                     │ │
│      │ │ ┌──────────────────────────────────────────┐      │ │
│      │ │ │ Verificar aposentadoria por tempo         │      │ │
│      │ │ └──────────────────────────────────────────┘      │ │
│      │ └──────────────────────────────────────────────────┘ │
│      │ ┌─ DOCUMENTOS ────────────────────────────────────┐  │
│      │ │ [📎 Anexar]                                      │  │
│      │ │ 📄 CNIS_Maria.pdf [CNIS ▼]               [x]    │  │
│      │ │ 📄 Indeferimento.pdf [Indeferimento ▼]    [x]    │  │
│      │ └──────────────────────────────────────────────────┘  │
│      │ ┌─ AÇÕES ─────────────────────────────────────────┐  │
│      │ │ ┌────────────────────────────────────────────┐   │  │
│      │ │ │ 🧠 CASO NOVO — ANÁLISE JURÍDICA            │   │  │
│      │ │ └────────────────────────────────────────────┘   │  │
│      │ │ ┌────────────────────────────────────────────┐   │  │
│      │ │ │ ⚡ GERAR PETIÇÃO INICIAL                    │   │  │
│      │ │ └────────────────────────────────────────────┘   │  │
│      │ └──────────────────────────────────────────────────┘  │
│      │ ┌─ COMANDOS RÁPIDOS ──────────────────────────────┐  │
│      │ │ [📋 Timeline] [📝 Docs] [❓ Perguntas]          │  │
│      │ │ [💡 Sugestão] [⚠ Riscos]                        │  │
│      │ └──────────────────────────────────────────────────┘  │
│      │ [Salvar rascunho]                                     │
└──────┴──────────────────────────────────────────────────────┘
```

### TELA 4: Peça Gerada (com painel lateral dobrável)
```
┌───────────────────────────────────────────────────────────────────┐
│  ← Atendimento > Petição Inicial           v1 | Rascunho        │
├──────┬──────────────────────────┬────────────────────────────────┤
│      │ EXCELENTÍSSIMO SENHOR   │ ≡ PAINEL                       │
│      │ JUIZ FEDERAL DA __ VARA │ ┌─ RESUMO ─────────────────┐   │
│      │                          │ │ Aposentadoria por tempo  │   │
│      │ MARIA DA SILVA...        │ │ DER: 15/03/2024         │   │
│      │                          │ └─────────────────────────┘   │
│      │ I — DOS FATOS            │ ┌─ ALERTAS ───────────────┐   │
│      │ ...                      │ │ ⚠ 1 campo [PREENCHER]  │   │
│      │ (editor markdown)        │ │ ⚠ 1 ref [VERIFICAR]    │   │
│      │                          │ └─────────────────────────┘   │
│      │                          │ ┌─ PENDÊNCIAS ────────────┐   │
│      │                          │ │ 📄 CTPS não anexada     │   │
│      │                          │ │ 📄 PPP faltante         │   │
│      │                          │ └─────────────────────────┘   │
├──────┴──────────────────────────┴────────────────────────────────┤
│ [📎 Refinar c/ docs] [✓ Revisar e validar]                      │
│ [💪 Fortalecer]      [⚡ Tutela]                                 │
│ [💾 Salvar]  [📥 Baixar DOCX]  [📥 Baixar PDF]                  │
└──────────────────────────────────────────────────────────────────┘
```

### TELA 5: Relatório de Validação
```
┌─────────────────────────────────────────────────────────────┐
│  Revisão e Validação — Petição Inicial       Score: 78/100  │
├─────────────────────────────────────────────────────────────┤
│ ┌─ COERÊNCIA ──────────────────────────────── ✅ Validado ┐│
│ │ ✅ Fatos consistentes                                    ││
│ │ ⚠️ Data diverge (peça: 2010 / CNIS: 2011)               ││
│ │ [🔧 Corrigir automaticamente]                            ││
│ └──────────────────────────────────────────────────────────┘│
│ ┌─ ITENS ESSENCIAIS ──────────────────────── ⚠️ Parcial  ┐│
│ │ ✅ Endereçamento ✅ Qualificação ❌ Valor da causa       ││
│ │ [🔧 Completar itens obrigatórios]                        ││
│ └──────────────────────────────────────────────────────────┘│
│ ┌─ LEGISLAÇÃO ─────────────────────────────── ✅ Validado ┐│
│ │ ✅ Art. 201, §7º, CF/88  ✅ Art. 52, Lei 8.213/91       ││
│ └──────────────────────────────────────────────────────────┘│
│ ┌─ JURISPRUDÊNCIA ─────────────────────────── ⚠️ Parcial ┐│
│ │ ✅ Súmula 44 TNU  ❌ "REsp 1.352.721/SP" não verificável││
│ │ [🔧 Remover citação] [🔧 Substituir fundamento]          ││
│ └──────────────────────────────────────────────────────────┘│
│ ┌─ CORREÇÕES AUTOMÁTICAS ──────────────────────────────────┐│
│ │ [Remover citação não validada]                            ││
│ │ [Substituir por fundamento legal]                         ││
│ │ [Ajustar pedidos incoerentes]                             ││
│ │ [Completar itens obrigatórios da área]                    ││
│ │ [Reescrever fatos com base nos documentos]                ││
│ └──────────────────────────────────────────────────────────┘│
│ [← Voltar à peça]    [Aplicar todas as correções]           │
└─────────────────────────────────────────────────────────────┘
```

### TELA 6: Dossiê do Cliente
```
┌─────────────────────────────────────────────────────────────┐
│  ← Clientes    Maria da Silva                   [Editar]    │
├──────┬──────────────────────────────────────────────────────┤
│      │ CPF: ***.456.***-** | Tel: (11) 99999-0000           │
│      │ [+ Novo Atendimento]                                 │
│      │                                                      │
│      │ 📁 Atendimento 19/02/2026 — Previdenciário           │
│      │ │  Status: caso_novo                                 │
│      │ ├── 🎙 Transcrição (15 min)                          │
│      │ ├── 📄 CNIS_Maria.pdf                                │
│      │ ├── 📄 Indeferimento.pdf                             │
│      │ ├── 🧠 Análise jurídica (19/02 14:30)                │
│      │ ├── 📝 Petição Inicial v2 (score 85)                 │
│      │ │   ├── v1 — geração (19/02 14:45)                   │
│      │ │   └── v2 — refinada (19/02 15:10)                  │
│      │ └── 📥 Exportação DOCX (19/02 15:15)                 │
│      │                                                      │
│      │ 📁 Atendimento 10/01/2026 — Previdenciário           │
│      │ │  Status: finalizado                                │
│      │ ├── 🎙 Transcrição (8 min)                           │
│      │ └── 📥 Exportação DOCX (10/01 11:00)                 │
└──────┴──────────────────────────────────────────────────────┘
```

---

## 7. PERMISSÕES POR ROLE (RBAC)

```typescript
// src/lib/rbac.ts

export const PERMISSOES = {
  admin: {
    clientes: ['criar','ver','editar','excluir'], atendimentos: ['criar','ver','editar','excluir'],
    analise: ['gerar','ver'], pecas: ['gerar','ver','editar','refinar','validar','exportar','excluir'],
    modelos: ['criar','ver','editar','preencher','excluir'], equipe: ['convidar','ver','editar_role','remover'],
    configuracoes: ['ver','editar'], uso_ia: ['ver'], auditoria: ['ver'],
  },
  advogado: {
    clientes: ['criar','ver','editar'], atendimentos: ['criar','ver','editar'],
    analise: ['gerar','ver'], pecas: ['gerar','ver','editar','refinar','validar','exportar'],
    modelos: ['ver','preencher'], equipe: [], configuracoes: [], uso_ia: [], auditoria: [],
  },
  revisor: {
    clientes: ['ver'], atendimentos: ['ver'], analise: ['ver'],
    pecas: ['ver','validar','exportar'], modelos: ['ver'],
    equipe: [], configuracoes: [], uso_ia: [], auditoria: [],
  },
  estagiario: {
    clientes: ['criar','ver','editar'], atendimentos: ['criar','ver','editar'],
    analise: ['gerar','ver'], pecas: ['ver'],
    modelos: ['ver','preencher'], equipe: [], configuracoes: [], uso_ia: [], auditoria: [],
  },
} as const;
```

---

## 8. FASES DE ENTREGA

### FASE 1 — MVP VENDÁVEL (Semanas 1-6)

```
Sprint 1 (Semana 1-2): Fundação + Navegação
  [ ] Setup: Next.js 14 + App Router + Tailwind + shadcn/ui
  [ ] Supabase: projeto + migrations
  [ ] Auth: login/registro
  [ ] Layout: AppShell + Header + Sidebar
  [ ] Home: cards das 6 áreas (4 com "em breve")
  [ ] Painel da área: 3 grupos fixos (Prev + Trab)
  [ ] CRUD Clientes
  [ ] Middleware: auth + tenant + RBAC

Sprint 2 (Semana 3-4): Atendimento + Transcrição + Documentos
  [ ] Tela de atendimento unificada
  [ ] Seletor/criador de cliente inline
  [ ] Gravação de áudio (MediaRecorder + upload Storage)
  [ ] Integração Whisper API (server-side)
  [ ] Aba "Digitar"
  [ ] Edição da transcrição
  [ ] Campo "Pedido específico"
  [ ] Upload de documentos com classificação
  [ ] Extração de texto de PDF
  [ ] Salvamento automático como "caso_novo"
  [ ] Histórico de atendimentos

Sprint 3 (Semana 5-6): IA + Peças + Validação + Export
  [ ] Integração Anthropic API (streaming SSE)
  [ ] "Caso novo – análise jurídica" (Prev + Trab)
  [ ] Tela de análise com todos os cards
  [ ] Ações sugeridas (botões dinâmicos)
  [ ] Geração de peça (Petição Inicial + Contestação)
  [ ] Tela de peça: editor + painel lateral
  [ ] 5 Comandos rápidos principais
  [ ] "Refinar com documentos"
  [ ] "Revisar e validar" + relatório
  [ ] 3 Botões de correção automática
  [ ] Exportação DOCX
  [ ] Dossiê do cliente (árvore)
  [ ] Log de uso da IA
  [ ] Deploy: Vercel + Supabase
```

### FASE 2 — TODOS OS TIPOS DE PEÇA + MODELOS (Semanas 7-10)
```
[ ] Todos os tipos de peça (Prev: 10, Trab: 11)
[ ] Prompts especializados por tipo
[ ] Modelos prontos: Procuração, Contrato, Substabelecimento
[ ] Engine de templates ({{placeholders}} + campos guiados)
[ ] Exportação PDF
[ ] Áudio salvo com player de reprodução
```

### FASE 3 — EXTRAÇÃO PRECISA (Semanas 11-14)
```
[ ] OCR para PDFs escaneados
[ ] Parser por tipo de documento (CNIS, Indeferimento, CTPS, TRCT, etc.)
[ ] Ficha de dados extraídos (editável + confirmar)
[ ] NER jurídico na transcrição
```

### FASE 4 — MULTI-TENANT + BILLING (Semanas 15-20)
```
[ ] Cadastro self-service de escritório
[ ] Convite por email
[ ] Roles completos
[ ] Dashboard admin
[ ] Planos/billing (Stripe)
[ ] LGPD (consentimento, retenção)
[ ] Auditoria completa
```

### FASE 5 — NOVAS ÁREAS + AVANÇADO (Semanas 21+)
```
[ ] Cível, Criminal, Tributário, Empresarial
[ ] RAG com jurisprudência (embeddings)
[ ] Validação de legislação contra base atualizada
[ ] Workflow de aprovação
[ ] Integração PJe
[ ] App mobile (PWA)
[ ] Relatórios gerenciais
```

---

## 9. REQUISITOS NÃO-FUNCIONAIS

- **Segurança:** TLS 1.3, AES-256 dados sensíveis, RLS Supabase, chave IA server-only, bcrypt senhas, URLs assinadas, logs imutáveis
- **Performance:** Análise < 30s (streaming), Peça < 45s (streaming), Upload < 10s/5MB
- **Escala:** 50 usuários simultâneos Fase 1; 500+ Fase 4
- **Disponibilidade:** 99.5% (Vercel + Supabase managed), backups diários

---

## 10. SETUP INICIAL

```bash
npx create-next-app@latest advogado-virtual --typescript --tailwind --eslint --app --src-dir
cd advogado-virtual
npm install @supabase/supabase-js @supabase/ssr @anthropic-ai/sdk next-auth docx pdf-parse sharp zod zustand
npx shadcn@latest init
npx shadcn@latest add button card input textarea label select dialog toast tabs badge separator alert scroll-area dropdown-menu avatar sheet tooltip progress collapsible command popover
npx supabase init && npx supabase db push
```

### .env.local
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
ANTHROPIC_MAX_TOKENS=8192
OPENAI_API_KEY=sk-xxx
NEXTAUTH_SECRET=xxx
NEXTAUTH_URL=http://localhost:3000
ENCRYPTION_KEY=xxx
APP_ENV=development
```

---

## 11. NOTAS PARA O DESENVOLVEDOR

1. **Streaming é obrigatório.** Toda chamada de IA usa streaming SSE. Nunca fazer o usuário esperar olhando tela em branco.

2. **Prompts são código versionado.** Cada prompt em arquivo TypeScript próprio, com função tipada. Testar com casos reais antes de deploy.

3. **"Caso novo – análise jurídica" é o diferencial.** Investir pesado em prompt engineering aqui. É o que converte novato em usuário fiel.

4. **Salvar sempre, perguntar nunca.** Auto-save a cada interação significativa. Nunca perder dados.

5. **Botões > prompts.** Usuário nunca escreve prompt. Tudo via botões com prompt interno.

6. **Validação é segurança jurídica.** "Revisar e validar" + botões de correção automática são essenciais.

7. **Custo estimado por operação (Sonnet):** Análise ~$0.05-0.15 | Peça ~$0.10-0.30 | Refinamento ~$0.08-0.20 | Validação ~$0.05-0.15 | Comando ~$0.02-0.08

8. **Testes:** 5 casos reais anonimizados por área antes de cada entrega.

9. **Ordem de build no Sprint 3:** (1) infra IA → (2) análise prev → (3) petição inicial → (4) comandos rápidos → (5) refinar → (6) validar → (7) DOCX → (8) repetir para trabalhista
