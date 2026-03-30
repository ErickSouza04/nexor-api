// src/routes/stock.js
// ─────────────────────────────────────────────────────────
// Rotas de controle de estoque — requer plano Plus
// Montado em /api/stock
//
// POST   /api/stock/products       — criar produto
// GET    /api/stock/products       — listar produtos
// PUT    /api/stock/products/:id   — editar produto
// POST   /api/stock/movement       — registrar entrada/saída
// GET    /api/stock/movements      — histórico de movimentações
// GET    /api/stock/low-alert      — produtos abaixo do mínimo
// ─────────────────────────────────────────────────────────
const express   = require('express')
const router    = express.Router()

const { autenticar, exigirPlanoAtivo } = require('../middleware/auth')
const checkPlan = require('../middleware/checkPlan')
const stockCtrl = require('../controllers/stockController')

const protegido = [autenticar, exigirPlanoAtivo, checkPlan('plus')]

// Produtos
router.post('/products',     ...protegido, stockCtrl.criarProduto)
router.get('/products',      ...protegido, stockCtrl.listarProdutos)
router.put('/products/:id',  ...protegido, stockCtrl.editarProduto)

// Movimentações
router.post('/movement',     ...protegido, stockCtrl.registrarMovimentacao)
router.post('/movements',    ...protegido, stockCtrl.registrarMovimentacao)
router.get('/movements',     ...protegido, stockCtrl.listarMovimentacoes)

// Alertas
router.get('/low-alert',     ...protegido, stockCtrl.alertasEstoqueBaixo)

module.exports = router
