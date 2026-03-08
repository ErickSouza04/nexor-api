// src/routes/index.js
// ─────────────────────────────────────────────────────────
// Centraliza todas as rotas da API
// ─────────────────────────────────────────────────────────
const express = require('express')
const router  = express.Router()

const { autenticar } = require('../middleware/auth')
const {
  validarCadastro, validarLogin,
  validarVenda, validarDespesa,
  validarMeta, validarProduto, validarUUID
} = require('../middleware/validacao')

const authCtrl      = require('../controllers/authController')
const vendasCtrl    = require('../controllers/vendasController')
const despesasCtrl  = require('../controllers/despesasController')
const dashCtrl      = require('../controllers/dashboardController')
const metasCtrl     = require('../controllers/metasController')

// ── AUTH (públicas) ──────────────────────────────────────
router.post('/auth/cadastro',       validarCadastro,  authCtrl.cadastrar)
router.post('/auth/login',          validarLogin,     authCtrl.login)
router.post('/auth/refresh',                          authCtrl.refreshToken)
router.post('/auth/logout',         autenticar,       authCtrl.logout)

// ── DASHBOARD (privadas) ─────────────────────────────────
router.get('/dashboard/resumo',     autenticar, dashCtrl.resumoCompleto)
router.get('/dashboard/indice',     autenticar, dashCtrl.indiceNexor)
router.get('/dashboard/comparacao', autenticar, dashCtrl.comparacaoMeses)
router.get('/dashboard/diario',     autenticar, dashCtrl.fluxoDiario)

// ── VENDAS (privadas) ────────────────────────────────────
router.get ('/vendas',              autenticar,              vendasCtrl.listar)
router.post('/vendas',              autenticar, validarVenda, vendasCtrl.criar)
router.delete('/vendas/:id',        autenticar, validarUUID,  vendasCtrl.deletar)
router.get ('/vendas/resumo/dia',   autenticar,              vendasCtrl.resumoDia)
router.get ('/vendas/resumo/mes',   autenticar,              vendasCtrl.resumoMes)

// ── DESPESAS (privadas) ──────────────────────────────────
router.get ('/despesas',            autenticar,                despesasCtrl.listar)
router.post('/despesas',            autenticar, validarDespesa, despesasCtrl.criar)
router.delete('/despesas/:id',      autenticar, validarUUID,    despesasCtrl.deletar)
router.get ('/despesas/resumo/mes', autenticar,                despesasCtrl.resumoMes)

// ── METAS (privadas) ─────────────────────────────────────
router.get ('/metas',               autenticar,             metasCtrl.listar)
router.post('/metas',               autenticar, validarMeta, metasCtrl.salvar)

// ── PRODUTOS / PRECIFICAÇÃO (privadas) ───────────────────
router.get ('/produtos',            autenticar,               metasCtrl.listarProdutos)
router.post('/produtos',            autenticar, validarProduto, metasCtrl.criarProduto)
router.delete('/produtos/:id',      autenticar, validarUUID,   metasCtrl.deletarProduto)

// ── PERFIL / USUÁRIO (privadas) ──────────────────────────
router.put('/usuarios/perfil',     autenticar, authCtrl.atualizarPerfil)
router.post('/auth/recuperar-senha',           authCtrl.recuperarSenha)

// ── NEXOR IA — proxy seguro para Claude API ──────────────
const iaCtrl = require('../controllers/iaController')
router.post('/ia/chat',     autenticar, iaCtrl.chat)
router.post('/ia/copiloto', autenticar, iaCtrl.copiloto)

module.exports = router
