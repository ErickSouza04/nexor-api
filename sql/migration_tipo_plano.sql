-- Migration: adiciona coluna tipo_plano à tabela usuarios
-- Execute este arquivo em bancos que já existem (schema.sql já foi aplicado)

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS tipo_plano VARCHAR(20) DEFAULT 'trial';

-- Usuários com plano 'ativo' sem tipo_plano definido → considera mensal
UPDATE usuarios
  SET tipo_plano = 'mensal'
  WHERE plano = 'ativo' AND (tipo_plano IS NULL OR tipo_plano = 'trial');

-- Garante índice para buscas por tipo_plano
CREATE INDEX IF NOT EXISTS idx_usuarios_tipo_plano ON usuarios(tipo_plano);
