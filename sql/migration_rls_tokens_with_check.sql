-- Migration: adiciona WITH CHECK na policy RLS de refresh_tokens
-- A policy isolamento_tokens no schema original não tinha WITH CHECK,
-- deixando a cláusula de escrita sem proteção explícita.

DROP POLICY IF EXISTS isolamento_tokens ON refresh_tokens;
CREATE POLICY isolamento_tokens ON refresh_tokens
  USING     (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);
