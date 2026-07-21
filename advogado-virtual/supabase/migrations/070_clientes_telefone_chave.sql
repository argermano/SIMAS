-- ============================================================
-- 070_clientes_telefone_chave.sql — chave de telefone indexável
-- Perf (auditoria "perf-by-phone"): a rota do bot by-phone/[telefone] carregava
-- TODOS os clientes do tenant a cada mensagem de WhatsApp e casava o telefone em
-- JS (O(clientes) por mensagem). Como o cadastro guarda `telefone` como TEXT com
-- máscara BR livre, não dava para casar por igualdade no banco.
--
-- A coluna gerada guarda a CHAVE do telefone — a MESMA normalização de
-- chaveTelefone() em src/lib/funil/telefone.ts (só dígitos; remove o DDI 55
-- quando o tamanho indica DDI+DDD+número, 12/13; recorta aos 11/10 finais).
-- Guardar a chave (e não os dígitos crus) dá paridade EXATA com o matching
-- antigo mesmo para cadastros fora do padrão (dois números no campo, dígito de
-- tronco etc.), comprovada por simulação contra a base real: com dígitos crus,
-- 6 clientes deixariam de casar.
-- ============================================================

-- Função IMMUTABLE espelhando chaveTelefone() de src/lib/funil/telefone.ts.
-- ATENÇÃO: a coluna gerada abaixo materializa o resultado; se esta função mudar,
-- é preciso recriar a coluna (DROP/ADD) para rematerializar — mantenha-a em
-- sincronia com o TS e nunca a altere sem isso.
CREATE OR REPLACE FUNCTION public.telefone_chave(tel TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN length(semddi) > 10 THEN right(semddi, 11) ELSE right(semddi, 10) END
  FROM (
    SELECT CASE
      -- Só remove o "55" como DDI quando o tamanho indica DDI+DDD+número (12/13).
      -- Um número de 11 dígitos começando com 55 é o DDD 55 (RS), não DDI.
      WHEN d LIKE '55%' AND length(d) IN (12, 13) THEN substr(d, 3)
      ELSE d
    END AS semddi
    FROM (SELECT regexp_replace(coalesce(tel, ''), '\D', '', 'g') AS d) t1
  ) t2;
$$;

-- Lição da 066/068/069: coluna nova em tabela que JÁ existe sempre via ALTER explícito.
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS telefone_chave TEXT
  GENERATED ALWAYS AS (public.telefone_chave(telefone)) STORED;

COMMENT ON COLUMN clientes.telefone_chave IS
  'Chave de matching do telefone (mesma semântica de chaveTelefone() em src/lib/funil/telefone.ts). Coluna GERADA para casar o telefone do WhatsApp por igualdade indexada em /api/integracao/processos/by-phone. Não editar — derivada de `telefone`.';

-- Casamento por (tenant, chave) na rota do bot (equality/.in).
CREATE INDEX IF NOT EXISTS idx_clientes_tenant_telefone_chave
  ON clientes (tenant_id, telefone_chave);
