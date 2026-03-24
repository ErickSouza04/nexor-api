// src/controllers/authController.js
const bcrypt = require('bcrypt')
const jwt    = require('jsonwebtoken')
const { v4: uuidv4 } = require('uuid')
const { query, pool } = require('../config/database')
const { calcularStatusPlano } = require('../middleware/auth')

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12

const gerarTokens = (userId, plano) => {
  const accessToken = jwt.sign(
    { userId, plano },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '4h' }
  )
  return { accessToken, refreshToken: uuidv4() }
}

const salvarRefreshToken = async (userId, refreshToken) => {
  const expiraEm = new Date()
  expiraEm.setDate(expiraEm.getDate() + 30)
  await query(
    'INSERT INTO refresh_tokens (user_id, token, expira_em) VALUES ($1, $2, $3)',
    [userId, refreshToken, expiraEm]
  )
}

// ── CADASTRO ────────────────────────────────────────────
const cadastrar = async (req, res) => {
  try {
    const { nome, email, senha, tipo_negocio, faturamento_medio } = req.body
    const emailNorm = email.toLowerCase().trim()

    // Verifica se email já existe; remove usuário órfão (sem token) criado por bug anterior
    const existe = await query(
      `SELECT u.id,
              EXISTS(SELECT 1 FROM refresh_tokens rt WHERE rt.user_id = u.id) AS tem_token
       FROM usuarios u WHERE u.email = $1`,
      [emailNorm]
    )
    if (existe.rows.length > 0) {
      const { id: idExistente, tem_token } = existe.rows[0]
      if (tem_token) {
        return res.status(409).json({ sucesso: false, erro: 'Não foi possível criar a conta com esses dados' })
      }
      // Usuário órfão (nunca completou o cadastro): remove para permitir novo registro
      await query('DELETE FROM usuarios WHERE id = $1', [idExistente])
    }

    const senhaHash = await bcrypt.hash(senha, BCRYPT_ROUNDS)
    const refreshTokenValue = uuidv4()

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Novo usuário começa com trial de 7 dias
      const novoUsuario = await client.query(
        `INSERT INTO usuarios (nome, email, senha_hash, tipo_negocio, faturamento_medio, plano, trial_inicio, trial_dias)
         VALUES ($1, $2, $3, $4, $5, 'trial', NOW(), 7)
         RETURNING id, nome, email, plano, tipo_plano, trial_inicio, trial_dias,
                   tipo_negocio, faturamento_medio, criado_em`,
        [nome.trim(), emailNorm, senhaHash, tipo_negocio || null, faturamento_medio || null]
      )

      const usuario = novoUsuario.rows[0]

      // Define contexto do usuário para a política RLS de refresh_tokens
      await client.query(`SET LOCAL app.current_user_id = '${usuario.id}'`)
      const expiraEm = new Date()
      expiraEm.setDate(expiraEm.getDate() + 30)
      await client.query(
        'INSERT INTO refresh_tokens (user_id, token, expira_em) VALUES ($1, $2, $3)',
        [usuario.id, refreshTokenValue, expiraEm]
      )

      await client.query('COMMIT')

      const statusPlano = calcularStatusPlano(usuario)
      const { accessToken } = gerarTokens(usuario.id, statusPlano.plano)

      res.status(201).json({
        sucesso: true,
        mensagem: 'Conta criada com sucesso! Você tem 7 dias grátis.',
        token: accessToken,
        refresh_token: refreshTokenValue,
        usuario: {
          id:               usuario.id,
          nome:             usuario.nome,
          email:            usuario.email,
          plano:            statusPlano.plano,
          tipo_plano:       statusPlano.tipo_plano,
          rotulo:           statusPlano.rotulo,
          preco:            statusPlano.preco,
          periodo:          statusPlano.periodo,
          diasRestantes:    statusPlano.diasRestantes,
          tipo_negocio:     usuario.tipo_negocio,
          faturamento_medio: usuario.faturamento_medio
        }
      })
    } catch (err) {
      await client.query('ROLLBACK')
      // Trata violação de unicidade (race condition de emails simultâneos)
      if (err.code === '23505') {
        return res.status(409).json({ sucesso: false, erro: 'Não foi possível criar a conta com esses dados' })
      }
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('Erro no cadastro:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro interno do servidor' })
  }
}

// ── LOGIN ───────────────────────────────────────────────
const login = async (req, res) => {
  try {
    const { email, senha } = req.body

    const resultado = await query(
      `SELECT id, nome, email, senha_hash, plano, tipo_plano, trial_inicio, trial_dias,
              tipo_negocio, faturamento_medio, ativo
       FROM usuarios WHERE email = $1`,
      [email.toLowerCase().trim()]
    )

    if (!resultado.rows.length) {
      return res.status(401).json({ sucesso: false, erro: 'E-mail ou senha incorretos' })
    }

    const usuario = resultado.rows[0]
    if (!usuario.ativo) {
      return res.status(403).json({ sucesso: false, erro: 'Conta desativada. Entre em contato.' })
    }

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha_hash)
    if (!senhaCorreta) {
      return res.status(401).json({ sucesso: false, erro: 'E-mail ou senha incorretos' })
    }

    // Calcula status do plano em tempo real
    const statusPlano = calcularStatusPlano(usuario)

    // Se trial acabou, atualiza no banco
    if (statusPlano.plano === 'expirado' && usuario.plano === 'trial') {
      await query('UPDATE usuarios SET plano = $1 WHERE id = $2', ['expirado', usuario.id])
    }

    const { accessToken, refreshToken } = gerarTokens(usuario.id, statusPlano.plano)
    await salvarRefreshToken(usuario.id, refreshToken)

    // Remove tokens expirados do usuário (limpeza passiva)
    await query('DELETE FROM refresh_tokens WHERE user_id = $1 AND expira_em < NOW()', [usuario.id])

    res.json({
      sucesso: true,
      token: accessToken,
      refresh_token: refreshToken,
      usuario: {
        id:               usuario.id,
        nome:             usuario.nome,
        email:            usuario.email,
        plano:            statusPlano.plano,
        tipo_plano:       statusPlano.tipo_plano,
        rotulo:           statusPlano.rotulo,
        preco:            statusPlano.preco,
        periodo:          statusPlano.periodo,
        diasRestantes:    statusPlano.diasRestantes,
        tipo_negocio:     usuario.tipo_negocio,
        faturamento_medio: usuario.faturamento_medio
      }
    })
  } catch (err) {
    console.error('Erro no login:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro interno do servidor' })
  }
}

// ── REFRESH TOKEN ────────────────────────────────────────
const refreshToken = async (req, res) => {
  try {
    const { refresh_token } = req.body
    if (!refresh_token) return res.status(400).json({ sucesso: false, erro: 'Refresh token não fornecido' })

    const resultado = await query(
      `SELECT rt.user_id, u.plano, u.trial_inicio, u.trial_dias FROM refresh_tokens rt
       JOIN usuarios u ON rt.user_id = u.id
       WHERE rt.token = $1 AND rt.expira_em > NOW()`,
      [refresh_token]
    )

    if (!resultado.rows.length) return res.status(401).json({ sucesso: false, erro: 'Refresh token inválido ou expirado' })

    const row = resultado.rows[0]
    const statusPlano = calcularStatusPlano(row)

    await query('DELETE FROM refresh_tokens WHERE token = $1', [refresh_token])
    const tokens = gerarTokens(row.user_id, statusPlano.plano)
    await salvarRefreshToken(row.user_id, tokens.refreshToken)

    res.json({ sucesso: true, token: tokens.accessToken, refresh_token: tokens.refreshToken })
  } catch (err) {
    console.error('Erro no refresh:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro interno do servidor' })
  }
}

// ── LOGOUT ──────────────────────────────────────────────
const logout = async (req, res) => {
  try {
    const { refresh_token } = req.body
    if (refresh_token) await query('DELETE FROM refresh_tokens WHERE token = $1', [refresh_token])
    res.json({ sucesso: true, mensagem: 'Logout realizado com sucesso' })
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: 'Erro interno do servidor' })
  }
}

// ── ATUALIZAR PERFIL ─────────────────────────────────────
const atualizarPerfil = async (req, res) => {
  try {
    const { nome, tipo_negocio, faturamento_medio } = req.body
    const resultado = await query(
      `UPDATE usuarios SET nome=$1, tipo_negocio=$2, faturamento_medio=$3, atualizado_em=NOW()
       WHERE id=$4
       RETURNING id, nome, email, tipo_negocio, faturamento_medio,
                 plano, tipo_plano, trial_inicio, trial_dias`,
      [nome?.trim(), tipo_negocio, faturamento_medio, req.userId]
    )
    if (!resultado.rows.length) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado' })

    const u = resultado.rows[0]
    const status = calcularStatusPlano(u)

    res.json({
      sucesso: true,
      mensagem: 'Perfil atualizado!',
      usuario: {
        id:               u.id,
        nome:             u.nome,
        email:            u.email,
        tipo_negocio:     u.tipo_negocio,
        faturamento_medio: u.faturamento_medio,
        plano:            status.plano,
        tipo_plano:       status.tipo_plano,
        rotulo:           status.rotulo,
        preco:            status.preco,
        periodo:          status.periodo,
        diasRestantes:    status.diasRestantes,
      }
    })
  } catch (err) {
    console.error('Erro ao atualizar perfil:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro interno do servidor' })
  }
}

// ── RECUPERAR SENHA ──────────────────────────────────────
const recuperarSenha = async (req, res) => {
  try {
    const { email } = req.body
    const usuario = await query('SELECT id FROM usuarios WHERE email=$1', [email?.toLowerCase().trim()])
    if (usuario.rows.length > 0) {
      console.log(`[RECUPERAÇÃO] Solicitado para: ${email}`)
      // TODO: integrar Resend/SendGrid para envio de e-mail
    }
    res.json({ sucesso: true, mensagem: 'Se o e-mail existir, o link será enviado.' })
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: 'Erro interno' })
  }
}

// ── STATUS DO PLANO ──────────────────────────────────────
const statusPlano = async (req, res) => {
  try {
    const result = await query(
      'SELECT plano, tipo_plano, trial_inicio, trial_dias FROM usuarios WHERE id = $1',
      [req.userId]
    )
    if (!result.rows.length) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado' })
    const status = calcularStatusPlano(result.rows[0])
    res.json({ sucesso: true, ...status })
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: 'Erro interno' })
  }
}

module.exports = { cadastrar, login, refreshToken, logout, atualizarPerfil, recuperarSenha, statusPlano }
