-- 008_simplificar_roles.sql
-- Migra os papéis antigos (revisor, estagiario) para os 3 papéis oficiais
-- admin | advogado | colaborador

-- revisor → advogado (tem capacidade de revisão, nível equivalente)
UPDATE users SET role = 'advogado'    WHERE role = 'revisor';

-- estagiario → colaborador
UPDATE users SET role = 'colaborador' WHERE role = 'estagiario';
