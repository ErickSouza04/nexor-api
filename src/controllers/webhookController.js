// src/controllers/webhookController.js
// Webhook Stripe — ativa/cancela planos automaticamente
const { query } = require('../config/database')

// Stripe SDK (lazy import para não quebrar se não instalado ainda)
const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY não configurado')
  return require('stripe')(process.env.STRIPE_SECRET_KEY)
}

// ── WEBHOOK STRIPE ───────────────────────────────────────
const stripe = async (req, res) => {
  let event

  try {
    const stripe = getStripe()
    const sig = req.headers['stripe-signature']
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

    // Valida assinatura do webhook (garante que veio do Stripe)
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
    } else {
      event = req.body
      console.warn('[STRIPE] STRIPE_WEBHOOK_SECRET não configurado — pulando validação')
    }
  } catch (err) {
    console.error('[STRIPE] Assinatura inválida:', err.message)
    return res.status(400).json({ erro: `Webhook inválido: ${err.message}` })
  }

  console.log(`[STRIPE] Evento: ${event.type}`)

  try {
    switch (event.type) {

      // ── Assinatura criada / pagamento aprovado ──────────
      case 'checkout.session.completed': {
        const session = event.data.object
        const email = session.customer_details?.email?.toLowerCase().trim()
        const subscriptionId = session.subscription
        const planoStripe = session.metadata?.plano || 'mensal'

        if (email) {
          await ativarPlano(email, subscriptionId, planoStripe)
        }
        break
      }

      // ── Renovação de assinatura paga ────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object
        const email = invoice.customer_email?.toLowerCase().trim()
        const subscriptionId = invoice.subscription

        if (email && invoice.billing_reason === 'subscription_cycle') {
          await ativarPlano(email, subscriptionId)
          console.log(`[STRIPE] ✅ Renovação confirmada: ${email}`)
        }
        break
      }

      // ── Pagamento falhou (cartão recusado etc) ──────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object
        const email = invoice.customer_email?.toLowerCase().trim()
        if (email) {
          // Não cancela imediatamente — Stripe tenta de novo por alguns dias
          // Apenas loga
          console.log(`[STRIPE] ⚠️ Pagamento falhou para: ${email}`)
        }
        break
      }

      // ── Assinatura cancelada ────────────────────────────
      case 'customer.subscription.deleted': {
        const subscription = event.data.object
        const customerId = subscription.customer
        const stripe = getStripe()
        const customer = await stripe.customers.retrieve(customerId)
        const email = customer.email?.toLowerCase().trim()

        if (email) {
          await cancelarPlano(email)
          console.log(`[STRIPE] ❌ Assinatura cancelada: ${email}`)
        }
        break
      }

      // ── Assinatura pausada / em atraso ──────────────────
      case 'customer.subscription.updated': {
        const subscription = event.data.object
        if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
          const customerId = subscription.customer
          const stripe = getStripe()
          const customer = await stripe.customers.retrieve(customerId)
          const email = customer.email?.toLowerCase().trim()
          if (email) {
            await cancelarPlano(email)
            console.log(`[STRIPE] ⚠️ Acesso suspenso por inadimplência: ${email}`)
          }
        }
        break
      }

      default:
        console.log(`[STRIPE] Evento ignorado: ${event.type}`)
    }

    res.json({ recebido: true })

  } catch (err) {
    console.error('[STRIPE] Erro ao processar evento:', err)
    res.status(500).json({ erro: 'Erro interno ao processar webhook' })
  }
}

// ── Helpers ──────────────────────────────────────────────
async function ativarPlano(email, subscriptionId, planoTipo) {
  const resultado = await query(
    `UPDATE usuarios 
     SET plano = 'ativo', 
         stripe_subscription_id = $2,
         plano_expira = NULL,
         atualizado_em = NOW()
     WHERE email = $1
     RETURNING id, nome, email`,
    [email, subscriptionId || null]
  )

  if (resultado.rows.length) {
    console.log(`[STRIPE] ✅ Plano ATIVADO: ${email} (${planoTipo || 'assinatura'})`)
  } else {
    // Usuário comprou mas ainda não se cadastrou — salva para processar depois
    console.log(`[STRIPE] ⚠️ Usuário não encontrado no banco: ${email}`)
    await query(
      `INSERT INTO webhook_stripe (evento, email, subscription_id, processado)
       VALUES ('pending_activation', $1, $2, FALSE)
       ON CONFLICT DO NOTHING`,
      [email, subscriptionId || null]
    )
  }
}

async function cancelarPlano(email) {
  await query(
    `UPDATE usuarios 
     SET plano = 'cancelado', atualizado_em = NOW()
     WHERE email = $1`,
    [email]
  )
}

// ── Ativar manualmente (admin / backup) ──────────────────
const ativarManual = async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key']
    if (adminKey !== process.env.ADMIN_SECRET_KEY) {
      return res.status(401).json({ erro: 'Não autorizado' })
    }

    const { email, plano } = req.body
    if (!email || !['ativo', 'trial', 'expirado', 'cancelado'].includes(plano)) {
      return res.status(400).json({ erro: 'Email e plano válido são obrigatórios' })
    }

    const resultado = await query(
      `UPDATE usuarios SET plano = $1, atualizado_em = NOW()
       WHERE email = $2
       RETURNING id, nome, email, plano`,
      [plano, email.toLowerCase().trim()]
    )

    if (!resultado.rows.length) return res.status(404).json({ erro: 'Usuário não encontrado' })

    console.log(`[ADMIN] Plano de ${email} → '${plano}'`)
    res.json({ sucesso: true, usuario: resultado.rows[0] })
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' })
  }
}

module.exports = { stripe, ativarManual }
