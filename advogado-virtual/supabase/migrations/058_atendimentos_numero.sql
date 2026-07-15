-- ============================================================
-- 058_atendimentos_numero.sql — número sequencial legível do atendimento (#123)
--
-- Pedido do dono: a lista /atendimentos mostra "#<numero>" por linha. Damos ao
-- atendimento um inteiro curto e estável, separado do UUID (que é longo e não
-- serve de identificador humano).
--
-- Decisão: numeração GLOBAL (não por tenant). O piloto é single-tenant, então
-- uma sequence própria é o caminho mais simples e sem corrida — nada de MAX()+1
-- na aplicação. `DEFAULT nextval` numera automaticamente todo INSERT novo (o
-- POST /api/atendimentos não precisa saber do número). O backfill respeita a
-- ordem de nascimento (created_at) para os casos já existentes.
--
-- Idempotente: IF NOT EXISTS / guardas de catálogo; re-rodar não renumera nem
-- colide (o backfill só toca linhas com numero IS NULL, com offset no MAX atual).
-- ============================================================

-- 1) Sequence dedicada (será "dona" da coluna no fim, via OWNED BY).
CREATE SEQUENCE IF NOT EXISTS atendimentos_numero_seq;

-- 2) Coluna ainda SEM default: precisamos backfillar em ordem de created_at
--    ANTES de ligar o nextval, senão o ADD COLUMN com default volátil numeraria
--    as linhas em ordem física (arbitrária).
ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS numero BIGINT;

-- 3) Backfill determinístico das linhas sem número (ordem de nascimento).
--    Offset pelo MAX atual torna o passo seguro em re-execução (sem colisão com
--    números já atribuídos por execuções anteriores ou pelo DEFAULT).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM atendimentos
  WHERE numero IS NULL
)
UPDATE atendimentos a
SET numero = (SELECT COALESCE(MAX(numero), 0) FROM atendimentos) + r.rn
FROM ranked r
WHERE a.id = r.id;

-- 4) Alinha a sequence: próximo nextval = MAX(numero)+1 quando há linhas; = 1
--    quando a base está vazia (is_called=false ⇒ primeiro nextval devolve 1).
SELECT setval(
  'atendimentos_numero_seq',
  GREATEST((SELECT COALESCE(MAX(numero), 0) FROM atendimentos), 1),
  (SELECT COUNT(*) > 0 FROM atendimentos)
);

-- 5) Liga o DEFAULT, trava NOT NULL e garante unicidade. Todos idempotentes.
ALTER TABLE atendimentos ALTER COLUMN numero SET DEFAULT nextval('atendimentos_numero_seq');
ALTER TABLE atendimentos ALTER COLUMN numero SET NOT NULL;
ALTER SEQUENCE atendimentos_numero_seq OWNED BY atendimentos.numero;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'atendimentos_numero_key') THEN
    ALTER TABLE atendimentos ADD CONSTRAINT atendimentos_numero_key UNIQUE (numero);
  END IF;
END $$;

COMMENT ON COLUMN atendimentos.numero IS 'Número sequencial legível (#123) exibido na lista /atendimentos. Global (piloto single-tenant), gerado por atendimentos_numero_seq; backfill em ordem de created_at (058).';
