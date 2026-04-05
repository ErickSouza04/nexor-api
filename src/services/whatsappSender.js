// src/services/whatsappSender.js
// ─────────────────────────────────────────────────────────
// Envia mensagens via Z-API
// ─────────────────────────────────────────────────────────
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))

const ZAPI_INSTANCE_ID = process.env.ZAPI_INSTANCE_ID
const ZAPI_TOKEN = process.env.ZAPI_TOKEN
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN

const ZAPI_URL = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`

async function sendMessage(phone, message) {
  const normalizedPhone = String(phone).startsWith('55') ? String(phone) : `55${phone}`

  console.log('[sendMessage] Enviando para:', normalizedPhone)
  console.log('[sendMessage] Mensagem:', message)
  console.log('[sendMessage] Z-API URL:', ZAPI_URL)

  const response = await fetch(ZAPI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Token': ZAPI_CLIENT_TOKEN,
    },
    body: JSON.stringify({
      phone: normalizedPhone,
      message,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Z-API ${response.status}: ${errorText}`)
  }

  return response.json()
}

module.exports = { sendMessage }