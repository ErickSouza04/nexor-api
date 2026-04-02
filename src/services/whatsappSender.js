// src/services/whatsappSender.js
// ─────────────────────────────────────────────────────────
// Envia mensagens via Z-API
// ─────────────────────────────────────────────────────────

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))

const ZAPI_URL = 'https://api.z-api.io/instances/3F107A9ADBC541BEC6E47697CBA61602/token/E464A03380C4A24691DD81EE/send-text'
const ZAPI_CLIENT_TOKEN = 'Fc1f8853331cf46f1a526c4e6a2fdedb1S'

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
