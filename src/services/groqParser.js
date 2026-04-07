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

// ── Constrói exemplos few-shot dinâmicos com dados reais ─
function buildFewShotExamples(userContext) {
  const nome           = userContext?.nome         || 'você'
  const lucro          = userContext?.lucro        ?? 0
  const lucroProjetado = userContext?.lucroProjetado ?? 0
  const metaValor      = userContext?.metaValor
  const margem         = userContext?.margem       ?? '0.0'
  const diaAtual       = userContext?.diaAtual     ?? 0
  const weakDayInsight = userContext?.weakDayInsight

  const lucroStr    = fmtBR(lucro)
  const projecaoStr = fmtBR(lucroProjetado)
  const margemStr   = margem + '%'

  // Exemplo 1: pergunta vaga sobre desempenho
  let ex1 = `Sim, ${nome}! 🔥 Você está com ${lucroStr} de lucro`
  if (diaAtual > 0) ex1 += ` em ${diaAtual} dias`
  ex1 += `, sua projeção é ${projecaoStr} esse mês`
  if (metaValor && lucroProjetado >= metaValor) {
    ex1 += ` — já passou da sua meta de ${fmtBR(metaValor)}! Continue assim 💪`
  } else if (metaValor) {
    ex1 += ` — sua meta é ${fmtBR(metaValor)}, continue assim 💪`
  } else {
    ex1 += `! Continue assim 💪`
  }

  // Exemplo 2: pedido de melhoria / análise crítica
  let ex2
  if (weakDayInsight) {
    ex2 = `Entendi, ${nome}! Sua margem está em ${margemStr}, o que é ótimo. O ponto de atenção é o padrão de queda detectado nas suas vendas. Que tal uma promoção no dia mais fraco? 🎯`
  } else {
    ex2 = `Entendi, ${nome}! Sua margem está em ${margemStr}, o que é ótimo. Me conta: quer focar em aumentar vendas, reduzir despesas ou melhorar o estoque? 🎯`
  }

  return `
---

📚 Exemplos de respostas ideais (tom e formato de referência):

Usuário: "tô indo bem?"
Agente: "${ex1}"

Usuário: "preciso melhorar"
Agente: "${ex2}"

Usuário: "gastei 200 reais com embalagem"
Agente (sistema retorna automaticamente):
"✅ Despesa registrada!
💸 embalagem: R$ 200,00

📊 Lucro do dia:
Receita: R$ X.XXX,XX
Despesas: R$ X.XXX,XX
Lucro: R$ X.XXX,XX (margem X%)

[frase motivacional]"

Usuário: "vendi 5 produtos por 150 cada"
Agente (sistema retorna automaticamente):
"✅ Venda registrada!
💰 produto: R$ 750,00

📊 Lucro do dia:
Receita: R$ X.XXX,XX
Despesas: R$ X.XXX,XX
Lucro: R$ X.XXX,XX (margem X%)

[frase motivacional]"

---
`
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
    weakDayInsight,
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

  // ── Melhoria 3: insight de padrão semanal (se detectado) ─
  if (weakDayInsight) {
    perfil += `\n\n💡 Insight de padrão de vendas: ${weakDayInsight}`
  }

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

  const fewShot = buildFewShotExamples(userContext)

  const responseRules = `
---

REGRAS DE RESPOSTA — OBRIGATÓRIAS:
- Máximo 3 linhas por resposta conversacional
- NUNCA use frases como "lembre-se que", "é importante", "com base nos dados que temos", "isso é apenas uma estimativa"
- NUNCA pergunte se o usuário quer registrar mais dados no final da resposta
- NUNCA adicione disclaimers, sugestões extras ou perguntas no final
- Vá direto ao ponto com os números reais
- Tom curto, motivador e amigável
- Use emojis com moderação (máximo 2 por resposta)
- Para venda, despesa e consulta financeira, o sistema já gera o formato estruturado — não repita esses dados

Ex: "Sim, Erick! 🔥 R$40k de lucro em 7 dias, projeção de R$169k esse mês. Já passou da sua meta! Continue assim 💪"

---
`

  return intro + '\n\n' + perfil + '\n' + financeiro + '\n' + responseRules + fewShot + PARSER_COMMANDS
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
