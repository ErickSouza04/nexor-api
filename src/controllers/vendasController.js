// src/controllers/vendasController.js
// ─────────────────────────────────────────────────────────
// Controller de Vendas
// user_id SEMPRE vem de req.userId (token JWT)
// NUNCA aceita user_id do body ou query params
// ─────────────────────────────────────────────────────────
const { queryWithUser, transaction } = require('../config/database')
const { getDataBrasil } = require('../utils/dateUtils')

// ── LISTAR vendas (com filtro de mês/ano) ───────────────
const listar = async (req, res) => {
  try {
    const userId = req.userId  // vem do token JWT, 100% seguro
    const { mes, ano } = req.query
    const limite = Math.min(Math.max(1, parseInt(req.query.limite) || 50), 200)
    const pagina = Math.max(1, parseInt(req.query.pagina) || 1)
    const offset = (pagina - 1) * limite

    let sql = `
      SELECT id, valor, categoria, pagamento, produto, data, criado_em
      FROM vendas
      WHERE user_id = $1
    `
    const params = [userId]
    let paramIndex = 2

    if (mes && ano) {
      sql += ` AND EXTRACT(MONTH FROM data) = $${paramIndex} AND EXTRACT(YEAR FROM data) = $${paramIndex + 1}`
      params.push(parseInt(mes), parseInt(ano))
      paramIndex += 2
    }

    sql += ` ORDER BY data DESC, criado_em DESC`
    sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`
    params.push(limite, offset)

    const resultado = await queryWithUser(userId, sql, params)

    // Conta total para paginação respeitando o mesmo filtro mes/ano
    let countSql = `SELECT COUNT(*) FROM vendas WHERE user_id = $1`
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
    console.error('Erro ao listar vendas:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar vendas' })
  }
}

// ── CRIAR venda ─────────────────────────────────────────
const criar = async (req, res) => {
  try {
    const userId = req.userId
    const { valor, categoria, pagamento, produto, data } = req.body

    const resultado = await queryWithUser(userId,
      `INSERT INTO vendas (user_id, valor, categoria, pagamento, produto, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, parseFloat(valor), categoria, pagamento, produto || null, data || new Date()]
    )

    res.status(201).json({
      sucesso: true,
      mensagem: 'Venda registrada com sucesso!',
      dados: resultado.rows[0]
    })

  } catch (err) {
    console.error('Erro ao criar venda:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao registrar venda' })
  }
}

// ── DELETAR venda ────────────────────────────────────────
const deletar = async (req, res) => {
  try {
    const userId = req.userId
    const { id } = req.params

    // O WHERE user_id = $1 garante que só o dono pode deletar
    // Mesmo que alguém adivinhe um UUID, não consegue deletar
    const resultado = await queryWithUser(userId,
      'DELETE FROM vendas WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    )

    if (resultado.rows.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Venda não encontrada' })
    }

    res.json({ sucesso: true, mensagem: 'Venda removida com sucesso' })

  } catch (err) {
    console.error('Erro ao deletar venda:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao remover venda' })
  }
}

// ── RESUMO DO DIA ────────────────────────────────────────
const resumoDia = async (req, res) => {
  try {
    const userId = req.userId
    // Fallback: usa fuso de Brasília quando o frontend não envia ?data=
    // Antes usava new Date().toISOString() (UTC) — às 22h Brasil isso
    // gerava o dia seguinte UTC, causando zero resultados no card "Hoje".
    const hoje = req.query.data || getDataBrasil()

    const sql = `SELECT
        COALESCE(SUM(valor), 0)   AS total_vendas,
        COUNT(*)                   AS quantidade_vendas,
        COALESCE(AVG(valor), 0)   AS ticket_medio
       FROM vendas
       WHERE user_id = $1 AND data = $2`

    console.log('[resumoDia] ?data param:', req.query.data ?? '(não enviado)')
    console.log('[resumoDia] data usada na query:', hoje)

    const resultado = await queryWithUser(userId, sql, [userId, hoje])

    console.log('[resumoDia] rows retornadas:', resultado.rows[0])

    res.json({
      sucesso: true,
      dados: {
        data: hoje,
        total_vendas:      parseFloat(resultado.rows[0].total_vendas),
        quantidade_vendas: parseInt(resultado.rows[0].quantidade_vendas),
        ticket_medio:      parseFloat(resultado.rows[0].ticket_medio)
      }
    })

  } catch (err) {
    console.error('Erro no resumo do dia:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar resumo' })
  }
}

// ── RESUMO DO MÊS ────────────────────────────────────────
const resumoMes = async (req, res) => {
  try {
    const userId = req.userId
    const mes = parseInt(req.query.mes) || new Date().getMonth() + 1
    const ano = parseInt(req.query.ano) || new Date().getFullYear()

    const resultado = await queryWithUser(userId,
      `SELECT
        COALESCE(SUM(valor), 0)  AS faturamento,
        COUNT(*)                  AS total_vendas,
        COALESCE(AVG(valor), 0)  AS ticket_medio,
        COALESCE(MAX(valor), 0)  AS maior_venda,
        COALESCE(MIN(valor), 0)  AS menor_venda
       FROM vendas
       WHERE user_id = $1
         AND EXTRACT(MONTH FROM data) = $2
         AND EXTRACT(YEAR FROM data)  = $3`,
      [userId, mes, ano]
    )

    // Melhor dia do mês
    const melhorDia = await queryWithUser(userId,
      `SELECT data, SUM(valor) AS total
       FROM vendas
       WHERE user_id = $1
         AND EXTRACT(MONTH FROM data) = $2
         AND EXTRACT(YEAR FROM data)  = $3
       GROUP BY data
       ORDER BY total DESC
       LIMIT 1`,
      [userId, mes, ano]
    )

    const dados = resultado.rows[0]
    res.json({
      sucesso: true,
      dados: {
        mes, ano,
        faturamento:   parseFloat(dados.faturamento),
        total_vendas:  parseInt(dados.total_vendas),
        ticket_medio:  parseFloat(dados.ticket_medio),
        maior_venda:   parseFloat(dados.maior_venda),
        menor_venda:   parseFloat(dados.menor_venda),
        melhor_dia:    melhorDia.rows[0] || null
      }
    })

  } catch (err) {
    console.error('Erro no resumo mensal:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar resumo' })
  }
}

module.exports = { listar, criar, deletar, resumoDia, resumoMes }
