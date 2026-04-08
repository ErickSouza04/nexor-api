-- Migration: adiciona campos de produto, custo e quantidade à tabela vendas
-- Necessário para rastrear COGS e lucro real por venda

ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id),
  ADD COLUMN IF NOT EXISTS cost_price_snapshot NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS quantidade INTEGER DEFAULT 1;
