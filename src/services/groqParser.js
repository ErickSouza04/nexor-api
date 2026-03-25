// src/services/groqParser.js
// ─────────────────────────────────────────────────────────
// Extrai intenção e entidades de mensagens informais em PT-BR
// Usa o mesmo padrão do iaController.js (node-fetch, sem SDK)
// ─────────────────────────────────────────────────────────

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))

const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL   = 'llama-3.3-70b-versatile'
const TIMEOUT_MS   = 15000  // 15s — contexto WhatsApp é tempo-real

const INTENTS_VALIDOS = [
  'despesa', 'venda', 'estoque_entrada', 'estoque_saida',
  'consulta_estoque', 'consulta_lucro', 'desconhecido'
]

const PARSER_SYSTEM = `Você é um parser de mensagens financeiras para micro-empreendedores brasileiros.
Analise a mensagem e retorne EXATAMENTE este JSON (sem markdown, sem texto fora do JSON):
{
  "intent": "despesa|venda|estoque_entrada|estoque_saida|consulta_estoque|consulta_lucro|desconhecido",
  "valor": null,
  "quantidade": null,
  "produto": null,
  "categoria": null,
  "data": "hoje"
}

Regras de intent:
- "despesa": compra, gasto, paguei, comprei insumo/embalagem/fornecedor (sem menção a estoque)
- "venda": vendi, recebi, venda, faturei, cliente pagou
- "estoque_entrada": comprei para estoque, chegou mercadoria, entrada de produto, reposição
- "estoque_saida": saída do estoque, usei, consumiu, retirei do estoque
- "consulta_estoque": quanto tenho, estoque de, quantidade de, tenho ainda
- "consulta_lucro": lucro, resultado, quanto ganhei, faturamento, balanço
- "desconhecido": qualquer outra coisa

Regras de campos:
- valor: apenas número, sem R$ (ex: 25.90)
- quantidade: número (ex: 5)
- produto: nome do produto mencionado
- categoria: inferir quando possível (ex: Matéria-prima, Embalagem, Produto, Serviço)
- data: "hoje", "ontem", ou ISO YYYY-MM-DD se explícita na mensagem — padrão "hoje"`

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
    { role: 'user',   content: text }
  ]

  const raw    = await groqRequest(messages)
  const parsed = extrairJSON(raw)

  return {
    intent:     INTENTS_VALIDOS.includes(parsed.intent) ? parsed.intent : 'desconhecido',
    valor:      parsed.valor      != null ? parseFloat(parsed.valor)     : null,
    quantidade: parsed.quantidade != null ? parseFloat(parsed.quantidade): null,
    produto:    parsed.produto    || null,
    categoria:  parsed.categoria  || null,
    data:       parsed.data       || 'hoje',
  }
}

module.exports = { parseMessage }
