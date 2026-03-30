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
const { pool }    = require('./config/database')

// ── Auto-migração: garante colunas essenciais no banco ───
async function runMigrations() {
  const client = await pool.connect()
  try {
    // Colunas de trial e Stripe (migration_trial)
    await client.query(`
      ALTER TABLE usuarios
        ADD COLUMN IF NOT EXISTS trial_inicio          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS trial_dias            INTEGER DEFAULT 7,
        ADD COLUMN IF NOT EXISTS plano_expira          TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT
    `)
    // Coluna tipo_plano (migration_tipo_plano)
    await client.query(`
      ALTER TABLE usuarios
        ADD COLUMN IF NOT EXISTS tipo_plano VARCHAR(20) DEFAULT 'trial'
    `)
    // Coluna ativo (migration_ativo)
    await client.query(`
      ALTER TABLE usuarios
        ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE
    `)
    await client.query(`UPDATE usuarios SET ativo = TRUE WHERE ativo IS NULL`)
    console.log('✅ Migrações aplicadas com sucesso.')
  } catch (err) {
    console.error('⚠️  Erro nas migrações (não crítico):', err.message)
  } finally {
    client.release()
  }
}

// ── Validação de variáveis de ambiente obrigatórias ──────
const REQUIRED_ENV = ['JWT_SECRET', 'DATABASE_URL']
const missingEnvs = REQUIRED_ENV.filter(key => !process.env[key])
if (missingEnvs.length > 0) {
  console.error(`❌ Variáveis de ambiente obrigatórias não definidas: ${missingEnvs.join(', ')}`)
  process.exit(1)
}

const app  = express()
const PORT = process.env.PORT || 3000

// Railway (e qualquer reverse proxy) adiciona X-Forwarded-For.
// Sem isso o express-rate-limit lança ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// e não consegue identificar o IP real do cliente.
app.set('trust proxy', 1)

// ── HEALTH CHECK — antes de tudo (Railway precisa disso) ──
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.status(200).json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() })
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable', timestamp: new Date().toISOString() })
  }
})

// ── 1. SEGURANÇA — Headers HTTP ──────────────────────────
app.use(helmet())

// ── 2. CORS — Apenas origens permitidas ─────────────────
// Domínios fixos sempre permitidos (produção + dev local)
const ORIGENS_FIXAS = [
  'https://usenexor.site',
  'https://www.usenexor.site',
  'http://localhost:3000',
  'http://localhost:5173',
]
// ALLOWED_ORIGINS na env permite adicionar origens extras sem alterar código
const origensExtras = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : []
const origensPermitidas = [...new Set([...ORIGENS_FIXAS, ...origensExtras])]

app.use(cors({
  origin: (origin, callback) => {
    // Permite requisições sem origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true)
    if (origensPermitidas.includes(origin)) return callback(null, true)
    callback(new Error(`CORS bloqueado para origem: ${origin}`))
  },
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials:    true
}))

// ── 3. RATE LIMITING — Anti força bruta ─────────────────
const limiteGeral = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message:  { sucesso: false, erro: 'Muitas requisições. Tente novamente em alguns minutos.' },
  standardHeaders: true,
  legacyHeaders:   false
})

const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { sucesso: false, erro: 'Muitas tentativas de login. Aguarde 15 minutos.' }
})

// IA tem limite menor — protege cota do Groq
const limiteIA = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { sucesso: false, erro: 'Limite de uso da IA atingido. Aguarde alguns minutos.' }
})

// Admin com limite muito restrito — protege a chave secreta
const limiteAdmin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { erro: 'Muitas tentativas. Aguarde.' }
})

app.use('/api',              limiteGeral)
app.use('/api/auth/login',   limiteAuth)
app.use('/api/auth/cadastro',limiteAuth)
app.use('/api/ia',           limiteIA)
app.use('/api/admin',        limiteAdmin)

// ── 4. PARSE DO BODY ─────────────────────────────────────
// IMPORTANTE: webhooks do Stripe precisam do body cru (Buffer) para validar assinatura.
// Estes middlewares DEVEM ficar antes do express.json(). express.raw() define req._body=true
// e express.json() verifica esse flag antes de parsear — garantindo que o body não seja
// re-processado.
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }))  // webhook legado
app.use('/api/stripe/webhook',  express.raw({ type: 'application/json' }))  // novo webhook (planos base/plus)
app.use(express.json({ limit: '10kb' }))
app.use(express.urlencoded({ extended: false, limit: '10kb' }))

// ── 5. ROTAS ─────────────────────────────────────────────
app.use('/api', routes)

// ── 6. ROTA NÃO ENCONTRADA ───────────────────────────────
app.use((req, res) => {
  res.status(404).json({ sucesso: false, erro: 'Rota não encontrada' })
})

// ── 7. HANDLER GLOBAL DE ERROS ───────────────────────────
app.use((err, req, res, next) => {
  // Erro de CORS — não expõe detalhes ao cliente
  if (err.message?.startsWith('CORS bloqueado')) {
    return res.status(403).json({ sucesso: false, erro: 'Origem não autorizada' })
  }

  console.error('Erro não tratado:', err)

  const mensagem = process.env.NODE_ENV === 'production'
    ? 'Erro interno do servidor'
    : err.message

  res.status(err.status || 500).json({ sucesso: false, erro: mensagem })
})

// ── START ─────────────────────────────────────────────────
const server = app.listen(PORT, async () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   🚀 Nexor API rodando na porta ${PORT}  ║
  ║   Ambiente: ${(process.env.NODE_ENV || 'development').padEnd(25)}║
  ╚══════════════════════════════════════╝
  `)
  await runMigrations()
})

// ── GRACEFUL SHUTDOWN ─────────────────────────────────────
const shutdown = async (signal) => {
  console.log(`\n[${signal}] Encerrando servidor graciosamente...`)
  server.close(async () => {
    try {
      await pool.end()
      console.log('✅ Conexões do banco encerradas. Servidor finalizado.')
    } catch (err) {
      console.error('Erro ao encerrar pool:', err.message)
    }
    process.exit(0)
  })

  // Força encerramento após 10s se não concluir
  setTimeout(() => {
    console.error('⚠️  Shutdown forçado após timeout.')
    process.exit(1)
  }, 10_000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

module.exports = app
