// src/routes/whatsapp.js
// ─────────────────────────────────────────────────────────
// Rotas de integração WhatsApp — requer plano Plus
// Montado em /api/whatsapp
// ─────────────────────────────────────────────────────────
const express        = require('express')
const router         = express.Router()

const { autenticar, exigirPlanoAtivo } = require('../middleware/auth')
const checkPlan      = require('../middleware/checkPlan')
const whatsappCtrl   = require('../controllers/whatsappController')

const protegido = [autenticar, exigirPlanoAtivo, checkPlan('plus')]

// Webhook: sem JWT — validado internamente por token secreto (x-whatsapp-token)
router.post('/webhook',        whatsappCtrl.handleWebhook)

// Rotas protegidas por plano Plus
router.post('/register-phone', ...protegido, whatsappCtrl.registerPhone)
router.get('/status',          ...protegido, whatsappCtrl.verificarStatus)
router.post('/send',           ...protegido, whatsappCtrl.enviarMensagem)

module.exports = router
