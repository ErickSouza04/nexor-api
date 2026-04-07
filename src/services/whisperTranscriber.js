// src/services/whisperTranscriber.js
const axios    = require('axios')
const FormData = require('form-data')

const WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'

async function transcribeAudio(audioUrl, mimeType = 'audio/ogg') {
  if (!process.env.GROQ_API_KEY) {
    console.warn('[WHISPER] GROQ_API_KEY não configurada — transcrição ignorada')
    return null
  }

  // 1. Baixa o áudio como buffer binário
  const headers = {}
  if (process.env.EVOLUTION_API_KEY) {
    headers['apikey'] = process.env.EVOLUTION_API_KEY
  }

  const audioResponse = await axios.get(audioUrl, {
    headers,
    responseType: 'arraybuffer',
    timeout: 15000
  })
  const buffer = Buffer.from(audioResponse.data)

  // 2. Monta o multipart/form-data com boundary correto
  const cleanMime = mimeType.split(';')[0].trim() || 'audio/ogg'
  const form = new FormData()
  form.append('file', buffer, {
    filename:    'audio.ogg',
    contentType: cleanMime
  })
  form.append('model',           'whisper-large-v3-turbo')
  form.append('language',        'pt')
  form.append('response_format', 'text')

  // 3. Envia para o Groq com Content-Type gerado pelo form-data (inclui boundary)
  const result = await axios.post(WHISPER_URL, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`
    },
    timeout: 30000
  })

  return typeof result.data === 'string' ? result.data.trim() : null
}

module.exports = { transcribeAudio }
