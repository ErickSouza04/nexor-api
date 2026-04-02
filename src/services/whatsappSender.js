// src/services/whatsappSender.js
// ─────────────────────────────────────────────────────────
// Envia mensagens via Z-API
// Variáveis necessárias:
//   ZAPI_INSTANCE_ID — ID da instância Z-API
//   ZAPI_TOKEN       — token de autenticação
//   ZAPI_URL         — URL base da API (ex: https://api.z-api.io)
// ─────────────────────────────────────────────────────────

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))

// Envia mensagem de texto para um número WhatsApp
// phone: string com DDD+número (ex: 11999887766) — "55" é adicionado automaticamente
// message: texto a enviar
async function sendMessage(phone, message) {
  const { ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_URL } = process.env

  if (!ZAPI_INSTANCE_ID || !ZAPI_TOKEN || !ZAPI_URL) {
    console.warn('[WHATSAPP] Z-API não configurada — mensagem não enviada:', message)
    return null
  }

  const url = `${ZAPI_URL}/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`

  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone:   `55${phone}`,
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
