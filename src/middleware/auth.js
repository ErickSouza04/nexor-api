// src/middleware/auth.js
const jwt = require('jsonwebtoken')
const { query } = require('../config/database')

// ── Configuração de rótulos e preços por tipo de plano ─
const ROTULOS_PLANO = {
  trial:  'Teste Grátis',
  demo:   'Versão Demo',
  mensal: 'Plano Mensal',
  anual:  'Plano Anual',
}

const PRECOS_PLANO = {
  mensal: { valor: 'R$ 37,90',  periodo: 'mês' },
  anual:  { valor: 'R$ 247,90', periodo: 'ano' },
}

const CTA_PLANOS = {
  link_mensal: 'https://buy.stripe.com/6oU6oH5ZNcOH7AJ9qR6Na00',
  link_anual:  'https://buy.stripe.com/cNi9AT1JxcOH8ENcD36Na01',
}

// ── Calcula status do plano em tempo real ──────────────
const calcularStatusPlano = (usuario) => {
  const tipo = usuario.tipo_plano || 'trial'

  if (usuario.plano === 'ativo') {
    const preco = PRECOS_PLANO[tipo] || null
    return {
      plano:         'ativo',
      tipo_plano:    tipo,
      rotulo:        ROTULOS_PLANO[tipo] || 'Plano Ativo',
      preco:         preco?.valor || null,
      periodo:       preco?.periodo || null,
      diasRestantes: null,
      expirado:      false,
      cta_planos:    tipo === 'demo' ? CTA_PLANOS : null,
    }
  }

  if (usuario.plano === 'cancelado') {
    return {
      plano:         'cancelado',
      tipo_plano:    tipo,
      rotulo:        'Plano Cancelado',
      preco:         null,
      periodo:       null,
      diasRestantes: 0,
      expirado:      true,
    }
  }

  // trial ou expirado — recalcula sempre
  const inicio = new Date(usuario.trial_inicio)
  const agora = new Date()
  const diasPassados = Math.floor((agora - inicio) / (1000 * 60 * 60 * 24))
  const diasRestantes = Math.max(0, (usuario.trial_dias || 7) - diasPassados)
  const expirado = diasRestantes === 0

  return {
    plano:         expirado ? 'expirado' : 'trial',
    tipo_plano:    'trial',
    rotulo:        expirado ? 'Teste Expirado' : 'Teste Grátis',
    preco:         null,
    periodo:       null,
    diasRestantes,
    expirado,
  }
}

// ── Middleware principal de autenticação ───────────────
const autenticar = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ sucesso: false, erro: 'Token não fornecido' })
    }

    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Busca usuário atualizado do banco (pega plano/trial atual)
    const result = await query(
      'SELECT id, plano, tipo_plano, trial_inicio, trial_dias, ativo FROM usuarios WHERE id = $1',
      [decoded.userId]
    )

    if (!result.rows.length || !result.rows[0].ativo) {
      return res.status(401).json({ sucesso: false, erro: 'Usuário não encontrado ou inativo' })
    }

    const usuario = result.rows[0]
    const statusPlano = calcularStatusPlano(usuario)

    req.userId    = decoded.userId
    req.userPlano = statusPlano.plano
    req.diasRestantes = statusPlano.diasRestantes

    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ sucesso: false, erro: 'Sessão expirada. Faça login novamente.', codigo: 'TOKEN_EXPIRADO' })
    }
    return res.status(401).json({ sucesso: false, erro: 'Token inválido' })
  }
}

// ── Middleware que bloqueia se trial expirado ──────────
const exigirPlanoAtivo = (req, res, next) => {
  if (req.userPlano === 'expirado' || req.userPlano === 'cancelado') {
    return res.status(402).json({
      sucesso: false,
      erro: 'Seu período de teste encerrou. Assine para continuar.',
      codigo: 'TRIAL_EXPIRADO',
      plano: req.userPlano
    })
  }
  next()
}

// ── Middleware para planos específicos ─────────────────
const exigirPlano = (planosPermitidos) => (req, res, next) => {
  if (!planosPermitidos.includes(req.userPlano)) {
    return res.status(403).json({ sucesso: false, erro: 'Esta funcionalidade requer um plano superior' })
  }
  next()
}

module.exports = { autenticar, exigirPlanoAtivo, exigirPlano, calcularStatusPlano }
