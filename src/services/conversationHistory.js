// src/services/conversationHistory.js
// ─────────────────────────────────────────────────────────
// Gerencia o histórico de conversas WhatsApp por usuário.
//
// - Persiste mensagens na tabela whatsapp_conversation_history
// - Retorna as últimas MAX_MESSAGES mensagens em ordem cronológica
// - Limpa automaticamente mensagens com mais de INACTIVITY_HOURS horas
// ─────────────────────────────────────────────────────────

const { query } = require('../config/database')

const MAX_MESSAGES      = 10
const INACTIVITY_HOURS  = 2

/**
 * Remove mensagens antigas (> INACTIVITY_HOURS) para o par userId+phone.
 * Chamado automaticamente antes de buscar o histórico.
 */
async function cleanOldHistory(userId, phone) {
  await query(
    `DELETE FROM whatsapp_conversation_history
     WHERE user_id = $1
       AND phone = $2
       AND created_at < NOW() - INTERVAL '2 hours'`,
    [userId, phone]
  )
}

/**
 * Retorna as últimas MAX_MESSAGES mensagens em ordem cronológica.
 * Limpa o histórico expirado antes de buscar.
 *
 * @returns {Array<{role: string, content: string}>}
 */
async function getHistory(userId, phone) {
  await cleanOldHistory(userId, phone)

  const result = await query(
    `SELECT role, content
     FROM whatsapp_conversation_history
     WHERE user_id = $1 AND phone = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [userId, phone, MAX_MESSAGES]
  )

  // Inverte para ordem cronológica (mais antigas primeiro)
  return result.rows.reverse()
}

/**
 * Salva uma mensagem no histórico.
 *
 * @param {string} userId
 * @param {string} phone
 * @param {'user'|'assistant'} role
 * @param {string} content
 */
async function saveMessage(userId, phone, role, content) {
  await query(
    `INSERT INTO whatsapp_conversation_history (user_id, phone, role, content)
     VALUES ($1, $2, $3, $4)`,
    [userId, phone, role, content]
  )
}

module.exports = { getHistory, saveMessage, cleanOldHistory }
