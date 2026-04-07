const axios = require('axios')
const FormData = require('form-data')

async function transcribeAudio(audioUrl, mimeType = 'audio/ogg') {
  console.log('[WHISPER] baixando áudio:', audioUrl)

  const audioResponse = await axios.get(audioUrl, {
    responseType: 'arraybuffer',
    timeout: 15000
  })
  const buffer = Buffer.from(audioResponse.data)
  console.log('[WHISPER] buffer baixado, tamanho:', buffer.length)

  const form = new FormData()
  form.append('file', buffer, {
    filename: 'audio.ogg',
    contentType: 'audio/ogg'
  })
  form.append('model', 'whisper-large-v3-turbo')
  form.append('language', 'pt')
  form.append('response_format', 'text')

  console.log('[WHISPER] enviando para Groq...')
  const result = await axios.post(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },
      timeout: 30000
    }
  )

  console.log('[WHISPER] transcrição:', result.data)
  return result.data
}

module.exports = { transcribeAudio }
