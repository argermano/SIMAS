-- 035_protecao_users_privilegios.sql
-- Impede escalonamento de privilégio pelo próprio usuário.
--
-- Motivação (A8): a policy RLS "users: gerenciar próprio" é FOR ALL USING
-- (auth_user_id = auth.uid()) sem WITH CHECK — no nível do banco, um usuário que
-- escreva direto na tabela users poderia alterar o próprio role ou tenant_id
-- (virar admin / trocar de tenant). RLS WITH CHECK não consegue comparar valor
-- antigo vs. novo; a ferramenta correta é um trigger.
--
-- Regra: se role, tenant_id ou auth_user_id mudarem numa sessão de USUÁRIO real
-- (auth.uid() IS NOT NULL), bloqueia. As rotas administrativas oficiais de
-- mudança de role usam service_role (auth.uid() IS NULL) e continuam permitidas.

CREATE OR REPLACE FUNCTION protege_colunas_privilegiadas_users()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (
       NEW.role         IS DISTINCT FROM OLD.role
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     )
  THEN
    RAISE EXCEPTION 'Alteração de role/tenant_id não permitida nesta sessão';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protege_privilegios_users ON users;
CREATE TRIGGER trg_protege_privilegios_users
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION protege_colunas_privilegiadas_users();
