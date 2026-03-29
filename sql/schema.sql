-- ═══════════════════════════════════════════════════════
-- NEXOR — Schema do Banco de Dados
-- PostgreSQL com Row-Level Security (RLS)
-- Execute este arquivo uma única vez para criar as tabelas
-- ═══════════════════════════════════════════════════════

-- Extensão para gerar UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────
-- TABELA: usuarios
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  senha_hash    VARCHAR(255) NOT NULL,
  tipo_negocio  VARCHAR(100),
  faturamento_medio VARCHAR(100),
  meta_lucro    DECIMAL(10,2) DEFAULT 0,
  pro_labore    DECIMAL(10,2) DEFAULT 0,
  plano                 VARCHAR(50) DEFAULT 'trial',
  tipo_plano            VARCHAR(20) DEFAULT 'trial',
  trial_inicio          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  trial_dias            INTEGER DEFAULT 7,
  plano_expira          TIMESTAMP WITH TIME ZONE,
  stripe_subscription_id TEXT,
  ativo                 BOOLEAN DEFAULT TRUE,
  criado_em             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  atualizado_em         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- TABELA: refresh_tokens
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expira_em  TIMESTAMP WITH TIME ZONE NOT NULL,
  criado_em  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- TABELA: vendas
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  valor       DECIMAL(10,2) NOT NULL CHECK (valor > 0),
  categoria   VARCHAR(100) DEFAULT 'Produto',
  pagamento   VARCHAR(50)  DEFAULT 'Pix',
  produto     VARCHAR(255),
  data        DATE NOT NULL DEFAULT CURRENT_DATE,
  criado_em   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- TABELA: despesas
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS despesas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  valor       DECIMAL(10,2) NOT NULL CHECK (valor > 0),
  categoria   VARCHAR(100) DEFAULT 'Outros',
  pagamento   VARCHAR(50)  DEFAULT 'Pix',
  descricao   TEXT,
  data        DATE NOT NULL DEFAULT CURRENT_DATE,
  criado_em   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- TABELA: metas
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  valor_meta  DECIMAL(10,2) NOT NULL CHECK (valor_meta > 0),
  mes         INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  ano         INTEGER NOT NULL CHECK (ano >= 2024),
  pro_labore  DECIMAL(10,2) DEFAULT 0,
  criado_em   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, mes, ano)  -- uma meta por mês por usuário
);

-- ─────────────────────────────────────────
-- TABELA: produtos (precificação)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS produtos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome            VARCHAR(255) NOT NULL,
  custo           DECIMAL(10,2) NOT NULL CHECK (custo >= 0),
  embalagem       DECIMAL(10,2) DEFAULT 0,
  taxa_percentual DECIMAL(5,2)  DEFAULT 0,
  margem_desejada DECIMAL(5,2)  NOT NULL CHECK (margem_desejada > 0),
  preco_sugerido  DECIMAL(10,2),
  criado_em       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  atualizado_em   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- TABELA: webhook_stripe
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_stripe (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evento          VARCHAR(100) NOT NULL,
  email           VARCHAR(255),
  user_id         UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  subscription_id TEXT,
  processado      BOOLEAN DEFAULT FALSE,
  criado_em       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_stripe_email ON webhook_stripe(email);

-- ═══════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (RLS)
-- Garante isolamento total entre usuários no nível do banco
-- Mesmo que o código tenha um bug, o banco BLOQUEIA cruzamento
-- ═══════════════════════════════════════════════════════

-- Ativar RLS em todas as tabelas de dados
ALTER TABLE vendas   ENABLE ROW LEVEL SECURITY;
ALTER TABLE despesas ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

-- Políticas: cada usuário só acessa seus próprios registros
CREATE POLICY isolamento_vendas   ON vendas
  USING     (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY isolamento_despesas ON despesas
  USING     (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY isolamento_metas    ON metas
  USING     (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY isolamento_produtos ON produtos
  USING     (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY isolamento_tokens   ON refresh_tokens
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- ═══════════════════════════════════════════════════════
-- ÍNDICES — para buscas rápidas
-- ═══════════════════════════════════════════════════════
CREATE INDEX idx_vendas_user_data    ON vendas(user_id, data DESC);
CREATE INDEX idx_vendas_user_mes     ON vendas(user_id, EXTRACT(YEAR FROM data), EXTRACT(MONTH FROM data));
CREATE INDEX idx_despesas_user_data  ON despesas(user_id, data DESC);
CREATE INDEX idx_despesas_user_mes   ON despesas(user_id, EXTRACT(YEAR FROM data), EXTRACT(MONTH FROM data));
CREATE INDEX idx_refresh_token       ON refresh_tokens(token);
CREATE INDEX idx_usuarios_email      ON usuarios(email);
CREATE INDEX idx_usuarios_plano      ON usuarios(plano);
CREATE INDEX idx_usuarios_trial      ON usuarios(trial_inicio);
CREATE INDEX idx_usuarios_stripe     ON usuarios(stripe_subscription_id);

-- ═══════════════════════════════════════════════════════
-- FUNÇÃO: atualizar timestamp automaticamente
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION atualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_usuarios_updated
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();

CREATE TRIGGER trigger_produtos_updated
  BEFORE UPDATE ON produtos
  FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();
