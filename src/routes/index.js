// src/routes/index.js
const express = require('express')
const router  = express.Router()

const { autenticar, exigirPlanoAtivo } = require('../middleware/auth')
const {
  validarCadastro, validarLogin,
  validarVenda, validarDespesa,
  validarMeta, validarProduto,
  validarPerfil, validarUUID
} = require('../middleware/validacao')

const stockRoutes    = require('./stock')
const whatsappRoutes = require('./whatsapp')
const stripeRoutes   = require('./stripe')

const authCtrl    = require('../controllers/authController')
const vendasCtrl  = require('../controllers/vendasController')
const despesasCtrl= require('../controllers/despesasController')
const dashCtrl    = require('../controllers/dashboardController')
const metasCtrl   = require('../controllers/metasController')
const iaCtrl      = require('../controllers/iaController')
const webhookCtrl = require('../controllers/webhookController')

// ── AUTH (públicas) ──────────────────────────────────────
router.post('/auth/cadastro',        validarCadastro, authCtrl.cadastrar)
router.post('/auth/cadastrar',                        authCtrl.cadastrar)
router.post('/auth/login',           validarLogin,    authCtrl.login)
router.post('/auth/refresh',                          authCtrl.refreshToken)
router.post('/auth/logout',          autenticar,      authCtrl.logout)
router.post('/auth/recuperar-senha',                  authCtrl.recuperarSenha)
router.get ('/auth/plano',           autenticar,      authCtrl.statusPlano)

// ── STRIPE WEBHOOK ───────────────────────────────────────
// O express.raw() é aplicado em server.js (antes do express.json()) para garantir
// que o body cru (Buffer) chegue aqui intacto para validação da assinatura Stripe.
router.post('/webhooks/stripe', webhookCtrl.stripe)

// ── ADMIN (chave secreta no header) ─────────────────────
router.post('/admin/plano', webhookCtrl.ativarManual)

// ── ROTAS PRIVADAS ───────────────────────────────────────
const privado = [autenticar, exigirPlanoAtivo]

// Dashboard
router.get('/dashboard/resumo',            ...privado, dashCtrl.resumoCompleto)
router.get('/dashboard/indice',            ...privado, dashCtrl.indiceNexor)
router.get('/dashboard/comparacao',        ...privado, dashCtrl.comparacaoMeses)
router.get('/dashboard/diario',            ...privado, dashCtrl.fluxoDiario)
router.get('/dashboard/hoje',              ...privado, dashCtrl.resumoHoje)
router.get('/dashboard/ultimos-registros', ...privado, dashCtrl.ultimosRegistros)

// Vendas
router.get ('/vendas',              ...privado,               vendasCtrl.listar)
router.post('/vendas',              ...privado, validarVenda,  vendasCtrl.criar)
router.delete('/vendas/:id',        ...privado, validarUUID,   vendasCtrl.deletar)
router.get ('/vendas/resumo/dia',   ...privado,               vendasCtrl.resumoDia)
router.get ('/vendas/resumo/mes',   ...privado,               vendasCtrl.resumoMes)

// Despesas
router.get ('/despesas',            ...privado,                  despesasCtrl.listar)
router.post('/despesas',            ...privado, validarDespesa,   despesasCtrl.criar)
router.delete('/despesas/:id',      ...privado, validarUUID,      despesasCtrl.deletar)
router.get ('/despesas/resumo/mes', ...privado,                  despesasCtrl.resumoMes)

// Metas
router.get ('/metas',               ...privado,             metasCtrl.listar)
router.post('/metas',               ...privado, validarMeta, metasCtrl.salvar)

// Produtos
router.get ('/produtos',            ...privado,                 metasCtrl.listarProdutos)
router.post('/produtos',            ...privado, validarProduto,  metasCtrl.criarProduto)
router.delete('/produtos/:id',      ...privado, validarUUID,    metasCtrl.deletarProduto)

// Perfil
router.put('/usuarios/perfil',       autenticar, validarPerfil, authCtrl.atualizarPerfil)
router.patch('/usuarios/onboarding', autenticar, authCtrl.salvarOnboarding)

// Usuário logado
router.get('/users/me', autenticar, authCtrl.me)

// Nexor IA
router.post('/ia/chat',           ...privado, iaCtrl.chat)
router.post('/ia/copiloto',       ...privado, iaCtrl.copiloto)
router.post('/ia/previsao',       ...privado, iaCtrl.previsao)
router.post('/ia/insight-diario', ...privado, iaCtrl.insightDiario)

// Stripe (checkout + webhook)
router.use('/stripe', stripeRoutes)

// Estoque (plano Plus)
router.use('/stock', stockRoutes)

// WhatsApp (plano Plus)
router.use('/whatsapp', whatsappRoutes)

module.exports = router
