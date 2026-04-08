// src/controllers/stripeController.js
// ─────────────────────────────────────────────────────────
// Fluxo de pagamento Stripe para os planos 'base' e 'plus'
// Variáveis necessárias:
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//   STRIPE_PRICE_BASE, STRIPE_PRICE_PLUS
//   FRONTEND_URL
// ─────────────────────────────────────────────────────────
const { query } = require('../config/database')

const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY não configurado')
  return require('stripe')(process.env.STRIPE_SECRET_KEY)
}

// Mapeia plano → price_id configurado no ambiente
const getPriceId = (plano) => {
  const ids = {
    base: process.env.STRIPE_PRICE_BASE,
    plus: process.env.STRIPE_PRICE_PLUS,
  }
  return ids[plano] || null
}

// Determina o plano a partir do price_id recebido no evento
const planoDoPrice = (priceId) => {
  if (!priceId) return 'base'
  if (priceId === process.env.STRIPE_PRICE_PLUS) return 'plus'
  if (priceId === process.env.STRIPE_PRICE_BASE) return 'base'
  return 'base'
}

// ── CRIAR CHECKOUT SESSION ───────────────────────────────
const createCheckoutSession = async (req, res) => {
  try {
    const userId = req.userId
    const { plano } = req.body

    if (!['base', 'plus'].includes(plano)) {
      return res.status(400).json({ sucesso: false, erro: 'Plano inválido. Use "base" ou "plus".' })
    }

    const priceId = getPriceId(plano)
    if (!priceId) {
      return res.status(500).json({
        sucesso: false,
        erro: `STRIPE_PRICE_${plano.toUpperCase()} não configurado no servidor.`
      })
    }

    const stripe = getStripe()

    // Busca dados do usuário incluindo stripe_customer_id
    const result = await query(
      'SELECT id, nome, email, stripe_customer_id FROM usuarios WHERE id = $1',
      [userId]
    )
    if (!result.rows.length) {
      return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado' })
    }
    const usuario = result.rows[0]

    // Cria ou reutiliza o Customer no Stripe
    let stripeCustomerId = usuario.stripe_customer_id
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email:    usuario.email,
        name:     usuario.nome,
        metadata: { userId },
      })
      stripeCustomerId = customer.id
      await query(
        'UPDATE usuarios SET stripe_customer_id = $1, atualizado_em = NOW() WHERE id = $2',
        [stripeCustomerId, userId]
      )
      console.log(`[STRIPE] Customer criado: ${stripeCustomerId} para user ${userId}`)
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://usenexor.site'

    const session = await stripe.checkout.sessions.create({
      customer:   stripeCustomerId,
      mode:       'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendUrl}/plano/sucesso?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${frontendUrl}/plano/cancelado`,
      metadata: { userId, plano },
      subscription_data: {
        metadata: { userId, plano },
      },
      allow_promotion_codes: true,
    })

    console.log(`[STRIPE] Checkout session criada: ${session.id} — user ${userId} — plano ${plano}`)
    res.json({ sucesso: true, url: session.url })

  } catch (err) {
    console.error('[STRIPE] Erro ao criar checkout session:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro ao iniciar checkout' })
  }
}

// ── WEBHOOK ──────────────────────────────────────────────
// Recebe eventos do Stripe e atualiza a coluna `plan` (base/plus)
// Body raw obrigatório — configurado em server.js
const handleWebhook = async (req, res) => {
  let event

  try {
    const stripe = getStripe()
    const sig = req.headers['stripe-signature']
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
    } else if (process.env.NODE_ENV === 'production') {
      console.error('[STRIPE] CRÍTICO: STRIPE_WEBHOOK_SECRET não configurado em produção!')
      return res.status(500).json({ erro: 'Configuração do servidor incorreta' })
    } else {
      event = req.body
      console.warn('[STRIPE] STRIPE_WEBHOOK_SECRET não configurado — pulando validação (apenas dev)')
    }
  } catch (err) {
    console.error('[STRIPE] Assinatura inválida:', err.message)
    return res.status(400).json({ erro: `Webhook inválido: ${err.message}` })
  }

  console.log(`[STRIPE] Evento: ${event.type}`)

  try {
    switch (event.type) {

      // ── Checkout concluído: ativa o plano comprado ──────
      case 'checkout.session.completed': {
        const session  = event.data.object
        const userId   = session.metadata?.userId
        const plano    = session.metadata?.plano || 'base'
        const subId    = session.subscription

        if (!userId) {
          console.warn('[STRIPE] checkout.session.completed sem userId no metadata')
          break
        }
        await atualizarPlan(userId, plano, subId, 'ativo')
        console.log(`[STRIPE] ✅ Plano ativado: user ${userId} → ${plano}`)
        break
      }

      // ── Assinatura alterada (upgrade, downgrade, inadimplência) ──
      case 'customer.subscription.updated': {
        const sub    = event.data.object
        const userId = sub.metadata?.userId

        if (!userId) {
          console.warn('[STRIPE] customer.subscription.updated sem userId no metadata')
          break
        }

        const priceId = sub.items?.data[0]?.price?.id
        const plano   = planoDoPrice(priceId)

        if (sub.status === 'active') {
          await atualizarPlan(userId, plano, sub.id, 'ativo')
          console.log(`[STRIPE] 🔄 Assinatura atualizada: user ${userId} → ${plano}`)
        } else if (['past_due', 'unpaid', 'canceled'].includes(sub.status)) {
          await atualizarPlan(userId, 'base', null, 'cancelado')
          console.log(`[STRIPE] ⚠️ Acesso rebaixado (${sub.status}): user ${userId} → base`)
        }
        break
      }

      // ── Assinatura deletada: rebaixa para base ──────────
      case 'customer.subscription.deleted': {
        const sub    = event.data.object
        const userId = sub.metadata?.userId

        if (!userId) {
          console.warn('[STRIPE] customer.subscription.deleted sem userId no metadata')
          break
        }
        await atualizarPlan(userId, 'base', null, 'cancelado')
        console.log(`[STRIPE] ❌ Assinatura cancelada: user ${userId} → base`)
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

// ── Helper: atualiza plan + stripe_subscription_id ───────
async function atualizarPlan(userId, plano, subscriptionId, statusPlano) {
  const resultado = await query(
    `UPDATE usuarios
     SET plan                   = $2,
         plano                  = $4,
         stripe_subscription_id = COALESCE($3, stripe_subscription_id),
         atualizado_em          = NOW()
     WHERE id = $1
     RETURNING id`,
    [userId, plano, subscriptionId || null, statusPlano]
  )
  if (!resultado.rows.length) {
    console.warn(`[STRIPE] Usuário não encontrado pelo ID: ${userId}`)
  }
}

module.exports = { createCheckoutSession, handleWebhook }
