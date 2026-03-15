// src/config/database.js
require('dotenv').config()
const { Pool } = require('pg')

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        host:     process.env.DB_HOST,
        port:     parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME,
        user:     process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      }
)

// Testa a conexão ao iniciar
pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('✅ Conectado ao PostgreSQL')
  }
})

pool.on('error', (err) => {
  console.error('❌ Erro inesperado no pool do banco:', err)
  process.exit(-1)
})

// ─────────────────────────────────────────────────────────
// query() — wrapper principal para queries seguras
// SEMPRE usa queries parametrizadas ($1, $2...)
// NUNCA concatena strings — previne SQL Injection
// ─────────────────────────────────────────────────────────
const query = async (text, params) => {
  const start = Date.now()
  try {
    const result = await pool.query(text, params)
    const duration = Date.now() - start
    if (process.env.NODE_ENV === 'development') {
      console.log(`🗄️  Query (${duration}ms):`, text.substring(0, 80))
    }
    return result
  } catch (err) {
    console.error('❌ Erro na query:', err.message)
    throw err
  }
}

// ─────────────────────────────────────────────────────────
// queryWithUser() — ativa o RLS para o usuário atual
// Define app.current_user_id na sessão do banco
// O RLS usa esse valor para filtrar os dados automaticamente
// ─────────────────────────────────────────────────────────
const queryWithUser = async (userId, text, params) => {
  const client = await pool.connect()
  try {
    // Define o user_id na sessão — ativa as políticas RLS
    await client.query(
      `SET LOCAL app.current_user_id = '${userId}'`
    )
    const result = await client.query(text, params)
    return result
  } finally {
    client.release()  // SEMPRE devolve a conexão ao pool
  }
}

// Para transações (múltiplas operações atômicas)
const transaction = async (userId, callback) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL app.current_user_id = '${userId}'`)
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = { query, queryWithUser, transaction, pool }
