// src/controllers/despesasController.js
const { queryWithUser } = require('../config/database')
const { getDataBrasil } = require('../utils/dateUtils')

const listar = async (req, res) => {
  try {
    const userId = req.userId
    const { mes, ano } = req.query
    const limite = Math.min(Math.max(1, parseInt(req.query.limite) || 50), 200)
    const pagina = Math.max(1, parseInt(req.query.pagina) || 1)
    const offset = (pagina - 1) * limite

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
    params.push(limite, offset)

    const resultado = await queryWithUser(userId, sql, params)

    // Conta total para paginação respeitando o mesmo filtro mes/ano
    let countSql = `SELECT COUNT(*) FROM despesas WHERE user_id = $1`
    const countParams = [userId]
    if (mes && ano) {
      countSql += ` AND EXTRACT(MONTH FROM data) = $2 AND EXTRACT(YEAR FROM data) = $3`
      countParams.push(parseInt(mes), parseInt(ano))
    }
    const total = await queryWithUser(userId, countSql, countParams)

    res.json({
      sucesso: true,
      dados: resultado.rows,
      paginacao: {
        total:   parseInt(total.rows[0].count),
        pagina,
        limite,
        paginas: Math.ceil(parseInt(total.rows[0].count) / limite)
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
      [userId, parseFloat(valor), categoria, pagamento, descricao || null, data || getDataBrasil()]
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
