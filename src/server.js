// src/server.js
// ─────────────────────────────────────────────────────────
// Ponto de entrada da API Nexor
// Configura Express, segurança, rate limiting e rotas
// ─────────────────────────────────────────────────────────
require('dotenv').config()
const express     = require('express')
const helmet      = require('helmet')
const cors        = require('cors')
const rateLimit   = require('express-rate-limit')
const routes      = require('./routes')

const app  = express()
const PORT = process.env.PORT || 3000

// ── 1. SEGURANÇA — Headers HTTP ──────────────────────────
// Helmet define headers que protegem contra XSS,
// clickjacking, sniffing e outros ataques comuns
app.use(helmet())

// ── 2. CORS — Aceita frontend Cloudflare Pages + local dev ──
const ALLOWED_ORIGINS = [
  // Produção — Cloudflare Pages (qualquer subdomínio nexor)
  /^https:\/\/.*\.pages\.dev$/,
  /^https:\/\/nexor.*\.pages\.dev$/,
  // Permite domínio custom se configurado
  process.env.CORS_ORIGIN,
  // Local dev
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:3000',
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    // Permite requests sem origin (Postman, mobile, etc)
    if (!origin) return callback(null, true)
    // Verifica se origin é string que bate ou regex que bate
    const allowed = ALLOWED_ORIGINS.some(o =>
      o instanceof RegExp ? o.test(origin) : o === origin
    )
    if (allowed) return callback(null, true)
    console.warn('CORS bloqueado:', origin)
    return callback(null, true) // temporariamente permite tudo para debug
  },
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}))

// ── 3. RATE LIMITING — Anti força bruta ─────────────────
// Rotas de auth têm limite mais restrito
const limiteGeral = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max:      parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message:  { sucesso: false, erro: 'Muitas requisições. Tente novamente em alguns minutos.' },
  standardHeaders: true,
  legacyHeaders:   false
})

const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutos
  max: 10,                    // apenas 10 tentativas de login por IP
  message: { sucesso: false, erro: 'Muitas tentativas de login. Aguarde 15 minutos.' }
})

app.use('/api', limiteGeral)
app.use('/api/auth/login',    limiteAuth)
app.use('/api/auth/cadastro', limiteAuth)

// ── 4. PARSE DO BODY ─────────────────────────────────────
app.use(express.json({ limit: '10kb' }))   // limita o tamanho do payload
app.use(express.urlencoded({ extended: false, limit: '10kb' }))

// ── 5. ROTAS ─────────────────────────────────────────────
app.use('/api', routes)

// Health check público
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Rota raiz para Railway
app.get('/', (req, res) => {
  res.status(200).send('Nexor API online 🚀')
})

// ── 6. ROTA NÃO ENCONTRADA ───────────────────────────────
app.use((req, res) => {
  res.status(404).json({ sucesso: false, erro: 'Rota não encontrada' })
})

// ── 7. HANDLER GLOBAL DE ERROS ───────────────────────────
// Captura qualquer erro não tratado antes de chegar ao usuário
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err)

  // Não expõe detalhes do erro em produção
  const mensagem = process.env.NODE_ENV === 'production'
    ? 'Erro interno do servidor'
    : err.message

  res.status(err.status || 500).json({ sucesso: false, erro: mensagem })
})

// ── START ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   🚀 Nexor API rodando na porta ${PORT}  ║
  ║   Ambiente: ${(process.env.NODE_ENV || 'development').padEnd(25)}║
  ╚══════════════════════════════════════╝
  `)
})

module.exports = app
