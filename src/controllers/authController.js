// src/controllers/authController.js
// ─────────────────────────────────────────────────────────
// Controller de Autenticação
// Cadastro, Login, Refresh Token, Logout
// ─────────────────────────────────────────────────────────
const bcrypt = require('bcrypt')
const jwt    = require('jsonwebtoken')
const { v4: uuidv4 } = require('uuid')
const { query } = require('../config/database')

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12

// ── Gera par de tokens (access + refresh) ──────────────
const gerarTokens = (userId, plano) => {
  const accessToken = jwt.sign(
    { userId, plano },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  )
  const refreshToken = uuidv4() // token opaco para refresh
  return { accessToken, refreshToken }
}

// ── CADASTRO ────────────────────────────────────────────
const cadastrar = async (req, res) => {
  try {
    const { nome, email, senha, tipo_negocio, faturamento_medio } = req.body

    // Verifica se e-mail já existe (sem revelar qual dado é duplicado)
    const existe = await query(
      'SELECT id FROM usuarios WHERE email = $1',
      [email.toLowerCase().trim()]
    )
    if (existe.rows.length > 0) {
      return res.status(409).json({
        sucesso: false,
        erro: 'Não foi possível criar a conta com esses dados'
      })
    }

    // Hash da senha — bcrypt com salt automático
    // 12 rounds = ~300ms por hash — seguro contra força bruta
    const senhaHash = await bcrypt.hash(senha, BCRYPT_ROUNDS)

    // Cria o usuário
    const novoUsuario = await query(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo_negocio, faturamento_medio)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nome, email, plano, criado_em`,
      [
        nome.trim(),
        email.toLowerCase().trim(),
        senhaHash,
        tipo_negocio || null,
        faturamento_medio || null
      ]
    )

    const usuario = novoUsuario.rows[0]
    const { accessToken, refreshToken } = gerarTokens(usuario.id, usuario.plano)

    // Salva refresh token no banco com expiração de 30 dias
    const expiraEm = new Date()
    expiraEm.setDate(expiraEm.getDate() + 30)

    await query(
      'INSERT INTO refresh_tokens (user_id, token, expira_em) VALUES ($1, $2, $3)',
      [usuario.id, refreshToken, expiraEm]
    )

    res.status(201).json({
      sucesso: true,
      mensagem: 'Conta criada com sucesso!',
      token: accessToken,
      refresh_token: refreshToken,
      usuario: {
        id:    usuario.id,
        nome:  usuario.nome,
        email: usuario.email,
        plano: usuario.plano
      }
    })

  } catch (err) {
    console.error('Erro no cadastro:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro interno do servidor' })
  }
}

// ── LOGIN ───────────────────────────────────────────────
const login = async (req, res) => {
  try {
    const { email, senha } = req.body

    // Busca o usuário
    const resultado = await query(
      'SELECT id, nome, email, senha_hash, plano, ativo FROM usuarios WHERE email = $1',
      [email.toLowerCase().trim()]
    )

    // Mensagem genérica — nunca revela se o e-mail existe ou não
    const erroPadrao = 'E-mail ou senha incorretos'

    if (resultado.rows.length === 0) {
      // Mesmo que o usuário não exista, executa o bcrypt
      // Isso previne timing attacks (medir tempo de resposta)
      await bcrypt.hash('dummy_para_timing_attack', BCRYPT_ROUNDS)
      return res.status(401).json({ sucesso: false, erro: erroPadrao })
    }

    const usuario = resultado.rows[0]

    if (!usuario.ativo) {
      return res.status(403).json({ sucesso: false, erro: 'Conta desativada. Entre em contato com o suporte.' })
    }

    // Compara senha com hash — bcrypt.compare é seguro contra timing attacks
    const senhaCorreta = await bcrypt.compare(senha, usuario.senha_hash)
    if (!senhaCorreta) {
      return res.status(401).json({ sucesso: false, erro: erroPadrao })
    }

    const { accessToken, refreshToken } = gerarTokens(usuario.id, usuario.plano)

    // Salva novo refresh token
    const expiraEm = new Date()
    expiraEm.setDate(expiraEm.getDate() + 30)
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expira_em) VALUES ($1, $2, $3)',
      [usuario.id, refreshToken, expiraEm]
    )

    res.json({
      sucesso: true,
      token: accessToken,
      refresh_token: refreshToken,
      usuario: {
        id:    usuario.id,
        nome:  usuario.nome,
        email: usuario.email,
        plano: usuario.plano
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
    if (!refresh_token) {
      return res.status(400).json({ sucesso: false, erro: 'Refresh token não fornecido' })
    }

    // Verifica se o token existe e não expirou
    const resultado = await query(
      `SELECT rt.user_id, u.plano FROM refresh_tokens rt
       JOIN usuarios u ON rt.user_id = u.id
       WHERE rt.token = $1 AND rt.expira_em > NOW()`,
      [refresh_token]
    )

    if (resultado.rows.length === 0) {
      return res.status(401).json({ sucesso: false, erro: 'Refresh token inválido ou expirado' })
    }

    const { user_id, plano } = resultado.rows[0]

    // Deleta o token antigo (rotação de tokens — mais seguro)
    await query('DELETE FROM refresh_tokens WHERE token = $1', [refresh_token])

    // Gera novo par de tokens
    const tokens = gerarTokens(user_id, plano)
    const expiraEm = new Date()
    expiraEm.setDate(expiraEm.getDate() + 30)

    await query(
      'INSERT INTO refresh_tokens (user_id, token, expira_em) VALUES ($1, $2, $3)',
      [user_id, tokens.refreshToken, expiraEm]
    )

    res.json({
      sucesso: true,
      token: tokens.accessToken,
      refresh_token: tokens.refreshToken
    })

  } catch (err) {
    console.error('Erro no refresh:', err)
    res.status(500).json({ sucesso: false, erro: 'Erro interno do servidor' })
  }
}

// ── LOGOUT ──────────────────────────────────────────────
const logout = async (req, res) => {
  try {
    const { refresh_token } = req.body
    if (refresh_token) {
      // Deleta o refresh token — invalida a sessão completamente
      await query('DELETE FROM refresh_tokens WHERE token = $1', [refresh_token])
    }
    res.json({ sucesso: true, mensagem: 'Logout realizado com sucesso' })
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: 'Erro interno do servidor' })
  }
}

module.exports = { cadastrar, login, refreshToken, logout }

// ── ATUALIZAR PERFIL ─────────────────────────────────────
const atualizarPerfil = async (req, res) => {
  try {
    const { nome, tipo_negocio, faturamento_medio } = req.body
    const resultado = await query(
      `UPDATE usuarios SET nome=$1, tipo_negocio=$2, faturamento_medio=$3, atualizado_em=NOW()
       WHERE id=$4 RETURNING id, nome, email, tipo_negocio, faturamento_medio, plano`,
      [nome?.trim(), tipo_negocio, faturamento_medio, req.userId]
    )
    if (!resultado.rows.length) return res.status(404).json({ sucesso:false, erro:'Usuário não encontrado' })
    res.json({ sucesso:true, mensagem:'Perfil atualizado!', usuario: resultado.rows[0] })
  } catch(err) {
    console.error('Erro ao atualizar perfil:', err)
    res.status(500).json({ sucesso:false, erro:'Erro interno do servidor' })
  }
}

// ── RECUPERAR SENHA ──────────────────────────────────────
// (em produção: integrar com serviço de e-mail como Resend ou SendGrid)
const recuperarSenha = async (req, res) => {
  try {
    const { email } = req.body
    // Sempre retorna sucesso — não revela se o e-mail existe
    // Em produção: gerar token, salvar no banco, enviar e-mail
    const usuario = await query('SELECT id FROM usuarios WHERE email=$1',[email?.toLowerCase().trim()])
    if (usuario.rows.length > 0) {
      // TODO: gerar token de reset + enviar e-mail via Resend/SendGrid
      console.log(`[RECUPERAÇÃO] Solicitado para: ${email}`)
    }
    res.json({ sucesso:true, mensagem:'Se o e-mail existir, o link será enviado.' })
  } catch(err) {
    res.status(500).json({ sucesso:false, erro:'Erro interno' })
  }
}

module.exports = { cadastrar, login, refreshToken, logout, atualizarPerfil, recuperarSenha }
