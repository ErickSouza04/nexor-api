// src/middleware/checkPlan.js
// ─────────────────────────────────────────────────────────
// Verifica se o usuário possui o plano necessário para
// acessar uma rota. Deve ser usado APÓS o middleware autenticar,
// que já popula req.userPlan e req.userPlano.
// ─────────────────────────────────────────────────────────

const HIERARQUIA = ['base', 'plus']

const checkPlan = (planoRequerido) => (req, res, next) => {
  // Plus com trial expirado tem acesso efetivo de Base
  const planoEfetivo = req.userPlano === 'trial_expirado' ? 'base' : (req.userPlan || 'base')

  const nivelUsuario   = HIERARQUIA.indexOf(planoEfetivo)
  const nivelRequerido = HIERARQUIA.indexOf(planoRequerido)

  if (nivelUsuario < nivelRequerido) {
    return res.status(403).json({
      erro:      'recurso_plus',
      mensagem:  'Disponível no Nexor Plus',
    })
  }

  next()
}

module.exports = checkPlan
