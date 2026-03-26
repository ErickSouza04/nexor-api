-- ═══════════════════════════════════════════════════════
-- NEXOR — Migration: Corrige plano/tipo_plano inválidos
-- Usuários com plan='base'/'plus' mas plano/tipo_plano com
-- valores inválidos (ex: 'plus') ficam bloqueados pelo
-- calcularStatusPlano que cai no fallback de trial/expirado.
-- Execute no Railway/Supabase SQL Editor
-- ═══════════════════════════════════════════════════════

-- Corrige usuários com plano ou tipo_plano inválidos
-- (qualquer valor que não seja os reconhecidos pelo sistema)
UPDATE usuarios
SET   plano      = 'ativo',
      tipo_plano = 'mensal'
WHERE plan IN ('base', 'plus')
  AND plano NOT IN ('ativo', 'cancelado', 'trial', 'expirado');

-- Verificação
SELECT email, plan, plano, tipo_plano
FROM usuarios
WHERE email = 'testen10412@gmail.com';
