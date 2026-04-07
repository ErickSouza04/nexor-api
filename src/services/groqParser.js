// src/services/groqParser.js
// ─────────────────────────────────────────────────────────
// Extrai intenção e entidades de mensagens informais em PT-BR
// Usa o mesmo padrão do iaController.js (node-fetch, sem SDK)
// ─────────────────────────────────────────────────────────

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))

const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL   = 'llama-3.3-70b-versatile'
const TIMEOUT_MS   = 15000  // 15s — contexto WhatsApp é tempo-real

// ── Parte fixa: instruções de parsing de comandos ────────
const PARSER_COMMANDS = `
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

Entrada de estoque:
{
  "tipo": "estoque_entrada",
  "produto": "nome",
  "quantidade": número,
  "valor": número
}

Saída de estoque:
{
  "tipo": "estoque_saida",
  "produto": "nome",
  "quantidade": número
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

Exemplos:

"Comprei 5kg de farinha por 25 reais"
-> estoque_entrada

"Usei 2kg de farinha"
-> estoque_saida

"Vendi 2 produtos por 50"
-> venda

---

Regras:
- Corrigir erros de áudio automaticamente
- Converter palavras em número (cem → 100)
- Ignorar palavras como "tipo", "mano", "acho que"
- Nunca retornar texto fora do JSON se for comando
- Se não for comando, responder normalmente em português brasileiro
- Sempre use o nome da pessoa nas respostas conversacionais
- Seja amigável, motivador e personalizado
`

// ── Fallback sem contexto de usuário ────────────────────
const PARSER_SYSTEM_DEFAULT = `Você é um assistente inteligente de gestão financeira e estoque via WhatsApp.

As mensagens podem vir de TEXTO ou TRANSCRIÇÃO DE ÁUDIO.
A transcrição pode conter erros, palavras incompletas ou frases informais.

Sua função é interpretar corretamente a intenção do usuário.
` + PARSER_COMMANDS

// ── Formata valor monetário em PT-BR ────────────────────
function fmtBR(valor) {
  return 'R$ ' + parseFloat(valor || 0).toFixed(2).replace('.', ',')
}

// ── Constrói system prompt personalizado com contexto do usuário ──
function buildSystemPrompt(userContext) {
  if (!userContext) return PARSER_SYSTEM_DEFAULT

  const {
    nome,
    proLabore,
    metaValor,
    receita,
    despesas,
    lucro,
    margem,
    diaAtual,
    diasNoMes,
    lucroProjetado,
    nomeMes,
    anoAtual,
  } = userContext

  // ── Seção de perfil do usuário ──────────────────────
  let perfil = `Você é o assistente financeiro do Nexor. Você está conversando com ${nome}.`

  if (metaValor && metaValor > 0) {
    perfil += `\nMeta mensal de lucro: ${fmtBR(metaValor)}.`
  } else {
    perfil += `\nEsta pessoa ainda não tem uma meta mensal cadastrada. Se a conversa permitir de forma natural, sugira que ela cadastre no app Nexor.`
  }

  if (proLabore && proLabore > 0) {
    perfil += `\nPró-labore mensal: ${fmtBR(proLabore)}.`
  }

  perfil += `\nSempre use o nome da pessoa nas respostas. Faça análises personalizadas com base na meta e no contexto financeiro dela. Seja amigável, motivador e fale em português brasileiro.`

  // ── Seção de situação financeira do mês ─────────────
  const margemStr   = receita > 0 ? ((lucro / receita) * 100).toFixed(1) + '%' : '0%'
  const projecaoStr = fmtBR(lucroProjetado)

  const financeiro = `
Situação financeira atual (${nomeMes}/${anoAtual}):
Receita: ${fmtBR(receita)} | Despesas: ${fmtBR(despesas)} | Lucro: ${fmtBR(lucro)} (margem ${margemStr})
Dias passados no mês: ${diaAtual} de ${diasNoMes} | Projeção atual: ${projecaoStr}

Quando o usuário perguntar algo como "tô indo bem?" ou fazer perguntas vagas sobre desempenho,
use esses dados para dar uma análise real e personalizada.`

  // ── Instrução base de parsing ────────────────────────
  const intro = `Você é um assistente inteligente de gestão financeira e estoque via WhatsApp.

As mensagens podem vir de TEXTO ou TRANSCRIÇÃO DE ÁUDIO.
A transcrição pode conter erros, palavras incompletas ou frases informais.

Sua função é interpretar corretamente a intenção do usuário.`

  return intro + '\n\n' + perfil + '\n' + financeiro + '\n' + PARSER_COMMANDS
}

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
      body: JSON.stringify({ model: GROQ_MODEL, max_tokens: 800, messages })
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
// text       : string com a mensagem do usuário
// history    : Array<{role, content}> — histórico recente da conversa (opcional)
// userContext: objeto com perfil e dados financeiros do usuário (opcional)
//
// Retorna:
// - JSON com { tipo: ... } quando for comando
// - ou { tipo: 'conversa', resposta: string }
async function parseMessage(text, history = [], userContext = null) {
  const systemPrompt = buildSystemPrompt(userContext)

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(h => ({ role: h.role, content: String(h.content) })),
    { role: 'user', content: String(text) }
  ]

  const raw = await groqRequest(messages)

  console.log('[GROQ PARSER] RAW:', raw)

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

  return {
    tipo: parsed.tipo || 'desconhecido',
    ...parsed
  }
}

module.exports = { parseMessage }
