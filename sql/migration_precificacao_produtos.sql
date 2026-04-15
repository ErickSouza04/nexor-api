-- ═══════════════════════════════════════════════════════
-- NEXOR — Migration: Precificação de Produtos
-- Cria a view produtos_precificacao como alias semântico
-- da tabela produtos, garantindo RLS e índices adequados.
-- Seguro para re-execução (idempotente).
-- ═══════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- 1. Garante que a tabela base produtos existe
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS produtos (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
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
-- 2. View: produtos_precificacao
--    Alias semântico para leitura consistente dos dados de
--    precificação — herda RLS da tabela base automaticamente.
-- ─────────────────────────────────────────
CREATE OR REPLACE VIEW produtos_precificacao AS
SELECT
  id,
  user_id,
  nome,
  custo,
  embalagem,
  taxa_percentual,
  margem_desejada,
  preco_sugerido,
  criado_em,
  atualizado_em
FROM produtos;

-- ─────────────────────────────────────────
-- 3. RLS na tabela base
-- ─────────────────────────────────────────
ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'produtos' AND policyname = 'isolamento_produtos'
  ) THEN
    CREATE POLICY isolamento_produtos ON produtos
      USING     (user_id = current_setting('app.current_user_id', true)::uuid)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);
  END IF;
END $$;

-- ─────────────────────────────────────────
-- 4. Índices (IF NOT EXISTS — re-executável)
-- ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_produtos_user_id  ON produtos(user_id);
CREATE INDEX IF NOT EXISTS idx_produtos_nome     ON produtos(user_id, LOWER(nome));

-- ─────────────────────────────────────────
-- 5. Trigger para atualizar atualizado_em automaticamente
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION atualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_produtos_updated'
  ) THEN
    CREATE TRIGGER trigger_produtos_updated
      BEFORE UPDATE ON produtos
      FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════
-- Verificação (execute após rodar a migration)
-- ═══════════════════════════════════════════════════════
-- SELECT table_name, table_type
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('produtos', 'produtos_precificacao');
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'produtos'
-- ORDER BY ordinal_position;
