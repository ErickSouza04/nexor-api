-- ═══════════════════════════════════════════════════════
-- NEXOR — Migration: Trial + Stripe
-- Execute no Supabase SQL Editor
-- ═══════════════════════════════════════════════════════

-- 1. Colunas de trial e Stripe na tabela usuarios
ALTER TABLE usuarios 
  ADD COLUMN IF NOT EXISTS trial_inicio          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS trial_dias            INTEGER DEFAULT 7,
  ADD COLUMN IF NOT EXISTS plano_expira          TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- 2. Plano padrão vira 'trial'
ALTER TABLE usuarios ALTER COLUMN plano SET DEFAULT 'trial';

-- 3. Usuários existentes → 'ativo' (não punir quem já usava)
UPDATE usuarios 
SET plano = 'ativo' 
WHERE plano IN ('essencial', 'pro') OR plano IS NULL;

-- 4. Tabela de log do webhook Stripe
CREATE TABLE IF NOT EXISTS webhook_stripe (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evento          VARCHAR(100) NOT NULL,
  email           VARCHAR(255),
  user_id         UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  subscription_id TEXT,
  processado      BOOLEAN DEFAULT FALSE,
  criado_em       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Índices
CREATE INDEX IF NOT EXISTS idx_usuarios_plano        ON usuarios(plano);
CREATE INDEX IF NOT EXISTS idx_usuarios_trial        ON usuarios(trial_inicio);
CREATE INDEX IF NOT EXISTS idx_usuarios_stripe       ON usuarios(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_stripe_email  ON webhook_stripe(email);

-- Verificação final
SELECT plano, COUNT(*) as total FROM usuarios GROUP BY plano;
