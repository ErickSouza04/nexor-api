// src/services/whisperTranscriber.js
// ─────────────────────────────────────────────────────────
// Transcreve áudios do WhatsApp via Groq Whisper API
// Reutiliza GROQ_API_KEY já configurada no projeto
//
// Suporta dois formatos da Evolution API:
//   · audioMessage.base64 — dado já em memória
//   · audioMessage.url    — faz download antes de transcrever
// ─────────────────────────────────────────────────────────

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))

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

  const res = await fetch(url, { headers, timeout: 15000 })
  if (!res.ok) throw new Error(`Download do áudio falhou: ${res.status}`)

  const arrayBuf = await res.arrayBuffer()
  return Buffer.from(arrayBuf)
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

    // 2. Montar multipart/form-data com FormData + Blob (Node 18+ globals)
    // MIME sem parâmetros extras (ex: 'audio/ogg; codecs=opus' → 'audio/ogg')
    const cleanMime = mimeType.split(';')[0].trim() || 'audio/ogg'
    const blob = new Blob([audioBuffer], { type: cleanMime })

    const formData = new FormData()
    formData.append('file',            blob, 'audio.ogg')
    formData.append('model',           WHISPER_MODEL)
    formData.append('language',        'pt')
    formData.append('response_format', 'text')

    // 3. Chamar Groq Whisper com timeout
    const controller = new AbortController()
    const timeout    = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let texto
    try {
      const response = await fetch(WHISPER_URL, {
        method:  'POST',
        signal:  controller.signal,
        headers: { 'Authorization': 'Bearer ' + process.env.GROQ_API_KEY },
        body:    formData,
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Whisper API ${response.status}: ${errText}`)
      }

      texto = (await response.text()).trim()
    } finally {
      clearTimeout(timeout)
    }

    if (!texto) throw new Error('Whisper retornou transcrição vazia')

    console.log(`[WHISPER] Transcrito (${audioBuffer.length} bytes): ${texto.substring(0, 80)}`)
    return texto

  } catch (err) {
    // Erro não quebra o fluxo — caller decide o fallback
    if (err.name === 'AbortError') {
      console.error('[WHISPER] Timeout na transcrição')
    } else {
      console.error('[WHISPER] Erro na transcrição:', err.message)
    }
    return null
  }
}

module.exports = { transcribeAudio }
