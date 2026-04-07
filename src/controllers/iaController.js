// src/controllers/iaController.js
// Proxy seguro para Groq API (gratuito, ultra-rápido)
// Modelo: llama-3.3-70b-versatile

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'llama-3.3-70b-versatile'

const GROQ_TIMEOUT_MS  = 25000   // 25s — aborta se Groq travar
const MAX_CONTEXT_CHARS = 3000   // evita contextos gigantes
const MAX_MESSAGES      = 20     // limita histórico do chat

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

// ── Extrai o primeiro bloco JSON válido de uma string ──────
function extrairJSON(raw) {
  const clean = raw.replace(/```json|```/g, '').trim()
  // Tenta parse direto
  try { return JSON.parse(clean) } catch (_) {}
  // Tenta encontrar JSON dentro do texto (ex: IA adicionou explicação)
  const match = clean.match(/\{[\s\S]*\}/)
  if (match) return JSON.parse(match[0])
  throw new Error('Nenhum JSON válido encontrado na resposta da IA')
}

// ── Wrapper com timeout para o Groq ───────────────────────
async function groqRequest(messages, maxTokens) {
  console.log('[DEBUG iaController] GROQ_API_KEY presente:', !!process.env.GROQ_API_KEY)
  console.log('[DEBUG iaController] GROQ_API_KEY valor:', process.env.GROQ_API_KEY?.slice(0, 10) + '...')
  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS)

  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY
      },
      body: JSON.stringify({ model: GROQ_MODEL, max_tokens: maxTokens, messages })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error?.message || 'Groq API error')
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('Groq retornou resposta vazia')
    return content
  } finally {
    clearTimeout(timeout)
  }
}

// ── Sanitiza e limita o contexto ──────────────────────────
function sanitizarContexto(context) {
  if (!context || typeof context !== 'string') return ''
  return context.slice(0, MAX_CONTEXT_CHARS)
}

// ── CHAT ────────────────────────────────────────────────
async function chat(req, res) {
  try {
    const { messages, context } = req.body
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ erro: 'messages obrigatório' })
    }

    // Limita histórico para evitar estouro de tokens no Groq
    const historico = messages.slice(-MAX_MESSAGES)

    const systemContent = context
      ? NEXOR_IA_SYSTEM + '\n\nContexto do negócio:\n' + sanitizarContexto(context)
      : NEXOR_IA_SYSTEM

    const groqMessages = [{ role: 'system', content: systemContent }, ...historico]
    const reply = await groqRequest(groqMessages, 1000)
    res.json({ reply })
  } catch (e) {
    console.error('IA chat error:', e.message)
    if (e.name === 'AbortError') {
      return res.status(503).json({ erro: 'A IA demorou muito para responder. Tente novamente.' })
    }
    res.status(500).json({ erro: 'Erro ao processar mensagem. Tente novamente.' })
  }
}

// ── COPILOTO ─────────────────────────────────────────────
async function copiloto(req, res) {
  try {
    const { context } = req.body
    const systemContent = context
      ? COPILOT_SYSTEM + '\n\nDados do negócio:\n' + sanitizarContexto(context)
      : COPILOT_SYSTEM

    const groqMessages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: 'Analise meu negócio e retorne apenas o JSON com as 3 ações.' }
    ]
    const raw    = await groqRequest(groqMessages, 800)
    const parsed = extrairJSON(raw)
    if (!parsed.acoes || !Array.isArray(parsed.acoes)) {
      throw new Error('Estrutura de resposta inválida')
    }
    res.json(parsed)
  } catch (e) {
    console.error('Copiloto error:', e.message)
    if (e.name === 'AbortError') {
      return res.status(503).json({ erro: 'A IA demorou muito para responder. Tente novamente.' })
    }
    res.status(500).json({ erro: 'Erro no copiloto. Tente novamente.' })
  }
}

// ── PREVISÃO ─────────────────────────────────────────────
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
      ? PREVISAO_SYSTEM + '\n\nDados atuais do negócio:\n' + sanitizarContexto(context)
      : PREVISAO_SYSTEM

    const groqMessages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: 'Gere a previsão financeira para o próximo mês. Retorne apenas o JSON.' }
    ]
    const raw    = await groqRequest(groqMessages, 400)
    const parsed = extrairJSON(raw)
    if (!parsed.previsao) throw new Error('Estrutura de previsão inválida')
    res.json(parsed)
  } catch (e) {
    console.error('Previsão IA error:', e.message)
    if (e.name === 'AbortError') {
      return res.status(503).json({ erro: 'A IA demorou muito. Tente novamente.' })
    }
    res.status(500).json({ erro: 'Erro ao gerar previsão. Tente novamente.' })
  }
}

// ── INSIGHT DIÁRIO ────────────────────────────────────────
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
      ? INSIGHT_SYSTEM + '\n\nDados:\n' + sanitizarContexto(context)
      : INSIGHT_SYSTEM

    const groqMessages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: 'Gere o insight do dia. Retorne apenas o JSON.' }
    ]
    const raw    = await groqRequest(groqMessages, 150)
    const parsed = extrairJSON(raw)
    if (!parsed.insight || typeof parsed.insight !== 'string') {
      throw new Error('Estrutura de insight inválida')
    }
    res.json(parsed)
  } catch (e) {
    console.error('Insight diário error:', e.message)
    if (e.name === 'AbortError') {
      return res.status(503).json({ erro: 'A IA demorou muito. Tente novamente.' })
    }
    res.status(500).json({ erro: 'Erro ao gerar insight.' })
  }
}

module.exports = { chat, copiloto, previsao, insightDiario }
