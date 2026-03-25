// src/controllers/whatsappController.js
// ─────────────────────────────────────────────────────────
// Controller de WhatsApp (tabelas: user_phones, whatsapp_sessions)
// user_id SEMPRE vem de req.userId (token JWT), exceto no webhook
// ─────────────────────────────────────────────────────────
const { queryWithUser, query } = require('../config/database')

// ── WEBHOOK — recebe mensagens do provedor WhatsApp ──────
// Sem auth JWT. Valida por token secreto no header.
const webhook = async (req, res) => {
  try {
    const tokenEnviado = req.headers['x-whatsapp-token']
    const tokenEsperado = process.env.WHATSAPP_WEBHOOK_SECRET

    if (!tokenEsperado) {
      console.warn('⚠️  WHATSAPP_WEBHOOK_SECRET não configurado')
    }

    if (!tokenEsperado || tokenEnviado !== tokenEsperado) {
      return res.status(401).json({ sucesso: false, erro: 'Token inválido' })
    }

    const { phone, message, intent } = req.body

    if (!phone) {
      return res.status(400).json({ sucesso: false, erro: 'Campo phone é obrigatório' })
    }

    // Busca sessão existente pelo phone para encontrar o user_id vinculado
    const sessaoExistente = await query(
      'SELECT id, user_id FROM whatsapp_sessions WHERE phone = $1',
      [phone]
    )
    const userId = sessaoExistente.rows[0]?.user_id || null

    // Upsert da sessão: atualiza contexto e último intent
    await query(
      `INSERT INTO whatsapp_sessions (phone, user_id, last_intent, last_message_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (phone)
       DO UPDATE SET
         last_intent     = EXCLUDED.last_intent,
         last_message_at = now()`,
      [phone, userId, intent || null]
    )

    // Estrutura preparada para expansão (processamento de mensagem, IA, etc.)
    console.log(`[WhatsApp] Mensagem recebida de ${phone}: ${message || '(sem texto)'}`)

    res.json({ sucesso: true, mensagem: 'Mensagem recebida' })
  } catch (err) {
    console.error('Erro no webhook WhatsApp:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao processar mensagem' })
  }
}

// ── VINCULAR telefone ao usuário ─────────────────────────
const vincularTelefone = async (req, res) => {
  try {
    const userId = req.userId
    const { phone } = req.body

    if (!phone) {
      return res.status(400).json({ sucesso: false, erro: 'Campo phone é obrigatório' })
    }

    // Verifica se o número já está vinculado a outro usuário
    const existente = await queryWithUser(userId,
      'SELECT user_id FROM user_phones WHERE phone = $1',
      [phone]
    )
    if (existente.rows.length > 0 && existente.rows[0].user_id !== userId) {
      return res.status(409).json({ sucesso: false, erro: 'Este número já está vinculado a outra conta' })
    }

    const resultado = await queryWithUser(userId,
      `INSERT INTO user_phones (user_id, phone)
       VALUES ($1, $2)
       ON CONFLICT (phone) DO NOTHING
       RETURNING *`,
      [userId, phone]
    )

    if (resultado.rows.length === 0) {
      return res.json({ sucesso: true, mensagem: 'Número já vinculado a esta conta', dados: null })
    }

    res.status(201).json({
      sucesso:  true,
      mensagem: 'Número vinculado com sucesso!',
      dados:    resultado.rows[0]
    })
  } catch (err) {
    console.error('Erro ao vincular telefone:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao vincular número' })
  }
}

// ── VERIFICAR status do número ───────────────────────────
const verificarStatus = async (req, res) => {
  try {
    const userId = req.userId

    const resultado = await queryWithUser(userId,
      'SELECT id, phone, verified, created_at FROM user_phones WHERE user_id = $1',
      [userId]
    )

    res.json({
      sucesso:   true,
      vinculado: resultado.rows.length > 0,
      dados:     resultado.rows
    })
  } catch (err) {
    console.error('Erro ao verificar status WhatsApp:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao verificar status' })
  }
}

// ── ENVIAR mensagem proativa ──────────────────────────────
// Placeholder — requer integração com provedor WhatsApp (ex: Twilio, Z-API, Evolution API)
const enviarMensagem = async (req, res) => {
  res.status(501).json({
    sucesso: false,
    erro:    'Envio de mensagens proativas ainda não implementado. Aguarde integração com o provedor WhatsApp.',
    codigo:  'NAO_IMPLEMENTADO'
  })
}

module.exports = { webhook, vincularTelefone, verificarStatus, enviarMensagem }
