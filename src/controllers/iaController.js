// src/controllers/iaController.js
// Proxy seguro para Groq API (gratuito, ultra-rápido)
// Modelo: llama-3.3-70b-versatile

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'llama-3.3-70b-versatile'

const NEXOR_IA_SYSTEM = `Você é a Nexor IA, assistente financeira inteligente especializada em micro-empreendedores brasileiros.
Responda SEMPRE em português brasileiro. Seja direta, prática e motivadora.
Use dados reais do negócio nas respostas quando fornecidos.
Dê insights acionáveis. Seja concisa (máximo 3-4 parágrafos curtos).
Use emojis estrategicamente para facilitar leitura.`

const COPILOT_SYSTEM = `Você é o Copiloto de Lucro da Nexor IA — hiperfocado em aumentar o lucro de micro-empreendedores brasileiros.
Retorne EXATAMENTE um JSON válido (sem markdown, sem texto fora do JSON):
{
  "acoes": [
    {
      "titulo": "Título curto e direto",
      "descricao": "O que fazer em 1-2 frases práticas com números reais.",
      "impacto": "alto",
      "ganho": "+R$ 480/mês"
    }
  ]
}
Máximo 3 ações. Cada uma ESPECÍFICA e ACIONÁVEL. Impacto "alto" = +R$300/mês ou mais.`

async function groqRequest(messages, maxTokens) {
  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.GROQ_API_KEY
    },
    body: JSON.stringify({ model: GROQ_MODEL, max_tokens: maxTokens, messages })
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || 'Groq API error')
  return data.choices?.[0]?.message?.content || ''
}

async function chat(req, res) {
  try {
    const { messages, context } = req.body
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ erro: 'messages obrigatório' })
    }
    const systemContent = context
      ? NEXOR_IA_SYSTEM + '\n\nContexto do negócio:\n' + context
      : NEXOR_IA_SYSTEM

    const groqMessages = [{ role: 'system', content: systemContent }, ...messages]
    const reply = await groqRequest(groqMessages, 1000)
    res.json({ reply })
  } catch (e) {
    console.error('IA chat error:', e)
    res.status(500).json({ erro: 'Erro ao processar mensagem. Tente novamente.' })
  }
}

async function copiloto(req, res) {
  try {
    const { context } = req.body
    const systemContent = context
      ? COPILOT_SYSTEM + '\n\nDados do negócio:\n' + context
      : COPILOT_SYSTEM

    const groqMessages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: 'Analise meu negócio e retorne apenas o JSON com as 3 ações.' }
    ]
    const raw = await groqRequest(groqMessages, 800)
    const clean = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    res.json(parsed)
  } catch (e) {
    console.error('Copiloto error:', e)
    res.status(500).json({ erro: 'Erro no copiloto. Tente novamente.' })
  }
}

module.exports = { chat, copiloto }
