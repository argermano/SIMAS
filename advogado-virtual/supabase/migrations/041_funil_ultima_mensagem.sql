-- ============================================================
-- 041_funil_ultima_mensagem.sql
-- Última interação do WhatsApp no card do lead (sistema fechado,
-- interação cliente↔escritório, visível só para usuários autenticados sob RLS).
-- Aditiva. O ai-attendant passa a enviar o texto via PATCH by-phone / POST leads.
-- ============================================================

ALTER TABLE funil_leads
  ADD COLUMN IF NOT EXISTS ultima_mensagem       TEXT,
  ADD COLUMN IF NOT EXISTS ultima_mensagem_em    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ultima_mensagem_autor TEXT
    CHECK (ultima_mensagem_autor IN ('cliente', 'atendente', 'ia'));

COMMENT ON COLUMN funil_leads.ultima_mensagem IS 'Última mensagem trocada no atendimento (truncada); só metadado de contato, sem dossiê do caso.';
