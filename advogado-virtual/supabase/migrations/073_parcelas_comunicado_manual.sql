-- ============================================================
-- 073_parcelas_comunicado_manual.sql — guarda de idempotência do
-- envio manual de cobrança (achado 31 da auditoria 2026-07-21).
-- O POST /api/financeiro/parcelas/[id]/comunicar envia a cobrança
-- por WhatsApp sob demanda. Sem guarda, um reenvio da request (retry
-- de rede / clique repetido pós-502) dispara a MESMA sequência 2x.
-- Este marcador registra o instante do último envio manual e sustenta
-- um claim atômico de janela curta (barra só a corrida; o reenvio
-- DELIBERADO depois da janela continua permitido — ato humano).
-- IMPORTANTE: coluna PRÓPRIA, separada de aviso_d3_em/aviso_d0_em — o
-- envio manual NÃO consome os avisos automáticos D-3/D-0 do cron
-- (decisão do dono, route.ts:12-19).
-- ============================================================

ALTER TABLE parcelas
  ADD COLUMN IF NOT EXISTS comunicado_manual_em TIMESTAMPTZ;

COMMENT ON COLUMN parcelas.comunicado_manual_em IS
  'Instante do último envio manual de cobrança (guarda de idempotência, achado 31). Separado de aviso_d3_em/aviso_d0_em: NÃO consome os avisos automáticos.';
