-- ═══════════════════════════════════════════════════════
-- NEXOR — Migration: Integração Estoque ↔ Precificação
-- Vincula a tabela products (estoque) com produtos (precificação)
-- Execute no Supabase SQL Editor
-- ═══════════════════════════════════════════════════════

-- Adiciona coluna de referência em products apontando para a calculadora de preço
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS produto_id UUID REFERENCES produtos(id) ON DELETE SET NULL;

-- Índice para buscas por produto_id (propagação de preços)
CREATE INDEX IF NOT EXISTS idx_products_produto_id ON products(produto_id);
