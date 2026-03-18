-- ═══════════════════════════════════════════════════════
-- NEXOR — Migration: Coluna ativo
-- Execute no Railway/Supabase SQL Editor
-- ═══════════════════════════════════════════════════════

-- Adiciona coluna ativo se não existir (DEFAULT TRUE para novos usuários)
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE;

-- Corrige usuários existentes que ficaram com NULL
UPDATE usuarios SET ativo = TRUE WHERE ativo IS NULL;

-- Verificação
SELECT ativo, COUNT(*) FROM usuarios GROUP BY ativo;
