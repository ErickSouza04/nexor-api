// src/services/whatsappSender.js
// ─────────────────────────────────────────────────────────
// Envia mensagens via Z-API
// ─────────────────────────────────────────────────────────

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))

const ZAPI_URL = 'https://api.z-api.io/instances/3F107A9ADBC541BEC6E47697CBA61602/token/E464A03380C4A24691DD81EE/send-text'
const ZAPI_CLIENT_TOKEN = 'F7b1a26d85ba74d25a6562adadfaf8fd3S'

// Envia mensagem de texto para um número WhatsApp
// phone: string com DDI+DDD+número (ex: 5511999999999)
// message: texto a enviar
async function sendMessage(phone, message) {
  const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`

  const response = await fetch(ZAPI_URL, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Token':  ZAPI_CLIENT_TOKEN,
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
