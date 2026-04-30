-- ═══════════════════════════════════════════════════════
-- MIGRATION: corrige DEFAULT CURRENT_DATE para usar fuso de Brasília
--
-- Problema: CURRENT_DATE no PostgreSQL usa o fuso do servidor (UTC no Railway).
-- Qualquer INSERT sem campo `data` explícito gravaria o dia UTC, não o dia BRT.
-- Na prática todos os controllers passam `data` explicitamente via getDataBrasil(),
-- mas este ALTER garante consistência como rede de segurança para paths futuros.
-- ═══════════════════════════════════════════════════════

ALTER TABLE vendas
  ALTER COLUMN data SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::DATE;

ALTER TABLE despesas
  ALTER COLUMN data SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::DATE;
