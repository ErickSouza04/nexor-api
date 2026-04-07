// src/controllers/whatsappController.js
// Agente WhatsApp — orquestra parser Groq + handlers de intent
// + envio via Z-API
//
// Fluxo do webhook:
//   1. Recebe payload da Z-API
//   2. Extrai phone + text do payload
//   3. Busca userId em user_phones
//   4. Verifica plano 'plus'
//   5. Carrega histórico de conversa do usuário (memória)
//   6. Detecta análise de meta financeira (palavras-chave)
//   7. Chama groqParser.parseMessage() com histórico de contexto
//   8. Roteia pelo intent → executa operação no banco
//   9. Salva mensagem do usuário + resposta no histórico
//  10. Responde via whatsappSender.sendMessage()
// ─────────────────────────────────────────────────────────
const { query, queryWithUser, transaction } = require('../config/database')
const { parseMessage }        = require('../services/groqParser')
const { sendMessage }         = require('../services/whatsappSender')
const { transcribeAudio }     = require('../services/whisperTranscriber')
const { getHistory, saveMessage: saveHistory } = require('../services/conversationHistory')
const { detectWeakDayPattern } = require('../services/patternDetection')

// ── Mensagens fixas ──────────────────────────────────────
const MSG_CADASTRO = '👋 Para usar o assistente financeiro via WhatsApp, primeiro vincule este número em *Configurações → WhatsApp* no app Nexor.'
const MSG_UPGRADE  = '📊 O assistente via WhatsApp é exclusivo do Plano Plus. Acesse o app Nexor para fazer upgrade.'
const MSG_ERRO_IA  = '🤖 Não consegui entender sua mensagem agora. Tente reformular ou acesse o app Nexor.'
const MSG_AJUDA    = '🤖 Não entendi. Tente assim:\n• *Vendi 3 salgados por R$ 15*\n• *Paguei R$ 50 de embalagem*\n• *Comprei 5kg de farinha para o estoque*\n• *Quanto tenho de farinha?*\n• *Qual meu lucro este mês?*'

// ── Converte 'hoje'/'ontem' para ISO date string ─────────
function resolverData(data) {
  if (!data || data === 'hoje') return new Date().toISOString().split('T')[0]
  if (data === 'ontem') {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().split('T')[0]
  }
  return data  // assume ISO YYYY-MM-DD
}

// ── Converte periodo para { inicio, fim, label } ─────────
function resolverPeriodo(periodo) {
  const hoje = new Date()
  const ano  = hoje.getFullYear()
  const mes  = hoje.getMonth()
  const dia  = hoje.getDate()

  switch (periodo) {
    case 'hoje':
      return {
        inicio: new Date(ano, mes, dia, 0, 0, 0),
        fim:    new Date(ano, mes, dia, 23, 59, 59),
        label:  'hoje'
      }
    case 'ontem':
      return {
        inicio: new Date(ano, mes, dia - 1, 0, 0, 0),
        fim:    new Date(ano, mes, dia - 1, 23, 59, 59),
        label:  'ontem'
      }
    case 'semana':
    case 'essa_semana':
    case 'esta_semana': {
      const inicioSemana = new Date(ano, mes, dia - hoje.getDay())
      inicioSemana.setHours(0, 0, 0, 0)
      return { inicio: inicioSemana, fim: hoje, label: 'semana atual' }
    }
    case 'mes_passado':
      return {
        inicio: new Date(ano, mes - 1, 1),
        fim:    new Date(ano, mes, 0, 23, 59, 59),
        label:  'mês passado'
      }
    default: // 'mes', 'este_mes', qualquer outro
      return {
        inicio: new Date(ano, mes, 1),
        fim:    new Date(ano, mes + 1, 0, 23, 59, 59),
        label:  new Date().toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
      }
  }
}

// ── Formata valor monetário ───────────────────────────────
function fmt(valor) {
  return 'R$ ' + parseFloat(valor).toFixed(2).replace('.', ',')
}

// ── Nome do mês atual em PT-BR ───────────────────────────
function nomeMesAtual() {
  return new Date().toLocaleString('pt-BR', { month: 'long' })
}

// ─────────────────────────────────────────────────────────
// HANDLERS POR INTENT
// Todos recebem (userId, parsed) e retornam string de resposta
// ─────────────────────────────────────────────────────────

async function handleDespesa(userId, parsed) {
  if (!parsed.valor) {
    return '❓ Quanto foi a despesa? Tente: *Paguei R$ 50 de embalagem*'
  }
  const data = resolverData(parsed.data)
  await queryWithUser(userId,
    `INSERT INTO despesas (user_id, valor, categoria, pagamento, descricao, data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      userId,
      parsed.valor,
      parsed.categoria || 'Outros',
      'Pix',
      parsed.produto || null,
      data,
    ]
  )
  const desc = parsed.produto ? ` (${parsed.produto})` : ''
  return `✅ Despesa de ${fmt(parsed.valor)}${desc} registrada!`
}

async function handleVenda(userId, parsed) {
  if (!parsed.valor) {
    return '❓ Qual foi o valor da venda? Tente: *Vendi 3 bolos por R$ 30*'
  }
  const data = resolverData(parsed.data)
  await queryWithUser(userId,
    `INSERT INTO vendas (user_id, valor, categoria, pagamento, produto, data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      userId,
      parsed.valor,
      parsed.categoria || 'Produto',
      'Pix',
      parsed.produto || null,
      data,
    ]
  )
  const prod = parsed.produto ? ` de ${parsed.produto}` : ''
  return `✅ Venda${prod} de ${fmt(parsed.valor)} registrada!`
}

async function handleEstoqueEntrada(userId, parsed) {
  if (!parsed.produto) {
    return '❓ Qual produto entrou no estoque? Tente: *Chegaram 5kg de farinha por R$ 25*'
  }
  if (!parsed.quantidade) {
    return `❓ Qual a quantidade de *${parsed.produto}* que entrou? Tente: *Chegaram 5kg de ${parsed.produto}*`
  }

  // Busca produto pelo nome (ILIKE)
  const prodResult = await queryWithUser(userId,
    `SELECT id, name, unit, current_stock
     FROM products WHERE user_id = $1 AND name ILIKE $2 LIMIT 1`,
    [userId, `%${parsed.produto}%`]
  )
  if (!prodResult.rows.length) {
    return `❌ Produto *${parsed.produto}* não encontrado. Cadastre-o primeiro no app Nexor em *Estoque → Produtos*.`
  }

  const produto = prodResult.rows[0]
  const data    = resolverData(parsed.data)

  const resultado = await transaction(userId, async (client) => {
    // Insere movimentação de entrada
    const mov = await client.query(
      `INSERT INTO stock_movements (product_id, user_id, type, quantity, unit_price, source, raw_message)
       VALUES ($1, $2, 'entrada', $3, $4, 'whatsapp', $5)
       RETURNING id`,
      [
        produto.id,
        userId,
        parsed.quantidade,
        parsed.valor ? (parsed.valor / parsed.quantidade) : null,
        `Entrada via WhatsApp: ${parsed.produto} x${parsed.quantidade}`,
      ]
    )

    // Atualiza estoque
    const atualizado = await client.query(
      `UPDATE products SET current_stock = current_stock + $1 WHERE id = $2
       RETURNING current_stock`,
      [parsed.quantidade, produto.id]
    )

    // Cria despesa linkada se valor informado
    if (parsed.valor) {
      await client.query(
        `INSERT INTO despesas (user_id, valor, categoria, pagamento, descricao, data)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          parsed.valor,
          'Matéria-prima',
          'Pix',
          `Compra de ${parsed.quantidade} ${produto.unit} de ${produto.name}`,
          data,
        ]
      )
    }

    return atualizado.rows[0].current_stock
  })

  const valorInfo = parsed.valor ? ` por ${fmt(parsed.valor)}` : ''
  return `📦 Entrada de ${parsed.quantidade} ${produto.unit} de *${produto.name}*${valorInfo} registrada!\nEstoque atual: *${resultado} ${produto.unit}*`
}

async function handleEstoqueSaida(userId, parsed) {
  if (!parsed.produto) {
    return '❓ Qual produto saiu do estoque? Tente: *Usei 2kg de farinha*'
  }
  if (!parsed.quantidade) {
    return `❓ Qual a quantidade de *${parsed.produto}* que saiu?`
  }

  const prodResult = await queryWithUser(userId,
    `SELECT id, name, unit, current_stock
     FROM products WHERE user_id = $1 AND name ILIKE $2 LIMIT 1`,
    [userId, `%${parsed.produto}%`]
  )
  if (!prodResult.rows.length) {
    return `❌ Produto *${parsed.produto}* não encontrado. Cadastre-o primeiro no app Nexor.`
  }

  const produto     = prodResult.rows[0]
  const estoqueAtual = parseFloat(produto.current_stock)

  if (parsed.quantidade > estoqueAtual) {
    return `❌ Estoque insuficiente. Você tem apenas *${estoqueAtual} ${produto.unit}* de *${produto.name}*.`
  }

  const data = resolverData(parsed.data)

  const resultado = await transaction(userId, async (client) => {
    const mov = await client.query(
      `INSERT INTO stock_movements (product_id, user_id, type, quantity, unit_price, source, raw_message)
       VALUES ($1, $2, 'saida', $3, $4, 'whatsapp', $5)
       RETURNING id`,
      [
        produto.id,
        userId,
        parsed.quantidade,
        parsed.valor ? (parsed.valor / parsed.quantidade) : null,
        `Saída via WhatsApp: ${parsed.produto} x${parsed.quantidade}`,
      ]
    )

    const atualizado = await client.query(
      `UPDATE products SET current_stock = current_stock - $1 WHERE id = $2
       RETURNING current_stock`,
      [parsed.quantidade, produto.id]
    )

    // Cria venda linkada se valor informado
    if (parsed.valor) {
      await client.query(
        `INSERT INTO vendas (user_id, valor, categoria, pagamento, produto, data)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          parsed.valor,
          parsed.categoria || 'Produto',
          'Pix',
          produto.name,
          data,
        ]
      )
    }

    return atualizado.rows[0].current_stock
  })

  const valorInfo = parsed.valor ? ` por ${fmt(parsed.valor)}` : ''
  return `📦 Saída de ${parsed.quantidade} ${produto.unit} de *${produto.name}*${valorInfo} registrada!\nEstoque atual: *${resultado} ${produto.unit}*`
}

async function handleConsultaEstoque(userId, parsed) {
  if (!parsed.produto) {
    // Retorna resumo de produtos com estoque baixo
    const alertas = await queryWithUser(userId,
      `SELECT name, current_stock, unit, min_stock_alert
       FROM products WHERE user_id = $1 AND current_stock <= min_stock_alert
       ORDER BY (current_stock - min_stock_alert) ASC LIMIT 5`,
      [userId]
    )
    if (!alertas.rows.length) {
      return '📦 Todos os produtos estão com estoque normal!'
    }
    const lista = alertas.rows.map(p =>
      `• *${p.name}*: ${p.current_stock} ${p.unit} (mín: ${p.min_stock_alert})`
    ).join('\n')
    return `⚠️ Produtos com estoque baixo:\n${lista}`
  }

  const result = await queryWithUser(userId,
    `SELECT name, current_stock, unit, min_stock_alert
     FROM products WHERE user_id = $1 AND name ILIKE $2 LIMIT 3`,
    [userId, `%${parsed.produto}%`]
  )

  if (!result.rows.length) {
    return `❌ Produto *${parsed.produto}* não encontrado no seu catálogo.`
  }

  if (result.rows.length === 1) {
    const p = result.rows[0]
    const alerta = parseFloat(p.current_stock) <= parseFloat(p.min_stock_alert) ? ' ⚠️ _estoque baixo_' : ''
    return `📦 *${p.name}*: ${p.current_stock} ${p.unit}${alerta}`
  }

  const lista = result.rows.map(p => `• *${p.name}*: ${p.current_stock} ${p.unit}`).join('\n')
  return `📦 Produtos encontrados:\n${lista}`
}

// ─────────────────────────────────────────────────────────
// ANÁLISE PREDITIVA E DE METAS
// ─────────────────────────────────────────────────────────

// Palavras-chave que ativam a análise de metas
const GOAL_KEYWORDS = [
  'meta', 'chegar em', 'possível fechar', 'possivel fechar',
  'projeção', 'projecao', 'quanto vou lucrar', 'quanto vou faturar',
  '100k', '200k', '300k', '400k', '500k',
]

/**
 * Retorna true se a mensagem contém palavras-chave de análise de metas.
 */
function detectaAnaliseMetaFinanceira(text) {
  const lower = text.toLowerCase()
  return GOAL_KEYWORDS.some(kw => lower.includes(kw))
}

/**
 * Extrai o valor numérico de uma meta mencionada na mensagem.
 * Suporta formatos: "100k", "R$ 50.000", "200.000", "50000"
 */
function extrairMetaValor(text) {
  // Formato "NUMk" ex: 100k, 50k
  const kMatch = text.match(/(\d+(?:[.,]\d+)?)\s*k\b/i)
  if (kMatch) return parseFloat(kMatch[1].replace(',', '.')) * 1000

  // Formato "R$ 100.000" ou "100.000,00"
  const reaisMatch = text.match(/R\$?\s*([\d.]+(?:,\d{1,2})?)/i)
  if (reaisMatch) {
    const raw = reaisMatch[1].replace(/\./g, '').replace(',', '.')
    const val = parseFloat(raw)
    if (!isNaN(val) && val > 0) return val
  }

  // Número puro com 4+ dígitos (ex: 50000)
  const numMatch = text.match(/\b(\d{4,})\b/)
  if (numMatch) return parseFloat(numMatch[1])

  return null
}

/**
 * Busca dados financeiros do mês atual e calcula projeção + comparação com meta.
 * storedMetaValor: meta cadastrada no perfil do usuário (fallback se não mencionar valor na mensagem)
 */
async function handleAnaliseMetaFinanceira(userId, messageText, storedMetaValor = null) {
  const hoje        = new Date()
  const ano         = hoje.getFullYear()
  const mes         = hoje.getMonth()
  const diaAtual    = hoje.getDate()
  const diasNoMes   = new Date(ano, mes + 1, 0).getDate()
  const diasRestantes = diasNoMes - diaAtual

  const inicioMes = new Date(ano, mes, 1)
  const fimMes    = new Date(ano, mes + 1, 0, 23, 59, 59)

  const [vendasRes, despesasRes] = await Promise.all([
    queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS total FROM vendas
       WHERE user_id = $1 AND data >= $2 AND data <= $3`,
      [userId, inicioMes, fimMes]
    ),
    queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS total FROM despesas
       WHERE user_id = $1 AND data >= $2 AND data <= $3`,
      [userId, inicioMes, fimMes]
    ),
  ])

  const receita    = parseFloat(vendasRes.rows[0].total)
  const custos     = parseFloat(despesasRes.rows[0].total)
  const lucroAtual = receita - custos

  // Projeção proporcional: (lucro_atual / dias_passados) * dias_totais_mes
  const lucroProjetado   = diaAtual > 0 ? (lucroAtual / diaAtual) * diasNoMes : 0
  const receitaProjetada = diaAtual > 0 ? (receita / diaAtual) * diasNoMes : 0

  const nomeMes   = hoje.toLocaleString('pt-BR', { month: 'long' })
  // Prioridade: valor mencionado na mensagem > meta cadastrada no perfil
  const metaValor = extrairMetaValor(messageText) || storedMetaValor

  if (!metaValor) {
    // Sem meta específica — exibe só a projeção
    return (
      `📊 *Projeção para ${nomeMes}*\n\n` +
      `Dia ${diaAtual}/${diasNoMes} — ${diasRestantes} dias restantes\n\n` +
      `Acumulado até agora:\n` +
      `• Receita: ${fmt(receita)}\n` +
      `• Despesas: ${fmt(custos)}\n` +
      `• Lucro: *${fmt(lucroAtual)}*\n\n` +
      `Projeção para o mês completo:\n` +
      `• Receita: ${fmt(receitaProjetada)}\n` +
      `• Lucro: *${fmt(lucroProjetado)}*`
    )
  }

  if (lucroProjetado >= metaValor) {
    const excedente = lucroProjetado - metaValor
    return (
      `🚀 *Projeção para ${nomeMes}*\n\n` +
      `Você está no dia ${diaAtual} com *${fmt(lucroAtual)}* de lucro. ` +
      `Sua projeção para o mês é *${fmt(lucroProjetado)}*, ` +
      `então já vai superar sua meta de *${fmt(metaValor)}*! Continue assim! 🎉\n\n` +
      `Vai superar em *${fmt(excedente)}* acima da meta.`
    )
  }

  // Ritmo atual insuficiente — calcula quanto precisa por dia
  const lucroNecessario = metaValor - lucroAtual
  const porDia = diasRestantes > 0 ? lucroNecessario / diasRestantes : lucroNecessario

  return (
    `📊 *Projeção para ${nomeMes}*\n\n` +
    `Você está no dia ${diaAtual} com *${fmt(lucroAtual)}* de lucro.\n` +
    `Sua projeção atual é *${fmt(lucroProjetado)}*, mas sua meta é *${fmt(metaValor)}*.\n\n` +
    `Para atingir a meta, você precisa gerar *${fmt(porDia)}/dia* nos próximos ${diasRestantes} dias. Vamos lá! 💪`
  )
}

async function handleConsultaLucro(userId, periodo) {
  const { inicio, fim, label } = resolverPeriodo(periodo)

  const [vendas, despesas] = await Promise.all([
    queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS total FROM vendas
       WHERE user_id = $1 AND data >= $2 AND data <= $3`,
      [userId, inicio, fim]
    ),
    queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS total FROM despesas
       WHERE user_id = $1 AND data >= $2 AND data <= $3`,
      [userId, inicio, fim]
    ),
  ])

  const receita = parseFloat(vendas.rows[0].total)
  const custos  = parseFloat(despesas.rows[0].total)
  const lucro   = receita - custos
  const margem  = receita > 0 ? ((lucro / receita) * 100).toFixed(1) : '0.0'
  const emoji   = lucro >= 0 ? '💰' : '⚠️'

  return `${emoji} *${label}*\nReceita: ${fmt(receita)}\nDespesas: ${fmt(custos)}\nLucro: *${fmt(lucro)}* (margem ${margem}%)`
}

// ─────────────────────────────────────────────────────────
// WEBHOOK PRINCIPAL
// ─────────────────────────────────────────────────────────
const handleWebhook = async (req, res) => {
  try {
    const body = req.body || {}

    // ── Ignora callbacks de status (entregue, lido, falhou, etc.) ──
    if (body.type === 'MessageStatusCallback') return res.sendStatus(200)

    res.sendStatus(200)

    console.log('================ WEBHOOK RECEBIDO ================')
    console.log('[WHATSAPP] payload completo:', JSON.stringify(body, null, 2))

    // ── Extração dos campos — suporta Z-API real + Hoppscotch ──
    const phone     = body.phone || body.connectedPhone || ''
    const text      = body?.text?.message || body?.message?.text || body?.message || ''
    const messageId = body.messageId || body.id || null
    const type      = body.type || body.event || ''
    const fromMe    = body.fromMe === true
    const isAudio   = !!body?.audio?.audioUrl
    const audioUrl  = body?.audio?.audioUrl || null
    const mimeType  = body?.audio?.mimeType || 'audio/ogg'

    console.log('[WHATSAPP] phone extraído:', phone)
    console.log('[WHATSAPP] text extraído:', text)
    console.log('[WHATSAPP] messageId:', messageId)
    console.log('[WHATSAPP] type:', type)
    console.log('[WHATSAPP] fromMe:', fromMe)
    console.log('[WHATSAPP] isAudio:', isAudio, '| audioUrl:', audioUrl)

    // ── Ignora mensagens enviadas pelo próprio bot ──────────
    if (fromMe) {
      console.log('[WHATSAPP] Mensagem fromMe — ignorando')
      return
    }

    // ── Ignora eventos sem número de origem ────────────────
    if (!phone) {
      console.log('[WHATSAPP] phone vazio — ignorando')
      return
    }

    // ── Ignora webhooks sem conteúdo processável ───────────
    if (!text && !isAudio) {
      console.log('[WHATSAPP] Sem texto nem áudio — ignorando (type:', type, ')')
      return
    }

    // ── Gera as duas variantes do número brasileiro (com/sem nono dígito) ─
    const phoneBRVariants = (raw) => {
      const digits = String(raw).replace(/\D/g, '')
      const sem55 = digits.startsWith('55') ? digits.slice(2) : digits
      if (sem55.length === 11) {
        // tem o 9: gera sem o 9
        const sem9 = sem55.slice(0, 2) + sem55.slice(3)
        return ['55' + sem55, '55' + sem9]
      } else if (sem55.length === 10) {
        // sem o 9: gera com o 9
        const com9 = sem55.slice(0, 2) + '9' + sem55.slice(2)
        return ['55' + sem55, '55' + com9]
      }
      return [digits]
    }

    // ── Busca userId pelo número cadastrado ─────────────────
    const variants = phoneBRVariants(phone)
    const phoneNorm = variants[0]   // forma canônica para envio de respostas
    console.log('[WHATSAPP] variantes buscadas:', variants)

    const phoneResult = await query(
      'SELECT user_id, phone FROM user_phones WHERE phone = ANY($1) LIMIT 1',
      [variants]
    )

    console.log('[WHATSAPP] resultado query:', phoneResult.rows)

    if (!phoneResult.rows.length) {
      await sendMessage(phoneNorm, MSG_CADASTRO, messageId)
      return
    }

    const userId = phoneResult.rows[0].user_id
    console.log('[WHATSAPP] userId:', userId)

    const userInfo = await query(
      'SELECT nome, plan, ativo, pro_labore, meta_lucro FROM usuarios WHERE id = $1',
      [userId]
    )

    console.log('[WHATSAPP] userInfo:', userInfo.rows)

    if (!userInfo.rows.length) {
      await sendMessage(phoneNorm, '❌ Usuário não encontrado.', messageId)
      return
    }

    const user = userInfo.rows[0]

    if (!user.ativo || user.plan !== 'plus') {
      console.log('[WHATSAPP] Usuário sem plano plus')
      await sendMessage(phoneNorm, MSG_UPGRADE, messageId)
      return
    }

    // ── Carrega contexto do usuário: perfil + financeiro do mês ──
    let userContext = null
    try {
      const hoje        = new Date()
      const anoAtual    = hoje.getFullYear()
      const mesAtual    = hoje.getMonth()         // 0-based
      const mesNum      = mesAtual + 1            // 1-based para a tabela metas
      const diaAtual    = hoje.getDate()
      const diasNoMes   = new Date(anoAtual, mesAtual + 1, 0).getDate()
      const inicioMes   = new Date(anoAtual, mesAtual, 1)
      const fimMes      = new Date(anoAtual, mesAtual + 1, 0, 23, 59, 59)
      const nomeMes     = hoje.toLocaleString('pt-BR', { month: 'long' })

      const [metaRes, vendasMesRes, despesasMesRes] = await Promise.all([
        queryWithUser(userId,
          `SELECT valor_meta, pro_labore FROM metas WHERE user_id = $1 AND mes = $2 AND ano = $3 LIMIT 1`,
          [userId, mesNum, anoAtual]
        ).catch(() => ({ rows: [] })),
        queryWithUser(userId,
          `SELECT COALESCE(SUM(valor), 0) AS total FROM vendas WHERE user_id = $1 AND data >= $2 AND data <= $3`,
          [userId, inicioMes, fimMes]
        ),
        queryWithUser(userId,
          `SELECT COALESCE(SUM(valor), 0) AS total FROM despesas WHERE user_id = $1 AND data >= $2 AND data <= $3`,
          [userId, inicioMes, fimMes]
        ),
      ])

      const metaRow   = metaRes.rows[0]
      // Prioridade: meta do mês na tabela metas > meta_lucro do usuário
      const metaValor = metaRow?.valor_meta && parseFloat(metaRow.valor_meta) > 0
        ? parseFloat(metaRow.valor_meta)
        : (user.meta_lucro && parseFloat(user.meta_lucro) > 0 ? parseFloat(user.meta_lucro) : null)
      // Prioridade: pro_labore da meta do mês > pro_labore do usuário
      const proLabore = metaRow?.pro_labore && parseFloat(metaRow.pro_labore) > 0
        ? parseFloat(metaRow.pro_labore)
        : (user.pro_labore && parseFloat(user.pro_labore) > 0 ? parseFloat(user.pro_labore) : null)

      const receita        = parseFloat(vendasMesRes.rows[0].total)
      const despesas       = parseFloat(despesasMesRes.rows[0].total)
      const lucro          = receita - despesas
      const margem         = receita > 0 ? ((lucro / receita) * 100).toFixed(1) : '0.0'
      const lucroProjetado = diaAtual > 0 ? (lucro / diaAtual) * diasNoMes : 0

      userContext = {
        nome: user.nome,
        proLabore,
        metaValor,
        receita,
        despesas,
        lucro,
        margem,
        diaAtual,
        diasNoMes,
        lucroProjetado,
        nomeMes,
        anoAtual,
      }
      console.log('[WHATSAPP] userContext:', { nome: user.nome, metaValor, receita, lucro, diaAtual, diasNoMes })
    } catch (err) {
      console.warn('[WHATSAPP] Falha ao carregar userContext (continuando sem):', err.message)
    }

    // ── Melhoria 3: Detecção de padrão de vendas por dia da semana ──
    if (userContext) {
      try {
        const weakDayInsight = await detectWeakDayPattern(userId)
        if (weakDayInsight) {
          userContext.weakDayInsight = weakDayInsight
          console.log('[WHATSAPP] Padrão de vendas detectado:', weakDayInsight.substring(0, 80) + '...')
        }
      } catch (err) {
        console.warn('[WHATSAPP] Falha ao detectar padrão de vendas (continuando sem):', err.message)
      }
    }

    // ── Transcrição de áudio (Groq Whisper) se necessário ──
    let messageText = text
    if (isAudio && audioUrl) {
      console.log('[WHATSAPP] Tipo: ÁUDIO — iniciando transcrição Whisper:', audioUrl)
      const transcricao = await transcribeAudio(audioUrl, mimeType)
      if (!transcricao) {
        console.warn('[WHATSAPP] Transcrição falhou ou vazia')
        await sendMessage(phoneNorm, '🎤 Não consegui entender o áudio. Tente enviar uma mensagem de texto.', messageId)
        return
      }
      messageText = transcricao
      console.log('[WHATSAPP] Transcrição concluída:', messageText)
    } else {
      console.log('[WHATSAPP] Tipo: TEXTO —', messageText)
    }

    // ── Carrega histórico de conversa (memória) ─────────────
    let history = []
    try {
      history = await getHistory(userId, phoneNorm)
      console.log('[WHATSAPP] histórico carregado:', history.length, 'mensagens')
    } catch (err) {
      console.warn('[WHATSAPP] Falha ao carregar histórico (continuando sem):', err.message)
    }

    let resposta

    // ── Detecção de análise de metas ────────────────────────
    if (detectaAnaliseMetaFinanceira(messageText)) {
      console.log('[WHATSAPP] Detectado pedido de análise de meta financeira')
      try {
        resposta = await handleAnaliseMetaFinanceira(userId, messageText, userContext?.metaValor)
      } catch (err) {
        console.error('[WHATSAPP] Erro na análise de meta:', err.message)
        resposta = '❌ Não consegui calcular a projeção agora. Tente novamente.'
      }
    } else {
      // ── Parser Groq com contexto de histórico + perfil do usuário ─
      let parsed
      try {
        parsed = await parseMessage(messageText, history, userContext)
        console.log('[WHATSAPP] parsed:', parsed)
      } catch (err) {
        console.error('[WHATSAPP] Erro no Groq parser:', err.message)
        await sendMessage(phoneNorm, MSG_ERRO_IA, messageId)
        return
      }

      if (!parsed || !parsed.tipo) {
        console.log('[WHATSAPP] parsed inválido')
        await sendMessage(phoneNorm, MSG_ERRO_IA, messageId)
        return
      }

      try {
        switch (parsed.tipo) {
          case 'despesa':
            resposta = await handleDespesa(userId, parsed)
            break

          case 'venda':
            resposta = await handleVenda(userId, parsed)
            break

          case 'consulta_estoque':
            resposta = await handleConsultaEstoque(userId, parsed)
            break

          case 'estoque_entrada':
            resposta = await handleEstoqueEntrada(userId, parsed)
            break

          case 'estoque_saida':
            resposta = await handleEstoqueSaida(userId, parsed)
            break

          case 'consulta_financeira':
            if (parsed.metrica === 'lucro') {
              resposta = await handleConsultaLucro(userId, parsed.periodo)
            } else {
              resposta = MSG_AJUDA
            }
            break

          case 'conversa':
            resposta = parsed.resposta || MSG_ERRO_IA
            break

          default:
            resposta = MSG_AJUDA
        }
      } catch (err) {
        console.error(`[WHATSAPP] Erro no handler ${parsed.tipo}:`, err.message)
        resposta = '❌ Ocorreu um erro ao processar. Tente novamente ou acesse o app Nexor.'
      }
    }

    // ── Salva mensagem do usuário + resposta no histórico ───
    try {
      await saveHistory(userId, phoneNorm, 'user', messageText)
      await saveHistory(userId, phoneNorm, 'assistant', resposta)
    } catch (err) {
      console.warn('[WHATSAPP] Falha ao salvar histórico (não crítico):', err.message)
    }

    console.log('[WHATSAPP] enviando resposta para', phoneNorm, '(reply a', messageId, '):', resposta)
    await sendMessage(phoneNorm, resposta, messageId)

  } catch (err) {
    console.error('[WHATSAPP] Erro inesperado no webhook:', err)
  }
}

// ─────────────────────────────────────────────────────────
// VINCULAR TELEFONE AO USUÁRIO (requer JWT)
// ─────────────────────────────────────────────────────────
const registerPhone = async (req, res) => {
  try {
    const userId = req.userId
    const { phone } = req.body

    if (!phone) {
      return res.status(400).json({ sucesso: false, erro: 'Campo phone é obrigatório' })
    }

    const normalizedPhone = phone.replace(/\D/g, '')
    const finalPhone = normalizedPhone.startsWith('55')
      ? normalizedPhone
      : `55${normalizedPhone}`

    // Verifica se já vinculado a outro usuário
    const existente = await query(
      'SELECT user_id FROM user_phones WHERE phone = $1',
      [finalPhone]
    )

    if (
      existente.rows.length > 0 &&
      existente.rows[0].user_id !== userId
    ) {
      return res.status(409).json({
        sucesso: false,
        erro: 'Este número já está vinculado a outra conta'
      })
    }

    const resultado = await queryWithUser(
      userId,
      `INSERT INTO user_phones (user_id, phone)
       VALUES ($1, $2)
       ON CONFLICT (phone) 
       DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING *`,
      [userId, finalPhone]
    )

    return res.status(201).json({
      sucesso: true,
      mensagem: 'Número vinculado com sucesso!',
      dados: resultado.rows[0]
    })

  } catch (err) {
    console.error('Erro ao vincular telefone:', err)
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro ao vincular número'
    })
  }
}

// ─────────────────────────────────────────────────────────
// VERIFICAR STATUS DO NÚMERO
// ─────────────────────────────────────────────────────────
const verificarStatus = async (req, res) => {
  try {
    const userId = req.userId
    const resultado = await queryWithUser(userId,
      'SELECT id, phone, verified, created_at FROM user_phones WHERE user_id = $1',
      [userId]
    )
    res.json({
  sucesso: true,
  vinculado: resultado.rows.length > 0,
  dados: resultado.rows[0] || null
})
  } catch (err) {
    console.error('Erro ao verificar status WhatsApp:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao verificar status' })
  }
}

// ─────────────────────────────────────────────────────────
// ENVIAR MENSAGEM PROATIVA
// ─────────────────────────────────────────────────────────
const enviarMensagem = async (req, res) => {
  try {
    const userId = req.userId
    const { phone, message } = req.body

    if (!phone || !message) {
      return res.status(400).json({ sucesso: false, erro: 'phone e message são obrigatórios' })
    }

    // Verifica se o número pertence ao usuário autenticado
    const vinculo = await queryWithUser(userId,
      'SELECT id FROM user_phones WHERE user_id = $1 AND phone = $2',
      [userId, phone]
    )
    if (!vinculo.rows.length) {
      return res.status(403).json({ sucesso: false, erro: 'Número não vinculado a esta conta' })
    }

    await sendMessage(phone, message)
    res.json({ sucesso: true, mensagem: 'Mensagem enviada com sucesso' })
  } catch (err) {
    console.error('Erro ao enviar mensagem:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao enviar mensagem' })
  }
}

module.exports = { handleWebhook, registerPhone, verificarStatus, enviarMensagem }
