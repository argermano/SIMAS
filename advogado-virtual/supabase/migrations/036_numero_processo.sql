-- E2 — Capa do processo via DataJud.
-- Guarda o número CNJ do caso e o snapshot de metadados do DataJud (classe,
-- órgão julgador, assuntos, último movimento) — usado como contexto do caso e
-- para futura injeção na geração de peça. RLS existente do atendimento já cobre.

ALTER TABLE atendimentos
  ADD COLUMN IF NOT EXISTS numero_processo text,
  ADD COLUMN IF NOT EXISTS dados_processo  jsonb;

COMMENT ON COLUMN atendimentos.numero_processo IS 'Número único CNJ do processo (NNNNNNN-DD.AAAA.J.TR.OOOO), validado por dígito verificador.';
COMMENT ON COLUMN atendimentos.dados_processo  IS 'Snapshot de metadados do DataJud (classe, órgão, assuntos, movimentos) para o número acima.';
