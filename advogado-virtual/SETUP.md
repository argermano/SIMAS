# Guia de Instalação — Advogado Virtual (Sprint 1 + Sprint 2)

> Siga este guia passo a passo. Cada etapa é obrigatória.

---

## PASSO 1 — Instalar Node.js

1. Acesse **https://nodejs.org**
2. Clique em **"LTS"** (versão recomendada — botão verde à esquerda)
3. Baixe e instale o arquivo `.msi` normalmente
4. Após instalar, abra o **Prompt de Comando** (tecle `Win + R`, digite `cmd`, pressione Enter)
5. Digite: `node --version` e pressione Enter
   - Deve aparecer algo como: `v22.x.x`
6. Digite: `npm --version` e pressione Enter
   - Deve aparecer algo como: `10.x.x`

---

## PASSO 2 — Criar projeto no Supabase

1. Acesse **https://supabase.com** e faça login
2. Clique em **"New project"**
3. Preencha:
   - **Name:** `advogado-virtual`
   - **Database Password:** anote esta senha com segurança
   - **Region:** South America (São Paulo) — `sa-east-1`
4. Clique em **"Create new project"** e aguarde (pode demorar 2-3 minutos)
5. Após criar, acesse **Settings → API**:
   - Copie a **Project URL**: `https://xxxxx.supabase.co`
   - Copie a **anon / public key**
   - Copie a **service_role key** (seção abaixo)

---

## PASSO 3 — Configurar variáveis de ambiente

1. Abra a pasta `advogado-virtual/` no explorador de arquivos
2. Copie o arquivo `.env.local.example` e renomeie a cópia para `.env.local`
3. Abra `.env.local` com o Bloco de Notas e preencha:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_anon_key_aqui
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key_aqui

ANTHROPIC_API_KEY=sk-ant-sua_chave_aqui   # obtenha em console.anthropic.com
ANTHROPIC_MODEL=claude-sonnet-4-6

GROQ_API_KEY=gsk_sua_chave_aqui           # obtenha em console.groq.com (transcrição de áudio)

NEXTAUTH_SECRET=qualquer_texto_longo_e_aleatorio_aqui
NEXTAUTH_URL=http://localhost:3000
APP_ENV=development
ENCRYPTION_KEY=outro_texto_longo_e_aleatorio_aqui
```

> **Groq API Key:** Acesse [console.groq.com](https://console.groq.com), crie uma conta gratuita e gere uma API Key. Ela é usada para transcrição de áudio via Whisper.

---

## PASSO 4 — Criar tabelas no banco de dados

1. No painel do Supabase, clique em **"SQL Editor"** no menu lateral
2. Execute cada arquivo SQL da pasta `supabase/migrations/` **em ordem**:

   ### 001 — Execute este SQL:
   > Copie o conteúdo de `supabase/migrations/001_tenants_users.sql` e cole no editor. Clique **"Run"**.

   ### 002 — Execute este SQL:
   > Copie o conteúdo de `supabase/migrations/002_clientes.sql` e cole. Clique **"Run"**.

   ### 003 — Execute este SQL:
   > Copie o conteúdo de `supabase/migrations/003_atendimentos_documentos.sql` e cole. Clique **"Run"**.

   ### 004 — Execute este SQL:
   > Copie o conteúdo de `supabase/migrations/004_analises_pecas.sql` e cole. Clique **"Run"**.

   ### 005 — Execute este SQL:
   > Copie o conteúdo de `supabase/migrations/005_rls_policies.sql` e cole. Clique **"Run"**.

   ### 006 — Execute este SQL (Sprint 2):
   > Copie o conteúdo de `supabase/migrations/006_atendimentos_v2.sql` e cole. Clique **"Run"**.
   > Este script adiciona colunas de áudio/modo e cria o bucket de armazenamento de arquivos.

3. Após executar todos, vá em **"Table Editor"** e verifique se as tabelas foram criadas:
   - tenants, users, clientes, atendimentos, documentos, analises, pecas, exportacoes, api_usage_log

---

## PASSO 5 — Configurar autenticação no Supabase

1. No painel do Supabase, acesse **Authentication → Providers**
2. Certifique-se que **Email** está habilitado
3. Acesse **Authentication → URL Configuration**:
   - **Site URL:** `http://localhost:3000`
   - **Redirect URLs:** adicione `http://localhost:3000/**`
4. Clique em **Save**

---

## PASSO 5.5 — Remover arquivo conflitante (OBRIGATÓRIO)

Há um arquivo que precisa ser deletado antes de rodar o projeto:

**Arquivo:** `src/app/(dashboard)/page.tsx`

**Por quê:** Ele entra em conflito com `src/app/page.tsx` (ambos servem a rota `/`).

**Como deletar:**

Opção 1 — Via VSCode: No explorador de arquivos (painel esquerdo), navegue até `src/app/(dashboard)/`, clique com o botão direito em `page.tsx` e selecione **"Delete"**.

Opção 2 — Via terminal (abra o terminal dentro da pasta `advogado-virtual/`):
```bash
# Windows PowerShell:
Remove-Item "src/app/(dashboard)/page.tsx"

# Git Bash ou terminal Linux/Mac:
rm "src/app/(dashboard)/page.tsx"
```

Confirme que o arquivo foi deletado antes de continuar.

---

## PASSO 6 — Instalar dependências e rodar

Abra o **Prompt de Comando** (ou Terminal do VSCode) dentro da pasta `advogado-virtual/`:

```bash
# Instalar todas as dependências
npm install

# Rodar em desenvolvimento
npm run dev
```

Aguarde até aparecer:
```
▲ Next.js 15.x.x
- Local:        http://localhost:3000
- Network:      http://192.168.x.x:3000
✓ Ready in Xs
```

5. Abra o navegador em **http://localhost:3000**

---

## PASSO 7 — Criar sua conta

1. Na tela de login, clique em **"Criar conta"**
2. Preencha nome, nome do escritório, e-mail e senha
3. Após criar, você será redirecionado para o dashboard
4. Seu escritório foi criado automaticamente no banco de dados

---

## Verificação — Sprint 1

| Funcionalidade            | Status |
|---------------------------|--------|
| Login e registro          | ✅     |
| Dashboard com métricas    | ✅     |
| Cadastro de clientes      | ✅     |
| Lista com busca           | ✅     |
| Dossiê do cliente         | ✅     |
| Editar cliente            | ✅     |
| Excluir cliente           | ✅     |
| Histórico de atendimentos | ✅     |
| Configurações             | ✅     |
| Sidebar responsiva        | ✅     |
| Row Level Security (RLS)  | ✅     |
| Isolamento por tenant     | ✅     |

## Verificação — Sprint 2

| Funcionalidade                              | Status |
|---------------------------------------------|--------|
| Tela de atendimento unificada               | ✅     |
| Seletor/criador de cliente inline           | ✅     |
| Gravação de áudio (MediaRecorder)           | ✅     |
| Transcrição automática (Groq Whisper)       | ✅     |
| Aba "Digitar" (modo texto)                  | ✅     |
| Edição da transcrição                       | ✅     |
| Campo "Pedido específico"                   | ✅     |
| Upload de documentos com classificação      | ✅     |
| Extração de texto de PDF (pdf-parse)        | ✅     |
| Salvamento automático como "caso_novo"      | ✅     |
| Geração de peça com IA (streaming)          | ✅     |
| Editor de peça (markdown + preview)         | ✅     |
| Validação e revisão da peça                 | ✅     |
| Exportação DOCX                             | ✅     |
| Comandos rápidos de IA                      | ✅     |
| Histórico de atendimentos com status        | ✅     |

---

## Problemas comuns

**"npm: command not found"**
→ Node.js não foi instalado corretamente. Feche e abra o terminal após instalar.

**"NEXT_PUBLIC_SUPABASE_URL is not defined"**
→ O arquivo `.env.local` não foi criado corretamente. Verifique o Passo 3.

**"Failed to load ... 401 Unauthorized"**
→ As chaves do Supabase estão incorretas. Verifique no painel do Supabase → Settings → API.

**Tabelas não encontradas no Supabase**
→ Execute os SQLs na ordem correta (001, 002, 003, 004, 005, 006).

**Transcrição de áudio retorna "[Transcrição indisponível]"**
→ A variável `GROQ_API_KEY` não está configurada no `.env.local`. Obtenha a chave em [console.groq.com](https://console.groq.com).

**Erro ao fazer upload de áudio ou documentos**
→ A migration 006 não foi executada. Execute `supabase/migrations/006_atendimentos_v2.sql` no SQL Editor do Supabase para criar o bucket de armazenamento.

**Usuário não aparece no banco após registro**
→ Verifique se a `SUPABASE_SERVICE_ROLE_KEY` está correta no `.env.local`.
