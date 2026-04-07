// src/services/patternDetection.js
// ─────────────────────────────────────────────────────────
// Melhoria 3 — Detecção de padrões de venda por dia da semana
//
// Analisa os últimos 30 dias de vendas agrupados por DOW.
// Se um dia da semana tiver média consistentemente 30% abaixo
// da média geral, retorna um insight textual para ser injetado
// no system prompt do agente.
// ─────────────────────────────────────────────────────────
const { queryWithUser } = require('../config/database')

const DIAS_PT = [
  'domingos',
  'segundas-feiras',
  'terças-feiras',
  'quartas-feiras',
  'quintas-feiras',
  'sextas-feiras',
  'sábados',
]

// Retorna string com o insight ou null se não houver padrão detectável.
async function detectWeakDayPattern(userId) {
  try {
    // Agrega o total de vendas por dia (não por registro), nos últimos 30 dias.
    // Usamos CURRENT_DATE - 1 para não incluir o dia de hoje (incompleto).
    const result = await queryWithUser(userId, `
      SELECT
        data,
        EXTRACT(DOW FROM data)::int AS dow,
        SUM(valor)                  AS total_dia
      FROM vendas
      WHERE user_id = $1
        AND data >= CURRENT_DATE - INTERVAL '30 days'
        AND data <  CURRENT_DATE
      GROUP BY data, EXTRACT(DOW FROM data)
      ORDER BY data
    `, [userId])

    // Exige ao menos 7 dias-úteis de dados para ter significância
    if (result.rows.length < 7) return null

    // Agrupa totais diários por dia da semana (DOW 0=dom … 6=sáb)
    const porDow = {}
    for (const row of result.rows) {
      const dow = parseInt(row.dow)
      if (!porDow[dow]) porDow[dow] = []
      porDow[dow].push(parseFloat(row.total_dia))
    }

    // Só considera DOWs com pelo menos 2 ocorrências (consistência mínima)
    const dowsValidos = Object.keys(porDow).filter(d => porDow[d].length >= 2)
    if (dowsValidos.length < 3) return null

    // Média de receita por DOW
    const medias = {}
    for (const dow of dowsValidos) {
      const vals  = porDow[dow]
      medias[dow] = vals.reduce((a, b) => a + b, 0) / vals.length
    }

    // Média geral (entre os DOWs com dados)
    const mediaGeral =
      Object.values(medias).reduce((a, b) => a + b, 0) / Object.values(medias).length
    if (mediaGeral === 0) return null

    // Encontra o DOW mais fraco (se >= 30% abaixo da média geral)
    const LIMIAR = 0.30
    let dowMaisFraco  = null
    let maiorDeficit  = 0

    for (const dow of dowsValidos) {
      const deficit = (mediaGeral - medias[dow]) / mediaGeral
      if (deficit >= LIMIAR && deficit > maiorDeficit) {
        maiorDeficit = deficit
        dowMaisFraco = parseInt(dow)
      }
    }

    if (dowMaisFraco === null) return null

    const diaNome       = DIAS_PT[dowMaisFraco]
    const percentAbaixo = Math.round(maiorDeficit * 100)

    return (
      `Padrão identificado nos últimos 30 dias: as vendas tendem a ser ` +
      `${percentAbaixo}% menores nas ${diaNome} em comparação aos outros dias da semana. ` +
      `Quando for natural e relevante na conversa, mencione esse padrão de forma gentil e ` +
      `sugira uma ação para esse dia (ex: promoção relâmpago, divulgação nas redes sociais, ` +
      `combo especial ou produto de destaque).`
    )
  } catch (err) {
    console.warn('[PATTERN] Erro ao detectar padrão de vendas:', err.message)
    return null
  }
}

module.exports = { detectWeakDayPattern }
