-- ============================================================
-- 006_atendimentos_v2.sql
-- Sprint 2: novas colunas para fluxo pivotado
-- ============================================================

-- Novas colunas em atendimentos
ALTER TABLE atendimentos
  ADD COLUMN IF NOT EXISTS tipo_peca_origem TEXT,
  ADD COLUMN IF NOT EXISTS modo_input       TEXT NOT NULL DEFAULT 'texto',
  ADD COLUMN IF NOT EXISTS audio_duracao_seg INTEGER;

-- Atualizar status default para o novo fluxo
ALTER TABLE atendimentos
  ALTER COLUMN status SET DEFAULT 'caso_novo';

-- Criar bucket de storage para uploads (áudio + documentos)
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos', 'documentos', false)
ON CONFLICT (id) DO NOTHING;

-- Política de storage: usuários autenticados podem fazer upload
CREATE POLICY "Usuários autenticados podem fazer upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'documentos');

-- Política de storage: usuários autenticados podem ler seus arquivos
CREATE POLICY "Usuários autenticados podem ler"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'documentos');

-- Política de storage: usuários autenticados podem deletar seus arquivos
CREATE POLICY "Usuários autenticados podem deletar"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'documentos');
