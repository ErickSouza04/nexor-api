// src/services/whatsappSender.js
// ─────────────────────────────────────────────────────────
// Envia mensagens via Evolution API
// Variáveis necessárias:
//   EVOLUTION_API_URL   — URL base da instância (ex: https://api.evolution.io)
//   EVOLUTION_API_KEY   — chave de autenticação
//   EVOLUTION_INSTANCE  — nome da instância (ex: nexor)
// ─────────────────────────────────────────────────────────

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))

// Envia mensagem de texto para um número WhatsApp
// phone: string com DDI+DDD+número (ex: 5511999999999)
// message: texto a enviar
async function sendMessage(phone, message) {
  const { EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE } = process.env

  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE) {
    console.warn('[WHATSAPP] Evolution API não configurada — mensagem não enviada:', message)
    return null
  }

  const url = `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`

  const response = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':       EVOLUTION_API_KEY,
    },
    body: JSON.stringify({
      number:      phone,
      textMessage: { text: message },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Evolution API ${response.status}: ${errorText}`)
  }

  return response.json()
}

module.exports = { sendMessage }
