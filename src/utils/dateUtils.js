// src/utils/dateUtils.js
// ─────────────────────────────────────────────────────────
// Utilitários de data com fuso horário de Brasília (UTC-3)
// Garante consistência entre salvamento e leitura de datas
// em servidores UTC (Railway, etc.)
// ─────────────────────────────────────────────────────────

const TZ_BRASIL = 'America/Sao_Paulo'

/**
 * Retorna a data atual no fuso de Brasília no formato 'YYYY-MM-DD'.
 * Aceita um objeto Date opcional para testes ou datas específicas.
 *
 * Exemplo: às 22h13 de Brasília (01h13 UTC do dia seguinte),
 * retorna '2026-04-12' — e não '2026-04-13' como toISOString() faria.
 *
 * @param {Date} [date=new Date()]
 * @returns {string} 'YYYY-MM-DD'
 */
function getDataBrasil(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ_BRASIL
  }).format(date) // 'sv-SE' produz exatamente 'YYYY-MM-DD'
}

/**
 * Retorna a data de ontem no fuso de Brasília no formato 'YYYY-MM-DD'.
 * @returns {string} 'YYYY-MM-DD'
 */
function getDataOntemBrasil() {
  const ontem = new Date()
  ontem.setDate(ontem.getDate() - 1)
  return getDataBrasil(ontem)
}

module.exports = { getDataBrasil, getDataOntemBrasil }
