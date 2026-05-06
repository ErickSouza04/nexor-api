-- ═══════════════════════════════════════════════════════════════════
-- NEXOR — Migração: Reestruturação de Planos (Base / Plus)
-- Novo modelo:
--   Base  → gratuito permanente, sem WhatsApp Agent
--   Plus  → 7 dias de trial a partir do upgrade, depois pago
-- ═══════════════════════════════════════════════════════════════════

-- 1. Garantir que a coluna plan existe com constraint correta
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'base';

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_plan_check;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_plan_check CHECK (plan IN ('base', 'plus'));

-- 2. Remover o DEFAULT NOW() de trial_inicio
--    (será NULL para usuários Base; preenchido apenas no upgrade para Plus)
ALTER TABLE usuarios
  ALTER COLUMN trial_inicio DROP DEFAULT;

-- 3. Limpar dados de trial de usuários que estão no plano Base
UPDATE usuarios
  SET trial_inicio = NULL,
      trial_dias   = NULL
  WHERE plan = 'base';

-- 4. Normalizar o campo plano para usuários Base existentes
--    que estejam com valores legados (plus/trial/expirado)
UPDATE usuarios
  SET plano      = 'ativo',
      tipo_plano = 'base'
  WHERE plan = 'base'
    AND plano NOT IN ('cancelado');

-- ───────────────────────────────────────────────────────────────────
-- Campos disponíveis após essa migração:
--
--   plan           TEXT    'base' | 'plus'         → tier do plano
--   plano          VARCHAR 'ativo' | 'trial' |      → status (calculado em runtime
--                          'trial_expirado' |         por calcularStatusPlano;
--                          'expirado' | 'cancelado'   apenas 'ativo'/'cancelado' são
--                                                     gravados diretamente no banco)
--   trial_inicio   TIMESTAMPTZ NULL                 → preenchido no upgrade para Plus
--   trial_dias     INTEGER     7 (default)          → duração do trial em dias
--
-- Nota: assinatura_status não é um campo separado; o campo `plano`
-- (junto com stripe_subscription_id) cobre essa semântica.
-- ───────────────────────────────────────────────────────────────────
