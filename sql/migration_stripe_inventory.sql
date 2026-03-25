-- ═══════════════════════════════════════════════════════
-- NEXOR — Migration: Stripe, Inventory & WhatsApp Schema
-- Execute no Supabase SQL Editor
-- ═══════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- 1. Novas colunas na tabela usuarios
-- ─────────────────────────────────────────
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS plan                   TEXT DEFAULT 'base' CHECK (plan IN ('base', 'plus')),
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT; -- já existe; IF NOT EXISTS é no-op seguro

-- ─────────────────────────────────────────
-- 2. Tabela: user_phones
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_phones (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID    REFERENCES usuarios(id) ON DELETE CASCADE,
  phone      TEXT    UNIQUE NOT NULL,
  verified   BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);

-- ─────────────────────────────────────────
-- 3. Tabela: whatsapp_sessions
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id              UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           TEXT      NOT NULL,
  user_id         UUID      REFERENCES usuarios(id) ON DELETE CASCADE,
  context         JSONB     DEFAULT '{}',
  last_intent     TEXT,
  last_message_at TIMESTAMP DEFAULT now()
);

-- ─────────────────────────────────────────
-- 4. Tabela: products (controle de estoque)
--    Separada de 'produtos' que é para precificação
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID    REFERENCES usuarios(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL,
  brand           TEXT,
  unit            TEXT    DEFAULT 'unidade',
  current_stock   NUMERIC DEFAULT 0,
  min_stock_alert NUMERIC DEFAULT 5,
  cost_price      NUMERIC,
  sale_price      NUMERIC,
  created_at      TIMESTAMP DEFAULT now()
);

-- ─────────────────────────────────────────
-- 5. Tabela: stock_movements
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_movements (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID    REFERENCES products(id) ON DELETE CASCADE,
  user_id           UUID    REFERENCES usuarios(id) ON DELETE CASCADE,
  type              TEXT    CHECK (type IN ('entrada', 'saida')),
  quantity          NUMERIC NOT NULL,
  unit_price        NUMERIC,
  source            TEXT    DEFAULT 'app' CHECK (source IN ('app', 'whatsapp')),
  raw_message       TEXT,
  linked_expense_id UUID,
  created_at        TIMESTAMP DEFAULT now()
);

-- ─────────────────────────────────────────
-- 6. Índices
-- ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_usuarios_stripe_customer  ON usuarios(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_user_phones_user_id       ON user_phones(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_user    ON whatsapp_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_phone   ON whatsapp_sessions(phone);
CREATE INDEX IF NOT EXISTS idx_products_user_id          ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product   ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_user      ON stock_movements(user_id);

-- ─────────────────────────────────────────
-- 7. Row-Level Security nas novas tabelas
-- ─────────────────────────────────────────
ALTER TABLE user_phones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements   ENABLE ROW LEVEL SECURITY;

CREATE POLICY isolamento_user_phones       ON user_phones
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY isolamento_whatsapp_sessions ON whatsapp_sessions
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY isolamento_products          ON products
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY isolamento_stock_movements   ON stock_movements
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- ═══════════════════════════════════════════════════════
-- Verificação (execute após rodar a migration)
-- ═══════════════════════════════════════════════════════
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'usuarios'
--   AND column_name IN ('plan', 'stripe_customer_id', 'stripe_subscription_id');
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('user_phones', 'whatsapp_sessions', 'products', 'stock_movements');
