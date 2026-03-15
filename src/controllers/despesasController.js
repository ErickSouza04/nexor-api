// src/controllers/despesasController.js
const { queryWithUser } = require('../config/database')

const listar = async (req, res) => {
  try {
    const userId = req.userId
    const { mes, ano, limite = 50, pagina = 1 } = req.query
    const offset = (parseInt(pagina) - 1) * parseInt(limite)

    let sql = `SELECT id, valor, categoria, pagamento, descricao, data, criado_em
               FROM despesas WHERE user_id = $1`
    const params = [userId]
    let idx = 2

    if (mes && ano) {
      sql += ` AND EXTRACT(MONTH FROM data) = $${idx} AND EXTRACT(YEAR FROM data) = $${idx+1}`
      params.push(parseInt(mes), parseInt(ano))
      idx += 2
    }

    sql += ` ORDER BY data DESC, criado_em DESC LIMIT $${idx} OFFSET $${idx+1}`
    params.push(parseInt(limite), offset)

    const resultado = await queryWithUser(userId, sql, params)
    const total = await queryWithUser(userId,
      'SELECT COUNT(*) FROM despesas WHERE user_id = $1', [userId]
    )

    res.json({
      sucesso: true,
      dados: resultado.rows,
      paginacao: {
        total: parseInt(total.rows[0].count),
        pagina: parseInt(pagina),
        limite: parseInt(limite)
      }
    })
  } catch (err) {
    console.error('Erro ao listar despesas:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar despesas' })
  }
}

const criar = async (req, res) => {
  try {
    const userId = req.userId
    const { valor, categoria, pagamento, descricao, data } = req.body

    const resultado = await queryWithUser(userId,
      `INSERT INTO despesas (user_id, valor, categoria, pagamento, descricao, data)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, parseFloat(valor), categoria, pagamento, descricao || null, data || new Date()]
    )

    res.status(201).json({
      sucesso: true,
      mensagem: 'Despesa registrada com sucesso!',
      dados: resultado.rows[0]
    })
  } catch (err) {
    console.error('Erro ao criar despesa:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao registrar despesa' })
  }
}

const deletar = async (req, res) => {
  try {
    const userId = req.userId
    const { id } = req.params

    const resultado = await queryWithUser(userId,
      'DELETE FROM despesas WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    )

    if (resultado.rows.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Despesa não encontrada' })
    }

    res.json({ sucesso: true, mensagem: 'Despesa removida com sucesso' })
  } catch (err) {
    console.error('Erro ao deletar despesa:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao remover despesa' })
  }
}

const resumoMes = async (req, res) => {
  try {
    const userId = req.userId
    const mes = parseInt(req.query.mes) || new Date().getMonth() + 1
    const ano = parseInt(req.query.ano) || new Date().getFullYear()

    // Total geral
    const total = await queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS total
       FROM despesas
       WHERE user_id = $1
         AND EXTRACT(MONTH FROM data) = $2
         AND EXTRACT(YEAR FROM data)  = $3`,
      [userId, mes, ano]
    )

    // Por categoria
    const porCategoria = await queryWithUser(userId,
      `SELECT categoria, SUM(valor) AS total, COUNT(*) AS quantidade
       FROM despesas
       WHERE user_id = $1
         AND EXTRACT(MONTH FROM data) = $2
         AND EXTRACT(YEAR FROM data)  = $3
       GROUP BY categoria
       ORDER BY total DESC`,
      [userId, mes, ano]
    )

    res.json({
      sucesso: true,
      dados: {
        mes, ano,
        total:         parseFloat(total.rows[0].total),
        por_categoria: porCategoria.rows
      }
    })
  } catch (err) {
    console.error('Erro no resumo despesas:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar resumo' })
  }
}

module.exports = { listar, criar, deletar, resumoMes }
