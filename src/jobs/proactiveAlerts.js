// src/jobs/proactiveAlerts.js
// ─────────────────────────────────────────────────────────
// Nível 2: Comportamento proativo do agente Nexor WhatsApp
//
// Melhoria 1 — Alertas inteligentes
//   Diariamente às 19h (Brasília): verifica usuários Plus sem
//   movimentação nas últimas 48h e envia lembrete via Z-API.
//
// Melhoria 2 — Resumo semanal automático
//   Todo domingo às 20h (Brasília): envia resumo financeiro
//   da semana com comparação e frase motivadora.
// ─────────────────────────────────────────────────────────
const cron          = require('node-cron')
const { query, queryWithUser } = require('../config/database')
const { sendMessage }          = require('../services/whatsappSender')

// ── Busca todos os usuários Plus ativos com telefone ──────
async function getPlusUsersWithPhones() {
  const result = await query(`
    SELECT u.id, u.nome, up.phone
    FROM usuarios u
    JOIN user_phones up ON up.user_id = u.id
    WHERE u.plan = 'plus'
      AND u.ativo = TRUE
      AND up.phone IS NOT NULL
      AND up.phone != ''
  `)
  return result.rows
}

// ── Formata valor em BRL ──────────────────────────────────
function fmtBRL(valor) {
  return 'R$ ' + parseFloat(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// ════════════════════════════════════════════════════════════
// MELHORIA 1 — ALERTAS INTELIGENTES
// ════════════════════════════════════════════════════════════

// Retorna a contagem de registros (vendas + despesas) nas últimas 48h
async function contarAtividadeRecente(userId) {
  try {
    const res = await queryWithUser(userId, `
      SELECT (
        (SELECT COUNT(*) FROM vendas   WHERE user_id = $1 AND criado_em >= NOW() - INTERVAL '48 hours') +
        (SELECT COUNT(*) FROM despesas WHERE user_id = $1 AND criado_em >= NOW() - INTERVAL '48 hours')
      ) AS total
    `, [userId])
    return parseInt(res.rows[0]?.total || 0)
  } catch (err) {
    console.error(`[CRON] Erro ao verificar atividade do usuário ${userId}:`, err.message)
    return 1  // fallback: assume atividade para não gerar spam
  }
}

async function runDailyAlerts() {
  console.log('[CRON] ▶ Iniciando verificação de alertas diários...')
  let users
  try {
    users = await getPlusUsersWithPhones()
    console.log(`[CRON] ${users.length} usuário(s) Plus encontrado(s)`)
  } catch (err) {
    console.error('[CRON] Falha ao buscar usuários Plus:', err.message)
    return
  }

  for (const user of users) {
    try {
      const atividade = await contarAtividadeRecente(user.id)
      if (atividade === 0) {
        const primeiroNome = user.nome.split(' ')[0]
        const msg =
          `Oi ${primeiroNome}! 👋 Notei que não registrei nenhuma movimentação sua hoje.\n\n` +
          `Teve alguma venda ou despesa? Me conta que eu anoto pra você! 😊`
        await sendMessage(user.phone, msg)
        console.log(`[CRON] Alerta diário enviado → ${user.phone}`)
      } else {
        console.log(`[CRON] Usuário ${user.id} teve ${atividade} registro(s) — sem alerta`)
      }
    } catch (err) {
      console.error(`[CRON] Erro ao processar alerta para ${user.id}:`, err.message)
    }
  }
  console.log('[CRON] ✔ Verificação de alertas diários concluída')
}

// ════════════════════════════════════════════════════════════
// MELHORIA 2 — RESUMO SEMANAL AUTOMÁTICO
// ════════════════════════════════════════════════════════════

// Soma receita, despesas e lucro de um intervalo de datas
async function getResumoFinanceiro(userId, dataInicio, dataFim) {
  const [vendasRes, despesasRes] = await Promise.all([
    queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS total
       FROM vendas
       WHERE user_id = $1 AND data >= $2 AND data <= $3`,
      [userId, dataInicio, dataFim]
    ).catch(() => ({ rows: [{ total: 0 }] })),

    queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS total
       FROM despesas
       WHERE user_id = $1 AND data >= $2 AND data <= $3`,
      [userId, dataInicio, dataFim]
    ).catch(() => ({ rows: [{ total: 0 }] })),
  ])
  const receita  = parseFloat(vendasRes.rows[0].total)
  const despesas = parseFloat(despesasRes.rows[0].total)
  const lucro    = receita - despesas
  return { receita, despesas, lucro }
}

// Retorna a meta de lucro do mês corrente (tabela metas > meta_lucro do perfil)
async function getMetaMensal(userId) {
  try {
    const agora = new Date()
    const mes   = agora.getMonth() + 1
    const ano   = agora.getFullYear()

    const metaRes = await queryWithUser(userId,
      `SELECT valor_meta FROM metas WHERE user_id = $1 AND mes = $2 AND ano = $3 LIMIT 1`,
      [userId, mes, ano]
    ).catch(() => ({ rows: [] }))

    if (metaRes.rows.length && parseFloat(metaRes.rows[0].valor_meta) > 0) {
      return parseFloat(metaRes.rows[0].valor_meta)
    }

    // Fallback: campo meta_lucro do perfil do usuário
    const userRes = await query(
      `SELECT meta_lucro FROM usuarios WHERE id = $1`,
      [userId]
    ).catch(() => ({ rows: [] }))

    return parseFloat(userRes.rows[0]?.meta_lucro) || 0
  } catch (err) {
    console.error(`[CRON] Erro ao buscar meta de ${userId}:`, err.message)
    return 0
  }
}

// Frase motivadora dinâmica baseada no % de atingimento da meta
function getFraseMotivadora(percentual) {
  if (percentual < 30) {
    return 'Ainda dá tempo de acelerar! Cada venda conta. 🚀'
  } else if (percentual < 70) {
    return 'Ótimo ritmo! Continue focado e você chega lá! 💪'
  } else {
    return 'Incrível! Você está mandando muito bem! 🎉'
  }
}

async function runWeeklySummary() {
  console.log('[CRON] ▶ Iniciando envio de resumos semanais...')
  let users
  try {
    users = await getPlusUsersWithPhones()
    console.log(`[CRON] ${users.length} usuário(s) Plus para resumo semanal`)
  } catch (err) {
    console.error('[CRON] Falha ao buscar usuários Plus:', err.message)
    return
  }

  const agora = new Date()

  // Semana atual: últimos 7 dias (incluindo hoje = domingo)
  const fimSemana   = new Date(agora)
  fimSemana.setHours(23, 59, 59, 999)
  const inicioSemana = new Date(agora)
  inicioSemana.setDate(agora.getDate() - 6)
  inicioSemana.setHours(0, 0, 0, 0)

  // Semana anterior
  const fimSemanaAnterior   = new Date(inicioSemana)
  fimSemanaAnterior.setDate(fimSemanaAnterior.getDate() - 1)
  fimSemanaAnterior.setHours(23, 59, 59, 999)
  const inicioSemanaAnterior = new Date(fimSemanaAnterior)
  inicioSemanaAnterior.setDate(fimSemanaAnterior.getDate() - 6)
  inicioSemanaAnterior.setHours(0, 0, 0, 0)

  // Mês inteiro (para cálculo do % da meta mensal)
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1)
  const fimMes    = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59)

  for (const user of users) {
    try {
      const [semanaAtual, semanaAnterior, mesAtual, metaMensal] = await Promise.all([
        getResumoFinanceiro(user.id, inicioSemana, fimSemana),
        getResumoFinanceiro(user.id, inicioSemanaAnterior, fimSemanaAnterior),
        getResumoFinanceiro(user.id, inicioMes, fimMes),
        getMetaMensal(user.id),
      ])

      const primeiroNome = user.nome.split(' ')[0]
      const margem       = semanaAtual.receita > 0
        ? ((semanaAtual.lucro / semanaAtual.receita) * 100).toFixed(0)
        : '0'

      // Comparação semana a semana
      let comparacaoStr, comparacaoEmoji
      if (semanaAnterior.lucro !== 0) {
        const delta = ((semanaAtual.lucro - semanaAnterior.lucro) / Math.abs(semanaAnterior.lucro)) * 100
        comparacaoStr  = `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}% de lucro`
        comparacaoEmoji = delta >= 0 ? '📈' : '📉'
      } else if (semanaAtual.lucro > 0) {
        comparacaoStr  = 'primeira semana com lucro registrado!'
        comparacaoEmoji = '📈'
      } else {
        comparacaoStr  = 'sem comparativo disponível ainda'
        comparacaoEmoji = '📊'
      }

      // Linha de meta (só aparece se tiver meta cadastrada)
      let metaLinha = ''
      if (metaMensal > 0) {
        const percentual = Math.min((mesAtual.lucro / metaMensal) * 100, 100)
        const frase      = getFraseMotivadora(percentual)
        metaLinha = `\n🎯 Meta do mês: você está em ${percentual.toFixed(0)}% — ${frase}`
      }

      const msg =
        `📊 Resumo da semana, ${primeiroNome}!\n\n` +
        `💰 Receita: ${fmtBRL(semanaAtual.receita)}\n` +
        `💸 Despesas: ${fmtBRL(semanaAtual.despesas)}\n` +
        `✅ Lucro: ${fmtBRL(semanaAtual.lucro)} (margem ${margem}%)\n\n` +
        `${comparacaoEmoji} Comparado à semana passada: ${comparacaoStr}` +
        metaLinha +
        `\n\nContinue assim! 💪`

      await sendMessage(user.phone, msg)
      console.log(`[CRON] Resumo semanal enviado → ${user.phone}`)
    } catch (err) {
      console.error(`[CRON] Erro ao enviar resumo semanal para ${user.id}:`, err.message)
    }
  }
  console.log('[CRON] ✔ Resumo semanal concluído')
}

// ════════════════════════════════════════════════════════════
// REGISTRO DOS CRON JOBS
// ════════════════════════════════════════════════════════════
function initCronJobs() {
  // Alerta diário: todos os dias às 19h (horário de Brasília)
  cron.schedule('0 19 * * *', () => {
    runDailyAlerts().catch(err =>
      console.error('[CRON] Erro inesperado em runDailyAlerts:', err.message)
    )
  }, { timezone: 'America/Sao_Paulo' })

  // Resumo semanal: todo domingo às 20h (horário de Brasília)
  cron.schedule('0 20 * * 0', () => {
    runWeeklySummary().catch(err =>
      console.error('[CRON] Erro inesperado em runWeeklySummary:', err.message)
    )
  }, { timezone: 'America/Sao_Paulo' })

  console.log('✅ Cron jobs proativos iniciados:')
  console.log('   📅 Alertas diários  → todos os dias às 19h (Brasília)')
  console.log('   📊 Resumo semanal   → domingo às 20h (Brasília)')
}

module.exports = { initCronJobs, runDailyAlerts, runWeeklySummary }
