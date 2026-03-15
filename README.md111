# 🚀 Nexor API — Backend Completo

API REST segura para o Nexor, sistema de gestão financeira para microempreendedores.

---

## 🏗️ Estrutura do Projeto

```
nexor-api/
├── sql/
│   └── schema.sql              # Tabelas + RLS + índices
├── src/
│   ├── config/
│   │   ├── database.js         # Pool PostgreSQL + RLS helper
│   │   └── migrate.js          # Executar migração do banco
│   ├── controllers/
│   │   ├── authController.js   # Cadastro, login, refresh, logout
│   │   ├── vendasController.js # CRUD de vendas + resumos
│   │   ├── despesasController.js
│   │   ├── dashboardController.js # Índice Nexor + resumos
│   │   └── metasController.js  # Metas + produtos/precificação
│   ├── middleware/
│   │   ├── auth.js             # JWT — protege rotas privadas
│   │   └── validacao.js        # Sanitização de todos os inputs
│   ├── routes/
│   │   └── index.js            # Mapa completo de rotas
│   └── server.js               # Entry point — Express + segurança
├── .env.example                # Template de variáveis de ambiente
└── package.json
```

---

## ⚙️ Instalação e Configuração

### 1. Clonar e instalar dependências
```bash
git clone https://github.com/seu-usuario/nexor-api.git
cd nexor-api
npm install
```

### 2. Configurar variáveis de ambiente
```bash
cp .env.example .env
```
Edite o `.env` com suas credenciais:
```env
DB_HOST=localhost
DB_NAME=nexor_db
DB_USER=nexor_user
DB_PASSWORD=sua_senha_aqui

# Gerar JWT_SECRET seguro:
# node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=cole_aqui_a_chave_gerada
```

### 3. Criar o banco de dados PostgreSQL
```bash
# Acesse o PostgreSQL como superusuário
psql -U postgres

# Crie o banco e o usuário
CREATE DATABASE nexor_db;
CREATE USER nexor_user WITH PASSWORD 'sua_senha_aqui';
GRANT ALL PRIVILEGES ON DATABASE nexor_db TO nexor_user;
\q
```

### 4. Executar a migração (cria tabelas + RLS)
```bash
npm run db:migrate
```

### 5. Iniciar o servidor
```bash
# Desenvolvimento (com hot reload)
npm run dev

# Produção
npm start
```

---

## 📡 Rotas da API

### 🔓 Autenticação (públicas)
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/auth/cadastro` | Cria nova conta |
| POST | `/api/auth/login` | Login — retorna tokens |
| POST | `/api/auth/refresh` | Renova o access token |
| POST | `/api/auth/logout` | Invalida a sessão |

### 📊 Dashboard (requer token)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/dashboard/resumo?mes=3&ano=2026` | Resumo completo do mês |
| GET | `/api/dashboard/indice` | Calcula Índice Nexor (0–100) |
| GET | `/api/dashboard/comparacao` | Últimos 6 meses |
| GET | `/api/dashboard/diario` | Fluxo dos últimos 14 dias |

### 💚 Vendas (requer token)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/vendas?mes=3&ano=2026` | Lista vendas paginadas |
| POST | `/api/vendas` | Registra nova venda |
| DELETE | `/api/vendas/:id` | Remove venda |
| GET | `/api/vendas/resumo/dia` | Total do dia |
| GET | `/api/vendas/resumo/mes` | Resumo mensal |

### 🔴 Despesas (requer token)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/despesas` | Lista despesas |
| POST | `/api/despesas` | Registra despesa |
| DELETE | `/api/despesas/:id` | Remove despesa |
| GET | `/api/despesas/resumo/mes` | Total e por categoria |

### 🎯 Metas e Produtos (requer token)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/metas` | Lista metas |
| POST | `/api/metas` | Cria/atualiza meta do mês |
| GET | `/api/produtos` | Lista produtos |
| POST | `/api/produtos` | Cria produto com precificação |
| DELETE | `/api/produtos/:id` | Remove produto |

---

## 🔒 Camadas de Segurança

```
Request
   │
   ▼
[Helmet]         → Headers HTTP seguros (XSS, Clickjacking...)
   │
   ▼
[CORS]           → Só aceita o domínio do frontend
   │
   ▼
[Rate Limiting]  → Máx. 10 logins / 100 requests por 15min
   │
   ▼
[Body Parser]    → Limita payload a 10kb
   │
   ▼
[JWT Middleware] → Verifica token em todas as rotas privadas
   │
   ▼
[Validação]      → Sanitiza e valida todos os campos do body
   │
   ▼
[Controller]     → Lógica com user_id vindo sempre do TOKEN
   │
   ▼
[queryWithUser]  → Define app.current_user_id na sessão SQL
   │
   ▼
[RLS PostgreSQL] → Banco bloqueia acesso a dados de outro user
```

### Por que RLS é tão importante?
Mesmo que o desenvolvedor esqueça de colocar o `WHERE user_id = $1` numa query, o banco de dados **bloqueia automaticamente** qualquer dado que não pertença ao usuário autenticado. É uma segunda linha de defesa no nível do banco.

---

## 🌐 Deploy (Produção)

### Opção recomendada — Supabase + Railway

**Banco de dados: [Supabase](https://supabase.com)**
- PostgreSQL gerenciado com RLS nativo
- Painel visual para visualizar dados
- Backups automáticos
- Gratuito até 500MB

```bash
# Após criar o projeto no Supabase, pegue a connection string
# e coloque no .env de produção
DB_HOST=db.xxxx.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=sua_senha_supabase
```

**Backend: [Railway](https://railway.app)**
```bash
# Instale o CLI do Railway
npm install -g @railway/cli

# Faça login e deploy
railway login
railway init
railway up
```

**Variáveis de ambiente no Railway:**
- Vá em Settings → Variables
- Adicione todas as variáveis do `.env.example`
- Defina `NODE_ENV=production`

---

## 🧪 Exemplos de Request

### Cadastro
```bash
curl -X POST http://localhost:3000/api/auth/cadastro \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "Maria Clara",
    "email": "maria@doceriasantos.com.br",
    "senha": "Senha@2026",
    "tipo_negocio": "Alimentação / Confeitaria"
  }'
```

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "maria@doceriasantos.com.br", "senha": "Senha@2026"}'
```

### Registrar venda (com token)
```bash
curl -X POST http://localhost:3000/api/vendas \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -H "Content-Type: application/json" \
  -d '{"valor": 180.00, "categoria": "Produto", "pagamento": "Pix", "produto": "Bolo Gourmet"}'
```

### Dashboard do mês
```bash
curl http://localhost:3000/api/dashboard/resumo?mes=3&ano=2026 \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```
