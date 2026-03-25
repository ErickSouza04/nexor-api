// src/middleware/checkPlan.js
// ─────────────────────────────────────────────────────────
// Verifica se o usuário possui o plano necessário para
// acessar uma rota. Deve ser usado APÓS o middleware autenticar,
// que já popula req.userPlan com o valor da coluna plan.
// ─────────────────────────────────────────────────────────

const HIERARQUIA = ['base', 'plus']

const checkPlan = (planoRequerido) => (req, res, next) => {
  const nivelUsuario   = HIERARQUIA.indexOf(req.userPlan || 'base')
  const nivelRequerido = HIERARQUIA.indexOf(planoRequerido)

  if (nivelUsuario < nivelRequerido) {
    return res.status(403).json({
      sucesso:     false,
      erro:        'Esta funcionalidade está disponível apenas no plano Plus.',
      codigo:      'PLANO_INSUFICIENTE',
      plano_atual: req.userPlan || 'base'
    })
  }

  next()
}

module.exports = checkPlan
