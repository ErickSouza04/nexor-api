// src/config/migrate.js
// ─────────────────────────────────────────────────────────
// Executa o schema.sql para criar as tabelas e políticas RLS
// Rodar UMA VEZ: node src/config/migrate.js
// ─────────────:───────────────────────────────────────────
require('dotenv').config()
const fs   = require('fs')
const path = require('path')
const { Pool } = require('pg')

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false
})

async function migrate() {
  console.log('🗄️  Iniciando migração do banco de dados...\n')
  try {
    const schemaPath = path.join(__dirname, '../../sql/schema.sql')
    const sql = fs.readFileSync(schemaPath, 'utf-8')

    await pool.query(sql)

    console.log('✅ Tabelas criadas com sucesso!')
    console.log('✅ Row-Level Security (RLS) ativado!')
    console.log('✅ Índices criados!')
    console.log('\n🎉 Banco de dados pronto para uso.\n')
  } catch (err) {
    console.error('❌ Erro na migração:', err.message)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

migrate()
