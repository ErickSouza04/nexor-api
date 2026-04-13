// src/controllers/dashboardController.js
const { getDataBrasil } = require('../utils/dateUtils')
// ─────────────────────────────────────────────────────────
// Controller do Dashboard
// Calcula Índice Nexor, resumo completo do mês,
// comparação de meses e fluxo diário
// ─────────────────────────────────────────────────────────
const { queryWithUser } = require('../config/database')

// ── RESUMO COMPLETO DO MÊS ───────────────────────────────
const resumoCompleto = async (req, res) => {
  try {
    const userId = req.userId
    const mes = parseInt(req.query.mes) || new Date().getMonth() + 1
    const ano = parseInt(req.query.ano) || new Date().getFullYear()

    // Faturamento do mês
    const vendas = await queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS faturamento, COUNT(*) AS qtd_vendas, COALESCE(AVG(valor), 0) AS ticket_medio
       FROM vendas WHERE user_id = $1 AND EXTRACT(MONTH FROM data) = $2 AND EXTRACT(YEAR FROM data) = $3`,
      [userId, mes, ano]
    )

    // Despesas do mês
    const despesas = await queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS total_despesas
       FROM despesas WHERE user_id = $1 AND EXTRACT(MONTH FROM data) = $2 AND EXTRACT(YEAR FROM data) = $3`,
      [userId, mes, ano]
    )

    // Meta do mês
    const meta = await queryWithUser(userId,
      `SELECT valor_meta, pro_labore FROM metas WHERE user_id = $1 AND mes = $2 AND ano = $3`,
      [userId, mes, ano]
    )

    // COGS: custo das mercadorias vendidas (somente vendas com cost_price_snapshot)
    const cogsRes = await queryWithUser(userId,
      `SELECT COALESCE(SUM(cost_price_snapshot * quantidade), 0) AS total_cogs
       FROM vendas
       WHERE user_id = $1
         AND cost_price_snapshot IS NOT NULL
         AND EXTRACT(MONTH FROM data) = $2
         AND EXTRACT(YEAR FROM data) = $3`,
      [userId, mes, ano]
    )

    // Dados do mês anterior (para comparação)
    const mesAnterior = mes === 1 ? 12 : mes - 1
    const anoAnterior = mes === 1 ? ano - 1 : ano
    const vendasAnt = await queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS faturamento, COALESCE(AVG(valor), 0) AS ticket_medio FROM vendas
       WHERE user_id = $1 AND EXTRACT(MONTH FROM data) = $2 AND EXTRACT(YEAR FROM data) = $3`,
      [userId, mesAnterior, anoAnterior]
    )
    const despesasAnt = await queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS total FROM despesas
       WHERE user_id = $1 AND EXTRACT(MONTH FROM data) = $2 AND EXTRACT(YEAR FROM data) = $3`,
      [userId, mesAnterior, anoAnterior]
    )
    const cogsAntRes = await queryWithUser(userId,
      `SELECT COALESCE(SUM(cost_price_snapshot * quantidade), 0) AS total_cogs
       FROM vendas
       WHERE user_id = $1
         AND cost_price_snapshot IS NOT NULL
         AND EXTRACT(MONTH FROM data) = $2
         AND EXTRACT(YEAR FROM data) = $3`,
      [userId, mesAnterior, anoAnterior]
    )

    // Calcular lucro real (faturamento - despesas operacionais - COGS)
    const faturamento    = parseFloat(vendas.rows[0].faturamento)
    const totalDespesas  = parseFloat(despesas.rows[0].total_despesas)
    const totalCogs      = parseFloat(cogsRes.rows[0].total_cogs)
    const lucro          = faturamento - totalDespesas - totalCogs
    const margem         = faturamento > 0 ? (lucro / faturamento) * 100 : 0

    const fatAnt         = parseFloat(vendasAnt.rows[0].faturamento)
    const despAnt        = parseFloat(despesasAnt.rows[0].total)
    const cogsAnt        = parseFloat(cogsAntRes.rows[0].total_cogs)
    const lucroAnt       = fatAnt - despAnt - cogsAnt

    // Variação percentual
    const varFat   = fatAnt > 0 ? ((faturamento - fatAnt) / fatAnt) * 100 : 0
    const varLucro = lucroAnt > 0 ? ((lucro - lucroAnt) / lucroAnt) * 100 : 0
    const varDesp  = despAnt > 0 ? ((totalDespesas - despAnt) / despAnt) * 100 : 0

    const metaValor    = meta.rows[0]?.valor_meta || 0
    const proLabore    = meta.rows[0]?.pro_labore || 0
    const progressoMeta = metaValor > 0 ? Math.min((lucro / metaValor) * 100, 100) : 0

    res.json({
      sucesso: true,
      dados: {
        mes, ano,
        faturamento,
        total_despesas:  totalDespesas,
        lucro,
        lucro_pos_prolabore: lucro - proLabore,
        margem:          parseFloat(margem.toFixed(2)),
        total_vendas:        parseInt(vendas.rows[0].qtd_vendas),
        ticket_medio:        parseFloat(vendas.rows[0].ticket_medio),
        ticket_medio_anterior: parseFloat(vendasAnt.rows[0].ticket_medio),
        meta_valor:          metaValor,
        pro_labore:      proLabore,
        progresso_meta:  parseFloat(progressoMeta.toFixed(1)),
        variacao: {
          faturamento: parseFloat(varFat.toFixed(1)),
          lucro:       parseFloat(varLucro.toFixed(1)),
          despesas:    parseFloat(varDesp.toFixed(1))
        }
      }
    })

  } catch (err) {
    console.error('Erro no resumo completo:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao calcular resumo' })
  }
}

// ── ÍNDICE NEXOR (0–100) ─────────────────────────────────
const indiceNexor = async (req, res) => {
  try {
    const userId = req.userId
    const mes = parseInt(req.query.mes) || new Date().getMonth() + 1
    const ano = parseInt(req.query.ano) || new Date().getFullYear()

    // 1. Margem atual (peso: 35 pts)
    const vendas   = await queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS fat FROM vendas
       WHERE user_id=$1 AND EXTRACT(MONTH FROM data)=$2 AND EXTRACT(YEAR FROM data)=$3`,
      [userId, mes, ano]
    )
    const despesas = await queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS desp FROM despesas
       WHERE user_id=$1 AND EXTRACT(MONTH FROM data)=$2 AND EXTRACT(YEAR FROM data)=$3`,
      [userId, mes, ano]
    )

    const fat   = parseFloat(vendas.rows[0].fat)
    const desp  = parseFloat(despesas.rows[0].desp)
    const lucro = fat - desp
    const margem = fat > 0 ? (lucro / fat) * 100 : 0

    // Pontos por margem (meta ideal = 35%)
    const ptsMargem = Math.min((margem / 35) * 35, 35)

    // 2. Frequência de uso no mês (peso: 25 pts)
    const diasAtivos = await queryWithUser(userId,
      `SELECT COUNT(DISTINCT data) AS dias FROM (
         SELECT data FROM vendas WHERE user_id=$1 AND EXTRACT(MONTH FROM data)=$2 AND EXTRACT(YEAR FROM data)=$3
         UNION
         SELECT data FROM despesas WHERE user_id=$1 AND EXTRACT(MONTH FROM data)=$2 AND EXTRACT(YEAR FROM data)=$3
       ) t`,
      [userId, mes, ano]
    )
    const diasNoMes = new Date(ano, mes, 0).getDate()
    const diasUsados = parseInt(diasAtivos.rows[0].dias)
    const ptsFrequencia = Math.min((diasUsados / diasNoMes) * 25, 25)

    // 3. Crescimento vs mês anterior (peso: 25 pts)
    const mesAnt = mes === 1 ? 12 : mes - 1
    const anoAnt = mes === 1 ? ano - 1 : ano
    const fatAnt = await queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS fat FROM vendas
       WHERE user_id=$1 AND EXTRACT(MONTH FROM data)=$2 AND EXTRACT(YEAR FROM data)=$3`,
      [userId, mesAnt, anoAnt]
    )
    const fatAnterior = parseFloat(fatAnt.rows[0].fat)
    const crescimento = fatAnterior > 0 ? ((fat - fatAnterior) / fatAnterior) * 100 : 0
    const ptsCrescimento = crescimento > 0 ? Math.min((crescimento / 20) * 25, 25) : 0

    // 4. Controle de despesas (peso: 15 pts)
    // Quanto menor a razão despesas/faturamento, melhor
    const ratioDespesas = fat > 0 ? desp / fat : 1
    const ptsControle = Math.max((1 - ratioDespesas) * 15, 0)

    const indice = Math.round(ptsMargem + ptsFrequencia + ptsCrescimento + ptsControle)

    // Nível baseado no índice
    const nivel = indice >= 85 ? 'Excelente' :
                  indice >= 70 ? 'Boa' :
                  indice >= 50 ? 'Regular' : 'Atenção'

    res.json({
      sucesso: true,
      dados: {
        indice: Math.min(indice, 100),
        nivel,
        detalhes: {
          margem:     { pontos: parseFloat(ptsMargem.toFixed(1)),      maximo: 35 },
          frequencia: { pontos: parseFloat(ptsFrequencia.toFixed(1)),  maximo: 25 },
          crescimento:{ pontos: parseFloat(ptsCrescimento.toFixed(1)), maximo: 25 },
          controle:   { pontos: parseFloat(ptsControle.toFixed(1)),    maximo: 15 }
        }
      }
    })

  } catch (err) {
    console.error('Erro no índice Nexor:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao calcular índice' })
  }
}

// ── COMPARAÇÃO DOS ÚLTIMOS 6 MESES ──────────────────────
const comparacaoMeses = async (req, res) => {
  try {
    const userId = req.userId

    const resultado = await queryWithUser(userId,
      `SELECT
         EXTRACT(YEAR FROM data)  AS ano,
         EXTRACT(MONTH FROM data) AS mes,
         SUM(valor) AS faturamento,
         COUNT(*) AS qtd_vendas
       FROM vendas
       WHERE user_id = $1 AND data >= NOW() - INTERVAL '6 months'
       GROUP BY 1, 2 ORDER BY 1, 2`,
      [userId]
    )

    const despResult = await queryWithUser(userId,
      `SELECT
         EXTRACT(YEAR FROM data)  AS ano,
         EXTRACT(MONTH FROM data) AS mes,
         SUM(valor) AS total_despesas
       FROM despesas
       WHERE user_id = $1 AND data >= NOW() - INTERVAL '6 months'
       GROUP BY 1, 2 ORDER BY 1, 2`,
      [userId]
    )

    // Mescla vendas + despesas por mês (inclui meses com só despesas)
    const todasChaves = new Set()
    resultado.rows.forEach(v => todasChaves.add(`${parseInt(v.ano)}-${parseInt(v.mes)}`))
    despResult.rows.forEach(d => todasChaves.add(`${parseInt(d.ano)}-${parseInt(d.mes)}`))

    const meses = Array.from(todasChaves).sort().map(chave => {
      const [ano, mes] = chave.split('-').map(Number)
      const v = resultado.rows.find(r => parseInt(r.ano) === ano && parseInt(r.mes) === mes)
      const d = despResult.rows.find(r => parseInt(r.ano) === ano && parseInt(r.mes) === mes)
      const fat  = v ? parseFloat(v.faturamento) : 0
      const desp = d ? parseFloat(d.total_despesas) : 0
      return {
        ano,
        mes,
        faturamento: fat,
        despesas:    desp,
        lucro:       fat - desp,
        qtd_vendas:  v ? parseInt(v.qtd_vendas) : 0
      }
    })

    res.json({ sucesso: true, dados: meses })

  } catch (err) {
    console.error('Erro na comparação:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar comparação' })
  }
}

// ── RESUMO DE HOJE (hero card — polling leve) ────────────
// Retorna apenas os dados do dia atual para atualizar o hero card
// sem precisar recarregar o dashboard inteiro.
// Filtra pela coluna `data` (DATE em fuso Brasília) — mesmo critério
// usado pelo agente WhatsApp em resolverData() — garantindo que
// vendas registradas via WhatsApp apareçam aqui.
const resumoHoje = async (req, res) => {
  try {
    const userId = req.userId
    const dataHoje = getDataBrasil()

    const [vendasRes, despesasRes, cogsRes, ontemVendasRes, ontemDespesasRes] = await Promise.all([
      queryWithUser(userId,
        `SELECT COALESCE(SUM(valor), 0) AS receita, COUNT(*) AS qtd_vendas
         FROM vendas WHERE user_id = $1 AND data = $2`,
        [userId, dataHoje]
      ),
      queryWithUser(userId,
        `SELECT COALESCE(SUM(valor), 0) AS despesas
         FROM despesas WHERE user_id = $1 AND data = $2`,
        [userId, dataHoje]
      ),
      queryWithUser(userId,
        `SELECT COALESCE(SUM(cost_price_snapshot * quantidade), 0) AS cogs
         FROM vendas WHERE user_id = $1 AND data = $2 AND cost_price_snapshot IS NOT NULL`,
        [userId, dataHoje]
      ),
      queryWithUser(userId,
        `SELECT COALESCE(SUM(valor), 0) AS receita
         FROM vendas WHERE user_id = $1 AND data = $2`,
        [userId, (() => { const d = new Date(); d.setDate(d.getDate() - 1); return getDataBrasil(d) })()]
      ),
      queryWithUser(userId,
        `SELECT COALESCE(SUM(valor), 0) AS despesas
         FROM despesas WHERE user_id = $1 AND data = $2`,
        [userId, (() => { const d = new Date(); d.setDate(d.getDate() - 1); return getDataBrasil(d) })()]
      ),
    ])

    const receita      = parseFloat(vendasRes.rows[0].receita)
    const despesas     = parseFloat(despesasRes.rows[0].despesas)
    const cogs         = parseFloat(cogsRes.rows[0].cogs)
    const lucro        = receita - despesas - cogs
    const margem       = receita > 0 ? (lucro / receita) * 100 : 0

    const receitaOntem = parseFloat(ontemVendasRes.rows[0].receita)
    const despOntem    = parseFloat(ontemDespesasRes.rows[0].despesas)
    const lucroOntem   = receitaOntem - despOntem
    const varLucro     = lucroOntem > 0 ? ((lucro - lucroOntem) / lucroOntem) * 100 : 0
    const varReceita   = receitaOntem > 0 ? ((receita - receitaOntem) / receitaOntem) * 100 : 0

    const agora = new Date()
    const horaFormatada = agora.toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    })

    res.json({
      sucesso: true,
      dados: {
        data:           dataHoje,
        receita,
        total_despesas: despesas,
        lucro,
        margem:         parseFloat(margem.toFixed(2)),
        qtd_vendas:     parseInt(vendasRes.rows[0].qtd_vendas),
        variacao: {
          receita: parseFloat(varReceita.toFixed(1)),
          lucro:   parseFloat(varLucro.toFixed(1)),
        },
        atualizado_em: horaFormatada,
      }
    })

  } catch (err) {
    console.error('Erro no resumo de hoje:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar dados de hoje' })
  }
}

// ── ÚLTIMOS REGISTROS (vendas + despesas combinados) ────
// UNION de vendas e despesas ordenado por criado_em DESC.
// Vendas registradas pelo agente WhatsApp têm criado_em = NOW()
// e aparecem automaticamente aqui assim que inseridas.
const ultimosRegistros = async (req, res) => {
  try {
    const userId = req.userId
    const limite = Math.min(parseInt(req.query.limite) || 5, 20)

    const resultado = await queryWithUser(userId,
      `SELECT tipo, valor, descricao, categoria, criado_em
       FROM (
         SELECT 'venda'   AS tipo,
                valor,
                COALESCE(produto, categoria, 'Venda') AS descricao,
                categoria,
                criado_em
         FROM vendas WHERE user_id = $1
         UNION ALL
         SELECT 'despesa' AS tipo,
                valor,
                COALESCE(descricao, categoria, 'Despesa') AS descricao,
                categoria,
                criado_em
         FROM despesas WHERE user_id = $1
       ) registros
       ORDER BY criado_em DESC
       LIMIT $2`,
      [userId, limite]
    )

    res.json({
      sucesso: true,
      dados: resultado.rows.map(r => ({
        tipo:      r.tipo,
        valor:     parseFloat(r.valor),
        descricao: r.descricao,
        categoria: r.categoria,
        criado_em: r.criado_em,
      }))
    })

  } catch (err) {
    console.error('Erro nos últimos registros:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar últimos registros' })
  }
}

// ── FLUXO DIÁRIO (últimos 14 dias) ──────────────────────
const fluxoDiario = async (req, res) => {
  try {
    const userId = req.userId

    const vendDiario = await queryWithUser(userId,
      `SELECT DATE(criado_em AT TIME ZONE 'America/Sao_Paulo') AS data,
              SUM(valor) AS total
       FROM vendas
       WHERE user_id = $1
         AND DATE(criado_em AT TIME ZONE 'America/Sao_Paulo')
             >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::DATE - INTERVAL '14 days'
       GROUP BY DATE(criado_em AT TIME ZONE 'America/Sao_Paulo')
       ORDER BY data`,
      [userId]
    )

    const despDiario = await queryWithUser(userId,
      `SELECT DATE(criado_em AT TIME ZONE 'America/Sao_Paulo') AS data,
              SUM(valor) AS total
       FROM despesas
       WHERE user_id = $1
         AND DATE(criado_em AT TIME ZONE 'America/Sao_Paulo')
             >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::DATE - INTERVAL '14 days'
       GROUP BY DATE(criado_em AT TIME ZONE 'America/Sao_Paulo')
       ORDER BY data`,
      [userId]
    )

    // Gera todos os dias do período usando fuso de Brasília,
    // para que "hoje" no loop bata com o dia salvo pelo usuário.
    const dias = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const dataStr = getDataBrasil(d)
      // pg retorna DATE como string 'YYYY-MM-DD' — comparamos diretamente
      const venda = vendDiario.rows.find(r => String(r.data).slice(0, 10) === dataStr)
      const desp  = despDiario.rows.find(r => String(r.data).slice(0, 10) === dataStr)
      const fat   = venda ? parseFloat(venda.total) : 0
      const despTotal = desp ? parseFloat(desp.total) : 0
      dias.push({
        data:        dataStr,
        faturamento: fat,
        despesas:    despTotal,
        lucro:       fat - despTotal
      })
    }

    res.json({ sucesso: true, dados: dias })

  } catch (err) {
    console.error('Erro no fluxo diário:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao buscar fluxo diário' })
  }
}

module.exports = { resumoCompleto, indiceNexor, comparacaoMeses, fluxoDiario, resumoHoje, ultimosRegistros }
