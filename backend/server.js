// ========================================================
// 1. IMPORTAÇÕES E SEGURANÇA
// ========================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Pool } = require('pg');
const { createClient } = require('redis');
const http = require('http');
const { Server } = require("socket.io");
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// ========================================================
// 2. VERIFICAÇÃO DE AMBIENTE (FAIL-FAST)
// ========================================================
if (!process.env.DB_PASS || !process.env.REDIS_URL) {
    console.error("❌ ERRO FATAL: Variáveis de ambiente (.env) não configuradas!");
    process.exit(1);
}

// ========================================================
// 3. CONFIGURAÇÕES DE NEGÓCIO
// ========================================================
const PORTA_API = process.env.PORT || 3000;
const PRECO_BASE = 4.00;
const PRECO_POR_KM = 1.60;
const PRECO_POR_MIN = 0.30;

// ========================================================
// 4. INFRAESTRUTURA (BANCO, REDIS, OSRM)
// ========================================================
const OSRM_URL_BASE = process.env.OSRM_URL;

const DB_CONFIG = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASS,
    port: process.env.DB_PORT
};

const REDIS_URL = process.env.REDIS_URL;

// ========================================================
// 5. INICIALIZAÇÃO DO SERVIDOR (EXPRESS + SOCKET)
// ========================================================
const app = express();

// CORS EXPANDIDO PARA MVP
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.use(express.static('public')); // Serve o Painel Web

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// ========================================================
// 6. CONEXÃO COM BANCO DE DADOS E CACHE
// ========================================================
const pool = new Pool(DB_CONFIG);
const redisClient = createClient({ url: REDIS_URL });

(async () => {
    try {
        await redisClient.connect();
        console.log("✅ Redis Conectado");
    } catch (e) {
        console.error("❌ Erro Redis:", e.message);
    }
})();

// ========================================================
// 7. WEBSOCKET (SOCKET.IO) - TEMPO REAL
// ========================================================
io.on('connection', (socket) => {
    console.log(`🔌 Novo dispositivo conectado: ${socket.id}`);

    socket.on('entrar_como_motorista', (dados) => {
        console.log(`🏍️ Motoboy ID ${dados.id_motorista} na escuta.`);
        socket.join('motoristas_disponiveis'); 
    });

    socket.on('disconnect', () => { /* Silencioso para limpar logs */ });
});

// ========================================================
// 8. MIDDLEWARE DE SEGURANÇA (JWT) - DESATIVADO PARA MVP
// ========================================================
// 🔧 PARA ATIVAR AUTENTICAÇÃO: remova o 'return next()' abaixo e use nas rotas
function autenticarToken(req, res, next) {
    // ⚠️ MODO MVP: DESATIVADO - remova a linha abaixo para ativar
    return next();
    
    // ⬇️ CÓDIGO DE AUTENTICAÇÃO (comentado para MVP)
    /*
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 

    if (!token) return res.status(401).json({ erro: 'Acesso negado. Token necessário.' });

    jwt.verify(token, JWT_SECRET, (err, usuario) => {
        if (err) return res.status(403).json({ erro: 'Token inválido ou expirado.' });
        req.usuario = usuario;
        next();
    });
    */
}

// ========================================================
// 9. ROTAS DE AUTENTICAÇÃO (LOGIN/CADASTRO)
// ========================================================

app.post('/api/cadastrar', async (req, res) => {
    const { nome, email, senha, tipo, telefone } = req.body;
    if (!nome || !email || !senha || !tipo) return res.status(400).json({ erro: 'Dados incompletos' });

    try {
        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(senha, salt);
        const dbRes = await pool.query(
            'INSERT INTO usuarios (nome, email, senha_hash, tipo, telefone) VALUES ($1, $2, $3, $4, $5) RETURNING id, nome, email, tipo',
            [nome, email, senhaHash, tipo, telefone]
        );
        res.json({ sucesso: true, usuario: dbRes.rows[0] });
    } catch (error) { res.status(500).json({ erro: error.message }); }
});

app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const userQuery = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (userQuery.rowCount === 0) return res.status(404).json({ erro: 'Usuário não encontrado.' });

        const usuario = userQuery.rows[0];
        const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
        if (!senhaValida) return res.status(401).json({ erro: 'Senha incorreta.' });

        const token = jwt.sign({ id: usuario.id, tipo: usuario.tipo }, JWT_SECRET, { expiresIn: '24h' });

        res.json({
            sucesso: true,
            token: token,
            usuario: { id: usuario.id, nome: usuario.nome, tipo: usuario.tipo }
        });
    } catch (error) { res.status(500).json({ erro: 'Erro no login' }); }
});

// ========================================================
// 10. ROTAS PRINCIPAIS (CORRIDA)
// ========================================================

app.get('/', (req, res) => {
    res.json({ 
        status: 'TripShare API Online',
        versao: 'MVP-v1',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        api: 'tripshare',
        modo: 'MVP (sem autenticação)',
        tempo: new Date().toISOString()
    });
});

// --- ROTA: SOLICITAR (PASSAGEIRO) ---
app.post('/api/solicitar-corrida', async (req, res) => {
    try {
        const { id_passageiro, origem, destino } = req.body; 
        console.log(`📍 Corrida solicitada: Pass=${id_passageiro}, Orig=${origem}, Dest=${destino}`);
        
        if (!id_passageiro || !origem || !destino) {
            return res.status(400).json({ erro: 'Dados incompletos', recebido: { id_passageiro, origem, destino } });
        }

        // Cálculo OSRM
        const strOrigem = String(origem);
        const strDestino = String(destino);
        const urlOSRM = `${OSRM_URL_BASE}/${strOrigem};${strDestino}?overview=full&geometries=geojson`;
        
        console.log(`🗺️ Consultando OSRM: ${urlOSRM}`);
        const response = await axios.get(urlOSRM);
        
        if (response.data.code !== 'Ok') {
            console.error('❌ OSRM retornou erro:', response.data.code);
            throw new Error(`Erro OSRM: ${response.data.code}`);
        }

        const rota = response.data.routes[0];
        const km = rota.distance / 1000;
        const min = rota.duration / 60;
        let preco = parseFloat((PRECO_BASE + (km * PRECO_POR_KM) + (min * PRECO_POR_MIN)).toFixed(2));

        // Gravar no Banco
        const [lonOrig, latOrig] = strOrigem.split(',');
        const [lonDest, latDest] = strDestino.split(',');

        const query = `
            INSERT INTO corridas (id_passageiro, origem_texto, destino_texto, distancia_km, tempo_minutos, valor_total, origem_geom, destino_geom, status) 
            VALUES ($1, 'Mobile', 'Mobile', $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), ST_SetSRID(ST_MakePoint($7, $8), 4326), 'pendente') 
            RETURNING id;
        `;
        const dbRes = await pool.query(query, [id_passageiro, km, min, preco, lonOrig, latOrig, lonDest, latDest]);
        const novaCorrida = dbRes.rows[0];

        // Disparar Alerta Socket
        if(io) {
            io.to('motoristas_disponiveis').emit('alerta_corrida', {
                id_corrida: novaCorrida.id, valor: preco,
                distancia: `${km.toFixed(1)} km`, tempo: `${min.toFixed(0)} min`,
                geometria: rota.geometry
            });
            console.log(`📢 Alerta enviado a motoristas via Socket.IO`);
        }

        console.log(`✅ Corrida #${novaCorrida.id} criada: R$ ${preco} (${km.toFixed(1)}km)`);
        
        res.json({ 
            sucesso: true, 
            id_corrida: novaCorrida.id, 
            status: 'buscando_moto', 
            valor: preco, 
            distancia: `${km.toFixed(1)} km`, 
            tempo: `${min.toFixed(0)} min` 
        });

    } catch (error) {
        console.error("❌ Erro solicitar:", error.message);
        res.status(500).json({ 
            erro: 'Erro interno', 
            detalhes: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// --- ROTA: ACEITAR (MOTORISTA) ---
app.post('/api/aceitar-corrida', async (req, res) => {
    const { id_corrida, id_motorista } = req.body;
    console.log(`🚘 Tentativa aceitar: Corrida=${id_corrida}, Moto=${id_motorista}`);
    
    if (!id_corrida || !id_motorista) {
        return res.status(400).json({ erro: 'Faltam dados', recebido: { id_corrida, id_motorista } });
    }

    try {
        const dbRes = await pool.query(
            "UPDATE corridas SET status = 'em_andamento', id_motorista = $1, atualizado_em = NOW() WHERE id = $2 AND status = 'pendente' RETURNING *",
            [id_motorista, id_corrida]
        );

        if (dbRes.rowCount === 0) {
            console.warn(`⚠️ Corrida #${id_corrida} não está disponível`);
            return res.status(409).json({ erro: 'Corrida indisponível ou já aceita' });
        }

        const corrida = dbRes.rows[0];
        console.log(`✅ Corrida #${id_corrida} aceita por motorista ${id_motorista}`);

        if(io) {
            io.emit('status_corrida', { 
                tipo: 'ACEITA', 
                id_corrida, 
                id_motorista, 
                status: 'em_andamento', 
                msg: 'Motorista a caminho!' 
            });
        }

        res.json({ sucesso: true, status: 'em_andamento', corrida });
    } catch (error) { 
        console.error("❌ Erro aceitar:", error.message); 
        res.status(500).json({ erro: 'Erro interno', detalhes: error.message }); 
    }
});

// --- ROTA: FINALIZAR (MOTORISTA) ---
app.post('/api/finalizar-corrida', async (req, res) => {
    const { id_corrida } = req.body;
    console.log(`🏁 Finalizando corrida: ${id_corrida}`);
    
    if (!id_corrida) {
        return res.status(400).json({ erro: 'ID da corrida necessário' });
    }
    
    try {
        const dbRes = await pool.query(
            "UPDATE corridas SET status = 'finalizada', finalizado_em = NOW() WHERE id = $1 RETURNING *",
            [id_corrida]
        );
        
        if (dbRes.rowCount === 0) {
            console.warn(`⚠️ Corrida #${id_corrida} não encontrada`);
            return res.status(404).json({ erro: 'Corrida não encontrada' });
        }

        console.log(`✅ Corrida #${id_corrida} finalizada`);
        
        if(io) {
            io.emit('status_corrida', { 
                tipo: 'FINALIZADA', 
                id_corrida, 
                status: 'finalizada', 
                msg: 'Viagem encerrada.' 
            });
        }

        res.json({ sucesso: true });
    } catch (error) { 
        console.error("❌ Erro finalizar:", error.message); 
        res.status(500).json({ erro: 'Erro interno', detalhes: error.message }); 
    }
});

// ========================================================
// 11. ROTA DE HISTÓRICO
// ========================================================
app.get('/api/corridas/:usuario_id', async (req, res) => {
    try {
        const dbRes = await pool.query(
            "SELECT id, valor_total, status, criado_em, distancia_km FROM corridas WHERE id_passageiro = $1 OR id_motorista = $1 ORDER BY id DESC LIMIT 20",
            [req.params.usuario_id]
        );
        res.json({ sucesso: true, historico: dbRes.rows });
    } catch (error) { res.status(500).json({ erro: 'Erro histórico' }); }
});

// ========================================================
// 12. START DO SERVIDOR
// ========================================================
server.listen(PORTA_API, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║           🚀 TripShare Backend - MVP v1                   ║
╠════════════════════════════════════════════════════════════╣
║ Porta:                    ${PORTA_API}                        ║
║ Base Price:               R$ ${PRECO_BASE}                        ║
║ Price per km:             R$ ${PRECO_POR_KM}                      ║
║ Price per min:            R$ ${PRECO_POR_MIN}                      ║
║ Auth Mode:                DISABLED (MVP)                ║
║ CORS:                     Aberto para todos              ║
║ Socket.IO:                ✅ Ativo                         ║
╠════════════════════════════════════════════════════════════╣
║ Rotas disponíveis:                                       ║
║ POST   /api/cadastrar                                    ║
║ POST   /api/login                                        ║
║ POST   /api/solicitar-corrida                            ║
║ POST   /api/aceitar-corrida                              ║
║ POST   /api/finalizar-corrida                            ║
║ GET    /api/corridas/:usuario_id                         ║
║ GET    /api/health                                       ║
║ GET    /                                                 ║
╚════════════════════════════════════════════════════════════╝
    `);
});