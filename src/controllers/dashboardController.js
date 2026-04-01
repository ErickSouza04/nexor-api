// src/controllers/dashboardController.js
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

    // Pró-labore padrão do usuário (fallback quando não há meta no mês)
    const usuarioPL = await queryWithUser(userId,
      `SELECT pro_labore FROM usuarios WHERE id = $1`,
      [userId]
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

    // Calcular lucro
    const faturamento    = parseFloat(vendas.rows[0].faturamento)
    const totalDespesas  = parseFloat(despesas.rows[0].total_despesas)
    const lucro          = faturamento - totalDespesas
    const margem         = faturamento > 0 ? (lucro / faturamento) * 100 : 0

    const fatAnt         = parseFloat(vendasAnt.rows[0].faturamento)
    const despAnt        = parseFloat(despesasAnt.rows[0].total)
    const lucroAnt       = fatAnt - despAnt

    // Variação percentual
    const varFat   = fatAnt > 0 ? ((faturamento - fatAnt) / fatAnt) * 100 : 0
    const varLucro = lucroAnt > 0 ? ((lucro - lucroAnt) / lucroAnt) * 100 : 0
    const varDesp  = despAnt > 0 ? ((totalDespesas - despAnt) / despAnt) * 100 : 0

    const metaValor    = meta.rows[0]?.valor_meta || 0
    // Usa pro_labore da meta do mês; se não houver meta, usa o valor padrão do perfil do usuário
    const proLabore    = meta.rows[0]?.pro_labore ?? usuarioPL.rows[0]?.pro_labore ?? 0
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

// ── FLUXO DIÁRIO (últimos 14 dias) ──────────────────────
const fluxoDiario = async (req, res) => {
  try {
    const userId = req.userId

    const vendDiario = await queryWithUser(userId,
      `SELECT data, SUM(valor) AS total
       FROM vendas WHERE user_id = $1 AND data >= NOW() - INTERVAL '14 days'
       GROUP BY data ORDER BY data`,
      [userId]
    )

    const despDiario = await queryWithUser(userId,
      `SELECT data, SUM(valor) AS total
       FROM despesas WHERE user_id = $1 AND data >= NOW() - INTERVAL '14 days'
       GROUP BY data ORDER BY data`,
      [userId]
    )

    // Gera todos os dias do período
    const dias = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const dataStr = d.toISOString().split('T')[0]
      const venda = vendDiario.rows.find(r => r.data.toISOString().split('T')[0] === dataStr)
      const desp  = despDiario.rows.find(r => r.data.toISOString().split('T')[0] === dataStr)
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

module.exports = { resumoCompleto, indiceNexor, comparacaoMeses, fluxoDiario }
