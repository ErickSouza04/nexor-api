// src/services/whatsappSender.js
// ─────────────────────────────────────────────────────────
// Envia mensagens via Z-API
// Variáveis necessárias:
//   ZAPI_INSTANCE_ID — ID da instância Z-API
//   ZAPI_TOKEN       — token de autenticação Z-API
// ─────────────────────────────────────────────────────────

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))

// Envia mensagem de texto para um número WhatsApp
// phone: string com DDI+DDD+número (ex: 5511999999999)
// message: texto a enviar
async function sendMessage(phone, message) {
  const { ZAPI_INSTANCE_ID, ZAPI_TOKEN } = process.env

  if (!ZAPI_INSTANCE_ID || !ZAPI_TOKEN) {
    console.warn('[WHATSAPP] Z-API não configurada — mensagem não enviada:', message)
    return null
  }

  const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`

  const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`

  const response = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phone:   normalizedPhone,
      message: message,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Z-API ${response.status}: ${errorText}`)
  }

  return response.json()
}

module.exports = { sendMessage }
