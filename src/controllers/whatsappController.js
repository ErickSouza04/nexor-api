// src/controllers/whatsappController.js
// Agente WhatsApp — orquestra parser Groq + handlers de intent
// + envio via Z-API
//
// Fluxo do webhook:
//   1. Recebe payload da Z-API
//   2. Extrai phone + text do payload
//   3. Busca userId em user_phones
//   4. Verifica plano 'plus'
//   5. Chama groqParser.parseMessage()
//   6. Roteia pelo intent → executa operação no banco
//   7. Responde via whatsappSender.sendMessage()
// ─────────────────────────────────────────────────────────
const { query, queryWithUser, transaction } = require('../config/database')
const { parseMessage }     = require('../services/groqParser')
const { sendMessage }      = require('../services/whatsappSender')
const { transcribeAudio }  = require('../services/whisperTranscriber')

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

async function handleConsultaLucro(userId) {
  const mes = new Date().getMonth() + 1
  const ano = new Date().getFullYear()

  const [vendas, despesas] = await Promise.all([
    queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS total FROM vendas
       WHERE user_id = $1 AND EXTRACT(MONTH FROM data) = $2 AND EXTRACT(YEAR FROM data) = $3`,
      [userId, mes, ano]
    ),
    queryWithUser(userId,
      `SELECT COALESCE(SUM(valor), 0) AS total FROM despesas
       WHERE user_id = $1 AND EXTRACT(MONTH FROM data) = $2 AND EXTRACT(YEAR FROM data) = $3`,
      [userId, mes, ano]
    ),
  ])

  const receita  = parseFloat(vendas.rows[0].total)
  const custos   = parseFloat(despesas.rows[0].total)
  const lucro    = receita - custos
  const margem   = receita > 0 ? ((lucro / receita) * 100).toFixed(1) : '0.0'
  const emoji    = lucro >= 0 ? '💰' : '⚠️'

  return `${emoji} *${nomeMesAtual()}/${ano}*\nReceita: ${fmt(receita)}\nDespesas: ${fmt(custos)}\nLucro: *${fmt(lucro)}* (margem ${margem}%)`
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

    // ── Normaliza phone para formato brasileiro 55XXXXXXXXXX ─
    const normalizePhone = (value = '') => {
      const cleaned = String(value).replace(/\D/g, '')
      if (!cleaned) return ''
      return cleaned.startsWith('55') ? cleaned : `55${cleaned}`
    }

    const phoneNorm = normalizePhone(phone)
    console.log('[WHATSAPP] phone normalizado:', phoneNorm)

    // ── Busca userId pelo número cadastrado ─────────────────
    console.log('[WHATSAPP] buscando vínculo para:', phoneNorm)

    // [DEBUG TEMPORÁRIO] dump de todos os registros em user_phones
    const todos = await query('SELECT * FROM user_phones LIMIT 10')
    console.log('[DEBUG] todos os vínculos:', JSON.stringify(todos.rows))

    const phoneResult = await query(
      'SELECT user_id, phone FROM user_phones WHERE phone = $1 LIMIT 1',
      [phoneNorm]
    )

    console.log('[WHATSAPP] vínculo encontrado:', phoneResult.rows)

    if (!phoneResult.rows.length) {
      await sendMessage(phoneNorm, MSG_CADASTRO, messageId)
      return
    }

    const userId = phoneResult.rows[0].user_id
    console.log('[WHATSAPP] userId:', userId)

    const userInfo = await query(
      'SELECT nome, plan, ativo FROM usuarios WHERE id = $1',
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

    let parsed
    try {
      parsed = await parseMessage(messageText)
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

    let resposta

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
            resposta = await handleConsultaLucro(userId)
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
