// src/services/groqParser.js
// ─────────────────────────────────────────────────────────
// Extrai intenção e entidades de mensagens informais em PT-BR
// Usa o mesmo padrão do iaController.js (node-fetch, sem SDK)
// ─────────────────────────────────────────────────────────

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))

const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL   = 'llama-3.3-70b-versatile'
const TIMEOUT_MS   = 15000  // 15s — contexto WhatsApp é tempo-real


const PARSER_SYSTEM = `
Você é um assistente inteligente de gestão financeira e estoque via WhatsApp.

As mensagens podem vir de TEXTO ou TRANSCRIÇÃO DE ÁUDIO.
A transcrição pode conter erros, palavras incompletas ou frases informais.

Sua função é interpretar corretamente a intenção do usuário.

---

Se for comando, responda SOMENTE em JSON:

Venda:
{
  "tipo": "venda",
  "descricao": "produto",
  "quantidade": número,
  "valor": número
}

Despesa:
{
  "tipo": "despesa",
  "descricao": "motivo",
  "valor": número
}

Consulta estoque:
{
  "tipo": "consulta_estoque",
  "produto": "nome"
}

Consulta financeira:
{
  "tipo": "consulta_financeira",
  "metrica": "faturamento" | "lucro" | "despesas",
  "periodo": "hoje" | "ontem" | "semana" | "mes"
}

---

Regras:
- Corrigir erros de áudio automaticamente
- Converter palavras em número (cem → 100)
- Ignorar palavras como "tipo", "mano", "acho que"
- Nunca retornar texto fora do JSON se for comando
- Se não for comando, responder normalmente
`
// ── Extrai o primeiro JSON válido de uma string ──────────
function extrairJSON(raw) {
  const clean = raw.replace(/```json|```/g, '').trim()
  try { return JSON.parse(clean) } catch (_) {}
  const match = clean.match(/\{[\s\S]*\}/)
  if (match) return JSON.parse(match[0])
  throw new Error('Nenhum JSON válido encontrado na resposta do parser')
}

// ── Wrapper com timeout ──────────────────────────────────
async function groqRequest(messages) {
  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY
      },
      body: JSON.stringify({ model: GROQ_MODEL, max_tokens: 200, messages })
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

// ── PARSE ─────────────────────────────────────────────────
// text: string com a mensagem do usuário
// Retorna: { intent, valor, quantidade, produto, categoria, data }
async function parseMessage(text) {
  const messages = [
    { role: 'system', content: PARSER_SYSTEM },
    { role: 'user', content: text }
  ]

  const raw = await groqRequest(messages)

  let parsed = null

  try {
    parsed = extrairJSON(raw)
  } catch (err) {
    // Não é JSON → resposta normal da IA
    return {
      tipo: 'conversa',
      resposta: raw
    }
  }

  return parsed
}

module.exports = { parseMessage }
