-- ============================================================
-- 069_users_unidade.sql — unidade do membro (roteia o número de saída do WhatsApp)
-- Caso real: atendente logada em blumenau@ mandou mensagem do dossiê a um cliente
-- DDD 61 e saiu pelo número de BRASÍLIA — o ai-attendant roteava pelo DDD do
-- DESTINO. Correção no VPS: POST /notify aceita body.instance
-- ('whatsapp-sc' | 'whatsapp-df'); no lado SIMAS, a unidade do usuário escolhe a
-- instância de saída em envios HUMANOS. Mapa: brasilia → DF; florianopolis e
-- blumenau → SC (mesmos 3 slugs das presenças — ver migration 049).
-- INVARIANTE: avisos AUTOMÁTICOS (sync/cobrança/lembretes) seguem sem instância
-- (roteia pelo DDD). null aqui = sem preferência → roteia pelo DDD do destino.
-- ============================================================

-- Lição da 066/068: coluna nova em tabela que JÁ existe sempre via ALTER explícito.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS unidade TEXT
  CHECK (unidade IN ('brasilia', 'florianopolis', 'blumenau'));

COMMENT ON COLUMN users.unidade IS
  'Unidade do membro; roteia o número de saída do WhatsApp em envios humanos (brasilia → whatsapp-df; florianopolis/blumenau → whatsapp-sc). null = sem preferência, roteia pelo DDD do destino. Admin configura em Configurações → Equipe. Ver 069 e src/lib/conversas/instancia.ts.';
