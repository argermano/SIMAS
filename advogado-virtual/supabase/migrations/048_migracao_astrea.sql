-- 048 — Migração de dados do Astrea (2026-07-10, decisão do dono).
-- Campos novos para a carga não perder informação: nascimento vira coluna de
-- primeira classe; todo o resto sem coluna própria vai para dados_extras (JSONB).

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS nascimento   DATE,
  ADD COLUMN IF NOT EXISTS dados_extras JSONB;

COMMENT ON COLUMN clientes.dados_extras IS
  'Dados importados/extras sem coluna própria (ex.: migração Astrea: tipo, filiação, CTPS/PIS/CNH, telefones adicionais, endereço original). Lossless.';

ALTER TABLE processos
  ADD COLUMN IF NOT EXISTS dados_extras JSONB;

COMMENT ON COLUMN processos.dados_extras IS
  'Dados importados/extras sem coluna própria (ex.: migração Astrea: pasta, papel do cliente, envolvidos, vara/foro, instância, responsável, último histórico).';
