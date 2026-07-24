-- ============================================================
-- 081_users_notificacoes.sql — preferências de notificação por usuário.
--
-- CONTEXTO (dono, 2026-07-24): (1) quando uma tarefa é criada, os responsáveis
-- passam a ser avisados por E-MAIL e WHATSAPP; (2) o próprio usuário decide, em
-- Perfil → Notificações, quais comunicações recebe e por quais canais.
--
-- MODELO: mapa tipo→{email:bool,whatsapp:bool}, ex.:
--   { "tarefa_atribuida": {"email":true,"whatsapp":false},
--     "resumo_diario":   {"email":false,"whatsapp":true} }
--
-- INVARIANTE: os DEFAULTS vivem NO CÓDIGO (src/lib/notificacoes/catalogo.ts) e
-- NUNCA são materializados aqui. Coluna ausente/NULL, tipo ausente ou canal
-- ausente = usa o default do catálogo. Só gravamos o que o usuário mudou (o
-- PATCH /api/perfil poda entradas iguais ao default → volta a NULL). Assim, mexer
-- num default no código passa a valer para todo mundo que não tocou aquele tipo.
--
-- Lição da 069/079: coluna nova em tabela que JÁ existe sempre via ALTER
-- explícito e idempotente. NÃO aplicar à mão (o orquestrador aplica no deploy).
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notificacoes JSONB;

COMMENT ON COLUMN users.notificacoes IS
  'Preferências de notificação do usuário: mapa tipo→{email:bool,whatsapp:bool} (ex.: {"tarefa_atribuida":{"email":true,"whatsapp":false}}). Ausente/NULL, tipo ausente ou canal ausente = usa o DEFAULT do catálogo em código (src/lib/notificacoes/catalogo.ts) — defaults NUNCA são materializados aqui. O usuário edita em Perfil → Notificações. Ver 081.';
