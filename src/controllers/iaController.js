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

// ──────────────────────────────────────────────────────────────
// /ia/previsao — Previsão financeira do próximo mês com insight
// ──────────────────────────────────────────────────────────────
const PREVISAO_SYSTEM = `Você é a Nexor IA, especialista em previsão financeira para micro-empreendedores brasileiros.
Com base nos dados fornecidos, faça uma previsão realista para o PRÓXIMO MÊS.
Retorne EXATAMENTE um JSON válido (sem markdown, sem texto externo):
{
  "previsao": {
    "receita":      12500,
    "receita_sub":  "Tendência de +18% com base nos últimos 3 meses",
    "lucro":        4200,
    "lucro_sub":    "Margem de 34% mantida",
    "insight":      "Frase curta com 1 ação concreta e impacto em R$ para maximizar o resultado"
  }
}
Seja realista. Use os dados reais do negócio. O insight deve ter no máximo 120 caracteres.`

async function previsao(req, res) {
  try {
    const { context } = req.body
    const systemContent = context
      ? PREVISAO_SYSTEM + '\n\nDados atuais do negócio:\n' + context
      : PREVISAO_SYSTEM

    const groqMessages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: 'Gere a previsão financeira para o próximo mês. Retorne apenas o JSON.' }
    ]
    const raw   = await groqRequest(groqMessages, 400)
    const clean = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    res.json(parsed)
  } catch (e) {
    console.error('Previsão IA error:', e)
    res.status(500).json({ erro: 'Erro ao gerar previsão. Tente novamente.' })
  }
}

// ──────────────────────────────────────────────────────────────
// /ia/insight-diario — Insight rápido do dia (para o dashboard)
// ──────────────────────────────────────────────────────────────
const INSIGHT_SYSTEM = `Você é a Nexor IA. Com base nos dados do negócio, gere UM insight financeiro prático para hoje.
Retorne APENAS um JSON:
{
  "insight": "Texto curto de 1 frase com emoji, máximo 90 caracteres, com dado real e ação concreta"
}
Exemplos de bom insight:
- "💡 Sua margem de 37% está 12pp acima da média — mantenha custos fixos sob controle!"
- "📈 Faturamento +18% — considere aumentar ticket médio em R$ 20 para mais R$ 800/mês"
- "⚠️ Despesas cresceram 8% — revise contratos de fornecedores esta semana"`

async function insightDiario(req, res) {
  try {
    const { context } = req.body
    const systemContent = context
      ? INSIGHT_SYSTEM + '\n\nDados:\n' + context
      : INSIGHT_SYSTEM

    const groqMessages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: 'Gere o insight do dia. Retorne apenas o JSON.' }
    ]
    const raw   = await groqRequest(groqMessages, 150)
    const clean = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    res.json(parsed)
  } catch (e) {
    console.error('Insight diário error:', e)
    res.status(500).json({ erro: 'Erro ao gerar insight.' })
  }
}

module.exports = { chat, copiloto, previsao, insightDiario }
