-- migration_whatsapp_history.sql
-- Histórico de conversas WhatsApp por usuário
-- Suporta memória de contexto (últimas 10 mensagens) com limpeza automática após 2h de inatividade

CREATE TABLE IF NOT EXISTS whatsapp_conversation_history (
  id         UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  phone      TEXT      NOT NULL,
  role       TEXT      NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT      NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Índice para busca eficiente por usuário + telefone, ordenado por data
CREATE INDEX IF NOT EXISTS idx_wh_history_user_phone_date
  ON whatsapp_conversation_history (user_id, phone, created_at DESC);
