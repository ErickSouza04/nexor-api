// src/middleware/validacao.js
// ─────────────────────────────────────────────────────────
// Validação e sanitização de todos os inputs
// Previne dados inválidos e ataques de injeção
// ─────────────────────────────────────────────────────────
const { body, param, query, validationResult } = require('express-validator')

// Retorna os erros de validação de forma padronizada
const checarErros = (req, res, next) => {
  const erros = validationResult(req)
  if (!erros.isEmpty()) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Dados inválidos',
      detalhes: erros.array().map(e => ({ campo: e.path, mensagem: e.msg }))
    })
  }
  next()
}

// ── AUTENTICAÇÃO ─────────────────────────────────────────
const validarCadastro = [
  body('nome')
    .trim()
    .notEmpty().withMessage('Nome é obrigatório')
    .isLength({ min: 2, max: 255 }).withMessage('Nome deve ter entre 2 e 255 caracteres'),
  body('email')
    .trim()
    .notEmpty().withMessage('E-mail é obrigatório')
    .isEmail().withMessage('E-mail inválido')
    .normalizeEmail(),
  body('senha')
    .notEmpty().withMessage('Senha é obrigatória')
    .isLength({ min: 8 }).withMessage('Senha deve ter no mínimo 8 caracteres')
    .matches(/[0-9]/).withMessage('Senha deve conter pelo menos um número')
    .matches(/[^a-zA-Z0-9]/).withMessage('Senha deve conter pelo menos um caractere especial (!@#$%...)'),
  checarErros
]

const validarLogin = [
  body('email').trim().notEmpty().isEmail().normalizeEmail(),
  body('senha').notEmpty().withMessage('Senha é obrigatória'),
  checarErros
]

// ── VENDAS ───────────────────────────────────────────────
const validarVenda = [
  body('valor')
    .notEmpty().withMessage('Valor é obrigatório')
    .isFloat({ min: 0.01 }).withMessage('Valor deve ser maior que zero'),
  body('categoria')
    .optional()
    .isIn(['Produto', 'Serviço', 'Combo', 'Encomenda'])
    .withMessage('Categoria inválida'),
  body('pagamento')
    .optional()
    .isIn(['Pix', 'Dinheiro', 'Crédito', 'Débito'])
    .withMessage('Forma de pagamento inválida'),
  body('produto')
    .optional()
    .trim()
    .isLength({ max: 255 }).withMessage('Nome do produto muito longo'),
  body('data')
    .optional()
    .isDate().withMessage('Data inválida'),
  checarErros
]

// ── DESPESAS ─────────────────────────────────────────────
const validarDespesa = [
  body('valor')
    .notEmpty().withMessage('Valor é obrigatório')
    .isFloat({ min: 0.01 }).withMessage('Valor deve ser maior que zero'),
  body('categoria')
    .optional()
    .isIn(['Matéria-prima', 'Embalagem', 'Aluguel', 'Marketing', 'Transporte', 'Outros'])
    .withMessage('Categoria inválida'),
  body('descricao')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Descrição muito longa'),
  body('data')
    .optional()
    .isDate().withMessage('Data inválida'),
  checarErros
]

// ── METAS ────────────────────────────────────────────────
const validarMeta = [
  body('valor_meta')
    .notEmpty().withMessage('Valor da meta é obrigatório')
    .isFloat({ min: 1 }).withMessage('Meta deve ser maior que zero'),
  body('mes')
    .notEmpty()
    .isInt({ min: 1, max: 12 }).withMessage('Mês inválido'),
  body('ano')
    .notEmpty()
    .isInt({ min: 2024 }).withMessage('Ano inválido'),
  body('pro_labore')
    .optional()
    .isFloat({ min: 0 }).withMessage('Pró-labore inválido'),
  checarErros
]

// ── PRODUTOS ─────────────────────────────────────────────
const validarProduto = [
  body('nome')
    .trim()
    .notEmpty().withMessage('Nome do produto é obrigatório')
    .isLength({ max: 255 }),
  body('custo')
    .notEmpty()
    .isFloat({ min: 0 }).withMessage('Custo inválido'),
  body('margem_desejada')
    .notEmpty()
    .isFloat({ min: 0.1, max: 99.9 }).withMessage('Margem deve estar entre 0.1% e 99.9%'),
  body('embalagem')
    .optional()
    .isFloat({ min: 0 }),
  body('taxa_percentual')
    .optional()
    .isFloat({ min: 0, max: 100 }),
  checarErros
]

// ── UUID em parâmetros de rota ────────────────────────────
const validarUUID = [
  param('id').isUUID().withMessage('ID inválido'),
  checarErros
]

module.exports = {
  validarCadastro, validarLogin,
  validarVenda, validarDespesa,
  validarMeta, validarProduto,
  validarUUID
}
