// src/routes/stripe.js
// ─────────────────────────────────────────────────────────
// Rotas de pagamento Stripe
//
// POST /api/stripe/checkout  — cria checkout session (requer JWT)
// POST /api/stripe/webhook   — recebe eventos do Stripe (sem JWT)
//                              express.raw() aplicado em server.js
// ─────────────────────────────────────────────────────────
const express     = require('express')
const router      = express.Router()
const { autenticar } = require('../middleware/auth')
const stripeCtrl  = require('../controllers/stripeController')

// Checkout: usuário autenticado inicia o pagamento
// Não usa exigirPlanoAtivo — o próprio checkout é para (re)ativar o plano
router.post('/checkout', autenticar, stripeCtrl.createCheckoutSession)

// Webhook: chamado diretamente pelo Stripe, sem JWT
// Body raw obrigatório — configurado via express.raw() em server.js ANTES do express.json()
router.post('/webhook', stripeCtrl.handleWebhook)

module.exports = router
