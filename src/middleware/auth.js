// src/middleware/auth.js
// ─────────────────────────────────────────────────────────
// Middleware de autenticação JWT
// Toda rota privada passa por aqui ANTES de executar
// Se o token for inválido/expirado → bloqueia na hora
// ─────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken')

const autenticar = (req, res, next) => {
  try {
    // Token vem no header: Authorization: Bearer <token>
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        sucesso: false,
        erro: 'Token de autenticação não fornecido'
      })
    }

    const token = authHeader.split(' ')[1]

    // Verifica assinatura + expiração do token
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Injeta o userId em todos os requests — vem do TOKEN, nunca do body
    // Isso é a proteção central: o usuário não pode forjar seu próprio ID
    req.userId   = decoded.userId
    req.userPlano = decoded.plano

    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        sucesso: false,
        erro: 'Sessão expirada. Faça login novamente.',
        codigo: 'TOKEN_EXPIRADO'
      })
    }
    return res.status(401).json({
      sucesso: false,
      erro: 'Token inválido'
    })
  }
}

// Middleware para verificar plano (Pro vs Essencial)
const exigirPlano = (planosPermitidos) => (req, res, next) => {
  if (!planosPermitidos.includes(req.userPlano)) {
    return res.status(403).json({
      sucesso: false,
      erro: 'Esta funcionalidade requer um plano superior',
      upgrade_url: '/planos'
    })
  }
  next()
}

module.exports = { autenticar, exigirPlano }
