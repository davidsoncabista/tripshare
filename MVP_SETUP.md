# 🚀 TripShare MVP - Guia Rápido de Integração

## ⚙️ Status Atual

✅ **Backend configurado para MVP com Autenticação**
- ✅ Autenticação JWT **ATIVA** (login/cadastro com validação)
- ✅ Rotas de corrida **SEM validação de token** (fluxo contínuo)
- ✅ CORS aberto para todos
- ✅ Socket.IO funcionando em tempo real
- ✅ Logs detalhados para debug

## 🔌 Endpoints Disponíveis

### Autenticação (com validação de senha)
```
POST /api/cadastrar
  Header: Nenhum necessário
  Body: { nome, email, senha, tipo, telefone }
  Response: { sucesso, usuario: { id, nome, email, tipo } }

POST /api/login
  Header: Nenhum necessário
  Body: { email, senha }
  Response: { sucesso, token, usuario: { id, nome, tipo } }
```

### Corridas (SEM AUTENTICAÇÃO - IMPORTANTE!)
```
POST /api/solicitar-corrida
  Header: ❌ NÃO enviar Authorization
  Body: { id_passageiro, origem: "lon,lat", destino: "lon,lat" }
  Response: { sucesso, id_corrida, valor, distancia, tempo }

POST /api/aceitar-corrida
  Header: ❌ NÃO enviar Authorization
  Body: { id_corrida, id_motorista }
  Response: { sucesso, status, corrida }

POST /api/finalizar-corrida
  Header: ❌ NÃO enviar Authorization
  Body: { id_corrida }
  Response: { sucesso }

GET /api/corridas/:usuario_id
  Header: ❌ NÃO enviar Authorization
  Response: { sucesso, historico: [...] }
```

### Health Check
```
GET /api/health
  Response: { status: 'OK', api: 'tripshare', modo: 'Autenticação Ativa' }

GET /
  Response: { status: 'TripShare API Online', versao: 'MVP-v1' }
```

## 🔧 Configuração do Frontend (React Native)

### 1. URL da API
```javascript
const API_URL = 'https://core.davidson.dev.br'; // Produção
// ou para desenvolvimento local:
const API_URL = 'http://localhost:3000';
```

### 2. Conexão Socket.IO
```javascript
import { io } from "socket.io-client";

const socket = io(API_URL);

// Para motoristas se registrarem
socket.emit("entrar_como_motorista", { id_motorista: user.id });

// Ouvir novas corridas (motorista)
socket.on("alerta_corrida", (dados) => {
  console.log("Nova corrida:", dados);
  // dados: { id_corrida, valor, distancia, tempo, geometria }
});

// Ouvir atualizações de status (passageiro e motorista)
socket.on("status_corrida", (dados) => {
  console.log("Status:", dados);
  // dados: { tipo: 'ACEITA'|'FINALIZADA', id_corrida, status, msg }
});
```

### 3. Cadastro (com validação de senha)
```javascript
try {
  const response = await axios.post(`${API_URL}/api/cadastrar`, {
    nome: "João Silva",
    email: "joao@example.com",
    senha: "senha123",
    tipo: "passageiro", // ou "motorista"
    telefone: "11999999999"
  });
  
  console.log("Usuário criado:", response.data);
  // { sucesso: true, usuario: { id, nome, email, tipo } }
} catch (error) {
  console.error("Erro no cadastro:", error.response?.data?.erro);
}
```

### 4. Login (gera token)
```javascript
try {
  const response = await axios.post(`${API_URL}/api/login`, {
    email: "joao@example.com",
    senha: "senha123"
  });
  
  const { token, usuario } = response.data;
  console.log("Token recebido:", token);
  
  // Salvar token para usar depois se necessário
  await AsyncStorage.setItem('auth_token', token);
} catch (error) {
  console.error("Erro no login:", error.response?.data?.erro);
}
```

### 5. Solicitar Corrida (passageiro) - ⭐ SEM token
```javascript
try {
  const response = await axios.post(
    `${API_URL}/api/solicitar-corrida`,
    {
      id_passageiro: usuario.id,
      origem: `${coords.longitude},${coords.latitude}`,
      destino: `${destino.lon},${destino.lat}`
    }
    // ❌ NÃO incluir headers com token
  );
  
  console.log(response.data);
  // { sucesso, id_corrida, valor, distancia, tempo }
} catch (error) {
  console.error("Erro ao solicitar:", error.response?.data?.detalhes);
}
```

### 6. Aceitar Corrida (motorista) - ⭐ SEM token
```javascript
try {
  const response = await axios.post(
    `${API_URL}/api/aceitar-corrida`,
    {
      id_corrida: oferta.id_corrida,
      id_motorista: usuario.id
    }
    // ❌ NÃO incluir headers com token
  );
  
  console.log("Corrida aceita:", response.data);
  // { sucesso, status: 'em_andamento', corrida }
} catch (error) {
  console.error("Erro ao aceitar:", error.response?.data?.erro);
}
```

### 7. Finalizar Corrida (motorista) - ⭐ SEM token
```javascript
try {
  const response = await axios.post(
    `${API_URL}/api/finalizar-corrida`,
    {
      id_corrida: dadosCorrida.id_corrida
    }
    // ❌ NÃO incluir headers com token
  );
  
  console.log("Corrida finalizada:", response.data);
  // { sucesso: true }
} catch (error) {
  console.error("Erro ao finalizar:", error.response?.data?.erro);
}
```

### 8. Obter Histórico (sem token)
```javascript
try {
  const response = await axios.get(
    `${API_URL}/api/corridas/${usuario.id}`
    // ❌ NÃO incluir headers com token
  );
  
  console.log("Histórico:", response.data.historico);
  // [{ id, valor_total, status, criado_em, distancia_km }, ...]
} catch (error) {
  console.error("Erro ao buscar histórico:", error.response?.data?.erro);
}
```

## 📊 Fluxo de Uma Corrida

```
1. PASSAGEIRO solicita corrida (/api/solicitar-corrida)
   ├─ Backend consulta OSRM para rota
   ├─ Calcula distância, tempo e valor
   ├─ Persiste no banco com status 'pendente'
   └─ Emite evento 'alerta_corrida' via Socket.IO para motoristas

2. MOTORISTA recebe alerta em tempo real
   ├─ app.on("alerta_corrida") ← Vibra + mostra Alert
   ├─ Motorista pode ignorar ou aceitar
   └─ Se aceitar → aciona /api/aceitar-corrida

3. Se MOTORISTA ACEITA (/api/aceitar-corrida)
   ├─ Status muda para 'em_andamento'
   ├─ Registra id_motorista na corrida
   ├─ Emite evento 'status_corrida' para clientes
   └─ Passageiro notificado: "Motorista a caminho!"

4. MOTORISTA FINALIZA (/api/finalizar-corrida)
   ├─ Status muda para 'finalizada'
   ├─ Registra horário de conclusão
   ├─ Emite evento 'status_corrida' para clientes
   └─ Corrida salva no histórico permanentemente
```

## 🐛 Debug & Troubleshooting

### Ver logs do servidor em tempo real
```bash
cd /var/www/backend
npm start
# ou
node server.js
```

### Logs esperados quando tudo funciona:
```
🚀 API rodando na porta 3000
✅ Redis Conectado
🔌 Novo dispositivo conectado: <socket-id>
📍 Corrida solicitada: Pass=1, Orig=-48.49,-1.455
🗺️ Consultando OSRM: http://localhost:5000/...
✅ Corrida #1 criada: R$ 8.50 (1.2km)
📢 Alerta enviado a motoristas via Socket.IO
```

### Testar endpoints com curl
```bash
# Health check
curl https://core.davidson.dev.br/api/health

# Solicitar corrida (SEM Authorization header)
curl -X POST https://core.davidson.dev.br/api/solicitar-corrida \
  -H "Content-Type: application/json" \
  -d '{
    "id_passageiro": 1,
    "origem": "-48.49,-1.455",
    "destino": "-48.50,-1.460"
  }'

# Aceitar corrida (SEM Authorization header)
curl -X POST https://core.davidson.dev.br/api/aceitar-corrida \
  -H "Content-Type: application/json" \
  -d '{"id_corrida": 1, "id_motorista": 2}'

# Finalizar corrida (SEM Authorization header)
curl -X POST https://core.davidson.dev.br/api/finalizar-corrida \
  -H "Content-Type: application/json" \
  -d '{"id_corrida": 1}'
```

## ⚠️ Erros Comuns & Soluções

### Erro: "Dados incompletos"
```
❌ Você enviou: POST /api/solicitar-corrida sem id_passageiro
✅ Solução: Incluir no body { id_passageiro, origem, destino }
```

### Erro: "Faltam dados"
```
❌ Você enviou: POST /api/aceitar-corrida sem id_motorista
✅ Solução: Incluir no body { id_corrida, id_motorista }
```

### Erro: "Corrida indisponível ou já aceita"
```
❌ Você tentou aceitar uma corrida que já foi aceita por outro motorista
✅ Solução: Apenas uma vez por corrida, status muda para 'em_andamento'
```

### Socket.IO não conecta
```
❌ Você pode estar usando URL errada ou CORS bloqueado
✅ Solução: Usar exatamente a URL da API, CORS está aberto para "*"
```

## 📝 Variáveis de Ambiente Necessárias

```env
# Banco de Dados PostgreSQL
DB_USER=tripshare_user
DB_HOST=localhost
DB_NAME=tripshare_db
DB_PASS=sua_senha_super_secreta
DB_PORT=5432

# Redis (Cache)
REDIS_URL=redis://localhost:6379

# JWT (para autenticação)
JWT_SECRET=sua_chave_jwt_super_secreta_aqui

# Servidor
PORT=3000

# OSRM (serviço de roteamento)
OSRM_URL=http://localhost:5000/route/v1/driving
```

## 🎯 Checklist MVP

- [x] Backend com autenticação JWT funcionando
- [x] Rotas de corrida sem validação de token
- [x] CORS configurado corretamente
- [x] Socket.IO emitindo eventos
- [x] OSRM calculando rotas
- [ ] Frontend conectado e testando
- [ ] Fluxo completo passageiro funcionando
- [ ] Fluxo completo motorista funcionando
- [ ] Validar geometria no mapa
- [ ] Testar notificações Socket.IO

## 🚀 Próximos Passos

1. ✅ Backend pronto
2. ⏳ Testar app React Native contra endpoints
3. ⏳ Validar Socket.IO com passageiro e motorista
4. ⏳ Testar cálculo de preços e rotas
5. ⏳ Deploy em produção com HTTPS

---

**Versão:** 1.1 (Com Autenticação)  
**Última atualização:** 2025-12-04  
**Status:** Production-Ready
