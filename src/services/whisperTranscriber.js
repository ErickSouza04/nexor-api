// src/services/whisperTranscriber.js
// ─────────────────────────────────────────────────────────
// Transcreve áudios do WhatsApp via Groq Whisper API
// Reutiliza GROQ_API_KEY já configurada no projeto
//
// Suporta dois formatos da Evolution API:
//   · audioMessage.base64 — dado já em memória
//   · audioMessage.url    — faz download antes de transcrever
// ─────────────────────────────────────────────────────────

const axios    = require('axios')
const FormData = require('form-data')

const WHISPER_URL   = 'https://api.groq.com/openai/v1/audio/transcriptions'
const WHISPER_MODEL = 'whisper-large-v3-turbo'
const TIMEOUT_MS    = 20000  // 20s — upload de áudio é mais lento que texto

// ── Download de URL (Evolution API CDN) ──────────────────
async function downloadAudio(url) {
  const headers = {}
  // Evolution API CDN requer a apikey quando a URL não é pública
  if (process.env.EVOLUTION_API_KEY) {
    headers['apikey'] = process.env.EVOLUTION_API_KEY
  }

  const res = await axios.get(url, {
    headers,
    responseType: 'arraybuffer',
    timeout: 15000
  })

  return Buffer.from(res.data)
}

// ── TRANSCREVER ÁUDIO ─────────────────────────────────────
// audioData: string base64 | URL string | Buffer
// mimeType:  ex. 'audio/ogg; codecs=opus' (Evolution API padrão)
// Retorna: string com o texto transcrito, ou null em caso de erro
async function transcribeAudio(audioData, mimeType = 'audio/ogg') {
  try {
    if (!process.env.GROQ_API_KEY) {
      console.warn('[WHISPER] GROQ_API_KEY não configurada — transcrição ignorada')
      return null
    }

    // 1. Obter o Buffer do áudio
    let audioBuffer

    if (Buffer.isBuffer(audioData)) {
      audioBuffer = audioData
    } else if (typeof audioData === 'string' && (audioData.startsWith('http://') || audioData.startsWith('https://'))) {
      audioBuffer = await downloadAudio(audioData)
    } else if (typeof audioData === 'string' && audioData.length > 0) {
      // Assume base64
      audioBuffer = Buffer.from(audioData, 'base64')
    } else {
      throw new Error('audioData inválido: esperado Buffer, URL ou base64')
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Buffer de áudio vazio')
    }

    // 2. Montar multipart/form-data com o pacote form-data
    // MIME sem parâmetros extras (ex: 'audio/ogg; codecs=opus' → 'audio/ogg')
    const cleanMime = mimeType.split(';')[0].trim() || 'audio/ogg'

    const form = new FormData()
    form.append('file', audioBuffer, {
      filename:    'audio.ogg',
      contentType: cleanMime
    })
    form.append('model',           WHISPER_MODEL)
    form.append('language',        'pt')
    form.append('response_format', 'text')

    // 3. Chamar Groq Whisper — form.getHeaders() garante o boundary correto
    const response = await axios.post(WHISPER_URL, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },
      timeout: TIMEOUT_MS
    })

    const texto = (typeof response.data === 'string' ? response.data : JSON.stringify(response.data)).trim()

    if (!texto) throw new Error('Whisper retornou transcrição vazia')

    console.log(`[WHISPER] Transcrito (${audioBuffer.length} bytes): ${texto.substring(0, 80)}`)
    return texto

  } catch (err) {
    // Erro não quebra o fluxo — caller decide o fallback
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      console.error('[WHISPER] Timeout na transcrição')
    } else {
      const detail = err.response?.data ?? err.message
      console.error('[WHISPER] Erro na transcrição:', detail)
    }
    return null
  }
}

module.exports = { transcribeAudio }
