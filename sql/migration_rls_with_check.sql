-- ═══════════════════════════════════════════════════════
-- Migration: adiciona WITH CHECK explícito nas políticas RLS
-- Problema: UPSERT (ON CONFLICT DO UPDATE) com RLS requer
-- WITH CHECK explícito para a parte de UPDATE da operação.
-- Sem ele, o PostgreSQL deriva de USING, mas pode bloquear
-- o UPDATE quando o usuário não é superuser.
-- ═══════════════════════════════════════════════════════

-- Metas
DROP POLICY IF EXISTS isolamento_metas ON metas;
CREATE POLICY isolamento_metas ON metas
  USING     (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- Vendas
DROP POLICY IF EXISTS isolamento_vendas ON vendas;
CREATE POLICY isolamento_vendas ON vendas
  USING     (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- Despesas
DROP POLICY IF EXISTS isolamento_despesas ON despesas;
CREATE POLICY isolamento_despesas ON despesas
  USING     (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- Produtos
DROP POLICY IF EXISTS isolamento_produtos ON produtos;
CREATE POLICY isolamento_produtos ON produtos
  USING     (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);
