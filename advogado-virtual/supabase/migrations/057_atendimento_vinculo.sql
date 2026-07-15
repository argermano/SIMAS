-- ============================================================
-- 057_atendimento_vinculo.sql — vínculo opcional do atendimento
--
-- Pedido do dono: o atendimento (menu novo) "poderá ser linkado com um caso,
-- atendimento ou processo". Como caso e atendimento são a MESMA entidade
-- (`atendimentos`, ver 056), "caso/atendimento" = auto-referência e "processo"
-- = Fase 5 (`processos`). Modelo B (colunas FK exclusivas), igual ao vínculo da
-- tarefa (054) — mas com colunas próprias porque aqui não há legado a reusar:
--
--   vinculo_atendimento_id → atendimentos(id)  = CASO/ATENDIMENTO relacionado
--   vinculo_processo_id    → processos(id)      = PROCESSO (Fase 5)
--
-- ON DELETE SET NULL: apagar o alvo zera a coluna (vínculo "some", sem órfão).
-- CHECKs garantem: no máx. 1 não-nulo; e o atendimento não referencia a si mesmo.
-- Tudo idempotente (IF NOT EXISTS / catálogo) + COMMENTs.
-- ============================================================

ALTER TABLE atendimentos
  ADD COLUMN IF NOT EXISTS vinculo_atendimento_id UUID REFERENCES atendimentos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vinculo_processo_id    UUID REFERENCES processos(id)    ON DELETE SET NULL;

-- No máximo UM vínculo por atendimento (caso/atendimento OU processo).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_atendimentos_vinculo_unico'
  ) THEN
    ALTER TABLE atendimentos ADD CONSTRAINT chk_atendimentos_vinculo_unico CHECK (
      (CASE WHEN vinculo_atendimento_id IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN vinculo_processo_id    IS NOT NULL THEN 1 ELSE 0 END) <= 1
    );
  END IF;
END $$;

-- Defesa em profundidade: um atendimento não pode vincular-se a si mesmo
-- (o app também valida; o CHECK garante mesmo se alguém escrever direto no banco).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_atendimentos_vinculo_nao_self'
  ) THEN
    ALTER TABLE atendimentos ADD CONSTRAINT chk_atendimentos_vinculo_nao_self CHECK (
      vinculo_atendimento_id IS NULL OR vinculo_atendimento_id <> id
    );
  END IF;
END $$;

-- Índices parciais (equivalem ao "tenant + tipo + id" do modelo polimórfico).
CREATE INDEX IF NOT EXISTS idx_atendimentos_vinculo_atendimento
  ON atendimentos (tenant_id, vinculo_atendimento_id) WHERE vinculo_atendimento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_atendimentos_vinculo_processo
  ON atendimentos (tenant_id, vinculo_processo_id)    WHERE vinculo_processo_id    IS NOT NULL;

COMMENT ON COLUMN atendimentos.vinculo_atendimento_id IS 'Vínculo opcional para OUTRO caso/atendimento relacionado (auto-ref). Exclusivo com vinculo_processo_id via chk_atendimentos_vinculo_unico; nunca aponta para si mesmo (chk_atendimentos_vinculo_nao_self). Ver 057.';
COMMENT ON COLUMN atendimentos.vinculo_processo_id    IS 'Vínculo opcional para um PROCESSO/Fase 5 (processos.id). Exclusivo com vinculo_atendimento_id (057).';
