// src/controllers/stockController.js
// ─────────────────────────────────────────────────────────
// Controller de Estoque (tabelas: products, stock_movements)
// user_id SEMPRE vem de req.userId (token JWT)
// NUNCA aceita user_id do body ou query params
// ─────────────────────────────────────────────────────────
const { queryWithUser, transaction } = require('../config/database')

// ── CRIAR produto ────────────────────────────────────────
const criarProduto = async (req, res) => {
  try {
    const userId = req.userId
    const b = req.body

    console.log('[stock/criarProduto] body recebido:', JSON.stringify(b))

    // Aceita nomes em inglês (padrão API) ou português (frontend)
    const name             = b.name            ?? b.nome            ?? b.produto ?? b.product
    const brand            = b.brand           ?? b.marca
    const unit             = b.unit            ?? b.unidade
    const current_stock    = b.current_stock   ?? b.qtd_inicial    ?? b.quantidade_inicial ?? b.estoque_atual ?? b.estoque ?? b.quantidade
    const min_stock_alert  = b.min_stock_alert ?? b.estoque_minimo ?? b.min_estoque
    const cost_price       = b.cost_price      ?? b.preco_custo    ?? b.custo
    const sale_price       = b.sale_price      ?? b.preco_venda    ?? b.venda

    console.log('[stock/criarProduto] campos mapeados:', { name, brand, unit, current_stock, min_stock_alert, cost_price, sale_price })

    const resultado = await queryWithUser(userId,
      `INSERT INTO products
         (user_id, name, brand, unit, current_stock, min_stock_alert, cost_price, sale_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        userId,
        name,
        brand       || null,
        unit        || 'unidade',
        parseFloat(current_stock    || 0),
        parseFloat(min_stock_alert  || 5),
        cost_price  != null ? parseFloat(cost_price)  : null,
        sale_price  != null ? parseFloat(sale_price)  : null,
      ]
    )

    res.status(201).json({
      sucesso:  true,
      mensagem: 'Produto criado com sucesso!',
      dados:    resultado.rows[0],
      produto:  resultado.rows[0],  // alias para compatibilidade com o frontend
      product:  resultado.rows[0],  // alias em inglês
    })
  } catch (err) {
    console.error('[stock/criarProduto] erro:', err.message, '| code:', err.code)
    res.status(500).json({ sucesso: false, erro: 'Erro ao criar produto', detalhe: err.message })
  }
}

// ── LISTAR produtos ──────────────────────────────────────
const listarProdutos = async (req, res) => {
  try {
    const userId = req.userId
    const limite = Math.min(Math.max(1, parseInt(req.query.limite) || 50), 200)
    const pagina = Math.max(1, parseInt(req.query.pagina) || 1)
    const offset = (pagina - 1) * limite

    const resultado = await queryWithUser(userId,
      `SELECT id, name, brand, unit, current_stock, min_stock_alert, cost_price, sale_price, created_at
       FROM products
       WHERE user_id = $1
       ORDER BY name ASC
       LIMIT $2 OFFSET $3`,
      [userId, limite, offset]
    )

    const total = await queryWithUser(userId,
      'SELECT COUNT(*) FROM products WHERE user_id = $1',
      [userId]
    )

    res.json({
      sucesso: true,
      dados:   resultado.rows,
      paginacao: {
        total:   parseInt(total.rows[0].count),
        pagina,
        limite,
        paginas: Math.ceil(parseInt(total.rows[0].count) / limite)
      }
    })
  } catch (err) {
    console.error('Erro ao listar produtos:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar produtos' })
  }
}

// ── EDITAR produto ───────────────────────────────────────
const editarProduto = async (req, res) => {
  try {
    const userId = req.userId
    const { id }  = req.params
    const b = req.body

    // Aceita nomes em inglês (padrão API) ou português (frontend)
    const name            = b.name            ?? b.nome
    const brand           = b.brand           ?? b.marca
    const unit            = b.unit            ?? b.unidade
    const min_stock_alert = b.min_stock_alert ?? b.estoque_minimo ?? b.min_estoque
    const cost_price      = b.cost_price      ?? b.preco_custo
    const sale_price      = b.sale_price      ?? b.preco_venda

    const resultado = await queryWithUser(userId,
      `UPDATE products
       SET
         name            = COALESCE($3, name),
         brand           = COALESCE($4, brand),
         unit            = COALESCE($5, unit),
         min_stock_alert = COALESCE($6, min_stock_alert),
         cost_price      = COALESCE($7, cost_price),
         sale_price      = COALESCE($8, sale_price)
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [
        id,
        userId,
        name            || null,
        brand           || null,
        unit            || null,
        min_stock_alert != null ? parseFloat(min_stock_alert) : null,
        cost_price      != null ? parseFloat(cost_price)      : null,
        sale_price      != null ? parseFloat(sale_price)      : null,
      ]
    )

    if (resultado.rows.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Produto não encontrado' })
    }

    res.json({
      sucesso:  true,
      mensagem: 'Produto atualizado com sucesso!',
      dados:    resultado.rows[0]
    })
  } catch (err) {
    console.error('Erro ao editar produto:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao atualizar produto' })
  }
}

// ── REGISTRAR movimentação de estoque ────────────────────
const registrarMovimentacao = async (req, res) => {
  try {
    const userId = req.userId
    const { product_id, type, quantity, unit_price, source, raw_message, linked_expense_id } = req.body

    if (!product_id || !type || !quantity) {
      return res.status(400).json({ sucesso: false, erro: 'product_id, type e quantity são obrigatórios' })
    }
    if (!['entrada', 'saida'].includes(type)) {
      return res.status(400).json({ sucesso: false, erro: 'type deve ser "entrada" ou "saida"' })
    }
    const qtd = parseFloat(quantity)
    if (qtd <= 0) {
      return res.status(400).json({ sucesso: false, erro: 'quantity deve ser maior que zero' })
    }

    const resultado = await transaction(userId, async (client) => {
      // Busca produto e verifica dono (RLS já configurado pelo transaction())
      const produto = await client.query(
        'SELECT id, current_stock FROM products WHERE id = $1 AND user_id = $2',
        [product_id, userId]
      )
      if (produto.rows.length === 0) {
        throw Object.assign(new Error('Produto não encontrado'), { status: 404 })
      }

      const estoqueAtual = parseFloat(produto.rows[0].current_stock)

      if (type === 'saida' && qtd > estoqueAtual) {
        throw Object.assign(
          new Error(`Estoque insuficiente. Disponível: ${estoqueAtual}`),
          { status: 400 }
        )
      }

      // Insere movimentação
      const movimento = await client.query(
        `INSERT INTO stock_movements
           (product_id, user_id, type, quantity, unit_price, source, raw_message, linked_expense_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          product_id,
          userId,
          type,
          qtd,
          unit_price        != null ? parseFloat(unit_price) : null,
          source            || 'app',
          raw_message       || null,
          linked_expense_id || null,
        ]
      )

      // Atualiza estoque
      const delta = type === 'entrada' ? qtd : -qtd
      const produtoAtualizado = await client.query(
        `UPDATE products
         SET current_stock = current_stock + $1
         WHERE id = $2
         RETURNING id, name, current_stock`,
        [delta, product_id]
      )

      return { movimento: movimento.rows[0], produto: produtoAtualizado.rows[0] }
    })

    res.status(201).json({
      sucesso:  true,
      mensagem: 'Movimentação registrada com sucesso!',
      dados:    resultado
    })
  } catch (err) {
    console.error('Erro ao registrar movimentação:', err)
    const status = err.status || 500
    const erro   = status < 500 ? err.message : 'Erro ao registrar movimentação'
    res.status(status).json({ sucesso: false, erro })
  }
}

// ── LISTAR movimentações ─────────────────────────────────
const listarMovimentacoes = async (req, res) => {
  try {
    const userId    = req.userId
    const limite    = Math.min(Math.max(1, parseInt(req.query.limite) || 50), 200)
    const pagina    = Math.max(1, parseInt(req.query.pagina) || 1)
    const offset    = (pagina - 1) * limite
    const productId = req.query.product_id || null

    let sql = `
      SELECT sm.id, sm.type, sm.quantity, sm.unit_price, sm.source,
             sm.raw_message, sm.linked_expense_id, sm.created_at,
             p.name AS product_name
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      WHERE sm.user_id = $1
    `
    const params = [userId]

    if (productId) {
      params.push(productId)
      sql += ` AND sm.product_id = $${params.length}`
    }

    sql += ` ORDER BY sm.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limite, offset)

    const resultado = await queryWithUser(userId, sql, params)

    let countSql    = 'SELECT COUNT(*) FROM stock_movements WHERE user_id = $1'
    const countParams = [userId]
    if (productId) {
      countParams.push(productId)
      countSql += ` AND product_id = $2`
    }
    const total = await queryWithUser(userId, countSql, countParams)

    res.json({
      sucesso: true,
      dados:   resultado.rows,
      paginacao: {
        total:   parseInt(total.rows[0].count),
        pagina,
        limite,
        paginas: Math.ceil(parseInt(total.rows[0].count) / limite)
      }
    })
  } catch (err) {
    console.error('Erro ao listar movimentações:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar movimentações' })
  }
}

// ── ALERTAS de estoque baixo ─────────────────────────────
const alertasEstoqueBaixo = async (req, res) => {
  try {
    const userId = req.userId

    const resultado = await queryWithUser(userId,
      `SELECT id, name, brand, unit, current_stock, min_stock_alert, cost_price, sale_price
       FROM products
       WHERE user_id = $1
         AND current_stock <= min_stock_alert
       ORDER BY (current_stock - min_stock_alert) ASC`,
      [userId]
    )

    res.json({
      sucesso: true,
      total:   resultado.rows.length,
      dados:   resultado.rows
    })
  } catch (err) {
    console.error('Erro ao buscar alertas de estoque:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar alertas de estoque' })
  }
}

module.exports = {
  criarProduto,
  listarProdutos,
  editarProduto,
  registrarMovimentacao,
  listarMovimentacoes,
  alertasEstoqueBaixo
}
