// src/controllers/metasController.js
const { queryWithUser } = require('../config/database')

const listar = async (req, res) => {
  try {
    const userId = req.userId
    const resultado = await queryWithUser(userId,
      `SELECT * FROM metas WHERE user_id = $1 ORDER BY ano DESC, mes DESC`,
      [userId]
    )
    res.json({ sucesso: true, dados: resultado.rows })
  } catch (err) {
    console.error('Erro ao buscar metas:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar metas' })
  }
}

const salvar = async (req, res) => {
  try {
    const userId = req.userId
    const { valor_meta, pro_labore } = req.body

    // mes e ano são opcionais — default para o mês/ano atual se não enviados
    const now = new Date()
    const mes = req.body.mes != null ? parseInt(req.body.mes) : now.getMonth() + 1
    const ano = req.body.ano != null ? parseInt(req.body.ano) : now.getFullYear()

    console.log('[metas/salvar] params:', { valor_meta, mes, ano, pro_labore, userId })

    const resultado = await queryWithUser(userId,
      `INSERT INTO metas (user_id, valor_meta, mes, ano, pro_labore)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, mes, ano)
       DO UPDATE SET valor_meta = EXCLUDED.valor_meta, pro_labore = EXCLUDED.pro_labore
       RETURNING *`,
      [userId, parseFloat(valor_meta), mes, ano, parseFloat(pro_labore || 0)]
    )

    res.json({ sucesso: true, mensagem: 'Meta salva com sucesso!', dados: resultado.rows[0] })
  } catch (err) {
    console.error('[metas/salvar] erro:', err.message, err.code, err.detail)
    res.status(500).json({ sucesso: false, erro: 'Erro ao salvar meta' })
  }
}


// ─────────────────────────────────────────────────────────

// src/controllers/produtosController.js — exportado junto por simplicidade
const db = require('../config/database')

const listarProdutos = async (req, res) => {
  try {
    const userId = req.userId
    const resultado = await db.queryWithUser(userId,
      `SELECT * FROM produtos WHERE user_id = $1 ORDER BY criado_em DESC`,
      [userId]
    )
    res.json({ sucesso: true, dados: resultado.rows })
  } catch (err) {
    console.error('Erro ao buscar produtos:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar produtos' })
  }
}

const criarProduto = async (req, res) => {
  try {
    const userId = req.userId
    const { nome, custo, embalagem, taxa_percentual, margem_desejada } = req.body
    console.log('[Precificacao] POST recebido:', { userId, body: req.body })

    const custoTotal  = parseFloat(custo) + parseFloat(embalagem || 0)
    const taxa        = parseFloat(taxa_percentual || 0) / 100
    const margem      = parseFloat(margem_desejada) / 100
    const precoSugerido = custoTotal / (1 - margem - taxa)

    const resultado = await db.queryWithUser(userId,
      `INSERT INTO produtos (user_id, nome, custo, embalagem, taxa_percentual, margem_desejada, preco_sugerido)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [userId, nome.trim(), parseFloat(custo), parseFloat(embalagem || 0),
       parseFloat(taxa_percentual || 0), parseFloat(margem_desejada),
       parseFloat(precoSugerido.toFixed(2))]
    )

    res.status(201).json({ sucesso: true, dados: resultado.rows[0] })
  } catch (err) {
    console.error('Erro ao salvar produto:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao salvar produto' })
  }
}

const deletarProduto = async (req, res) => {
  try {
    const userId = req.userId
    const { id } = req.params
    const resultado = await db.queryWithUser(userId,
      'DELETE FROM produtos WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    )
    if (!resultado.rows.length) return res.status(404).json({ sucesso: false, erro: 'Produto não encontrado' })
    res.json({ sucesso: true, mensagem: 'Produto removido' })
  } catch (err) {
    console.error('Erro ao remover produto:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao remover produto' })
  }
}

module.exports = { listar, salvar, listarProdutos, criarProduto, deletarProduto }
