require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Pool } = require('pg');
const { createClient } = require('redis');
const http = require('http');
const { Server } = require("socket.io");
// --- SEGURANÇA sistema de autenticação ---
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

// --- VERIFICAÇÃO DE SEGURANÇA ---
// Se faltar alguma senha, o servidor nem inicia (melhor que quebrar depois) confia em mim
if (!process.env.DB_PASS || !process.env.REDIS_URL) {
    console.error("❌ ERRO FATAL: Variáveis de ambiente (.env) não configuradas!");
    process.exit(1);
}

// --- CONFIGURAÇÕES ---
const PORTA_API = process.env.PORT || 3000;
const PRECO_BASE = 4.00;
const PRECO_POR_KM = 1.60;
const PRECO_POR_MIN = 0.30;

// Infraestrutura (Lê APENAS do .env)
const OSRM_URL_BASE = process.env.OSRM_URL; // Sem fallback fixo
const DB_CONFIG = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASS, // <--- pega o password do .env
    port: process.env.DB_PORT
};
const REDIS_URL = process.env.REDIS_URL; // <--- endereço do Redis


// --- INICIALIZAÇÃO ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- NOVIDADE 2: Criar Servidor Híbrido (Express + Socket) ---
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Permite que qualquer front-end conecte (dev)
        methods: ["GET", "POST"]
    }
});

// Conexões
const pool = new Pool(DB_CONFIG);
const redisClient = createClient({ url: REDIS_URL });
(async () => {
    try {
        await redisClient.connect();
        console.log("✅ Redis Conectado");
    } catch (e) { console.error("❌ Erro Redis:", e.message); }
})();

// --- NOVIDADE 3: Gerenciar Conexões dos Motoboys ---
io.on('connection', (socket) => {
    console.log(`🔌 Novo dispositivo conectado: ${socket.id}`);

    // Quando o app do motoboy diz "Estou Online"
    socket.on('entrar_como_motorista', (dados) => {
        console.log(`🏍️ Motoboy Online! ID: ${dados.id_motorista}`);
        // Coloca este socket numa "Sala" exclusiva para receber alertas
        socket.join('motoristas_disponiveis'); 
    });

    socket.on('disconnect', () => {
        console.log(`❌ Dispositivo desconectou: ${socket.id}`);
    });
});

// --- ROTAS HTTP ---
app.get('/', (req, res) => res.json({ status: 'TripShare API + Socket Realtime' }));

// ROTA DE SOLICITAR CORRIDA
// Note o 'autenticarToken' ali no meio
app.post('/api/solicitar-corrida', autenticarToken, async (req, res) => { ...
    try {
        console.log("📥 Recebi pedido:", req.body); // LOG NOVO: Ver o que chegou do celular

        const { id_passageiro, origem, destino } = req.body;

        if (!id_passageiro || !origem || !destino) {
            console.error("❌ Faltam dados no pedido");
            return res.status(400).json({ erro: 'Dados incompletos' });
        }

        // Garante que seja string antes de dar split
        const strOrigem = String(origem);
        const strDestino = String(destino);

        // 1. Calcular Rota (OSRM)
        // OSRM espera: longitude,latitude
        const urlOSRM = `${OSRM_URL_BASE}/${strOrigem};${strDestino}?overview=full&geometries=geojson`;
        console.log("🗺️ Consultando OSRM:", urlOSRM); // LOG NOVO

        const response = await axios.get(urlOSRM);
        
        if (response.data.code !== 'Ok') {
            console.error("❌ Erro OSRM:", response.data);
            throw new Error('OSRM não encontrou rota');
        }

        const rota = response.data.routes[0];
        const km = rota.distance / 1000;
        const min = rota.duration / 60;
        let preco = PRECO_BASE + (km * PRECO_POR_KM) + (min * PRECO_POR_MIN);
        preco = parseFloat(preco.toFixed(2));

        // 2. Salvar no Banco
        // Precisamos separar Longitude e Latitude para o PostGIS
        const [lonOrig, latOrig] = strOrigem.split(',');
        const [lonDest, latDest] = strDestino.split(',');

        const query = `
            INSERT INTO corridas (
                id_passageiro, origem_texto, destino_texto, 
                distancia_km, tempo_minutos, valor_total,
                origem_geom, destino_geom, status
            ) VALUES ($1, 'App Mobile', 'App Mobile', $2, $3, $4, 
                ST_SetSRID(ST_MakePoint($5, $6), 4326),
                ST_SetSRID(ST_MakePoint($7, $8), 4326),
                'pendente'
            ) RETURNING id;
        `;
        
        const dbRes = await pool.query(query, [id_passageiro, km, min, preco, lonOrig, latOrig, lonDest, latDest]);
        const novaCorrida = dbRes.rows[0];

        // 3. Alerta Socket
        if(io) {
            io.to('motoristas_disponiveis').emit('alerta_corrida', {
                id_corrida: novaCorrida.id,
                valor: preco,
                distancia: `${km.toFixed(1)} km`,
                tempo: `${min.toFixed(0)} min`,
                geometria: rota.geometry
            });
        }

        console.log(`✅ Sucesso! Corrida #${novaCorrida.id} criada. Valor: R$ ${preco}`);

        res.json({ //Davidson esteve aqui
            sucesso: true, 
            id_corrida: novaCorrida.id, 
            status: 'buscando_moto',
            valor: preco, // <--- MOSTRA O VALOR DA CORRIDA
            distancia: `${km.toFixed(1)} km`,
            tempo: `${min.toFixed(0)} min`
        });

    } catch (error) {
        // Isso vai mostrar o erro real no log do servidor em vez de só explodir
        console.error("🚨 ERRO CRÍTICO NO BACKEND:", error.message);
        if(error.response) console.error("Detalhes:", error.response.data);
        
        res.status(500).json({ erro: 'Erro interno ao processar corrida: ' + error.message });
    }
});

// ========================================================
// NOVA ROTA: MOTORISTA ACEITA A CORRIDA 🤝
// ========================================================
app.post('/api/aceitar-corrida', async (req, res) => {
    const { id_corrida, id_motorista } = req.body;

    if (!id_corrida || !id_motorista) {
        return res.status(400).json({ erro: 'Faltam dados (id_corrida, id_motorista)' });
    }

    try {
        const query = `
            UPDATE corridas 
            SET status = 'em_andamento', 
                id_motorista = $1,
                atualizado_em = NOW()
            WHERE id = $2 AND status = 'pendente'
            RETURNING *;
        `;
        
        const dbRes = await pool.query(query, [id_motorista, id_corrida]);

        if (dbRes.rowCount === 0) {
            return res.status(409).json({ erro: 'Corrida não disponível ou já aceita.' });
        }

        const corridaAtualizada = dbRes.rows[0];
        console.log(`✅ Corrida #${id_corrida} aceita pelo motorista ${id_motorista}`);

        if(io) {
            io.emit('status_corrida', {
                tipo: 'ACEITA',
                id_corrida: id_corrida,
                id_motorista: id_motorista,
                status: 'em_andamento',
                msg: 'Motorista a caminho!'
            });
        }

        // Retornamos apenas o que temos agora (a corrida atualizada)
        res.json({ 
            sucesso: true, 
            status: 'em_andamento', 
            corrida: corridaAtualizada 
        });

    } catch (error) {
        console.error("Erro ao aceitar corrida:", error);
        res.status(500).json({ erro: 'Erro interno' });
    }
});

// ========================================================
// AUTENTICAÇÃO: CADASTRO E LOGIN 🔐
// ========================================================

// 1. CADASTRAR USUÁRIO (Cria senha criptografada)
app.post('/api/cadastrar', async (req, res) => {
    const { nome, email, senha, tipo, telefone } = req.body; // tipo = 'motorista' ou 'passageiro'

    if (!nome || !email || !senha || !tipo) {
        return res.status(400).json({ erro: 'Preencha todos os campos.' });
    }

    try {
        // Criptografar a senha (Hash)
        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(senha, salt);

        const query = `
            INSERT INTO usuarios (nome, email, senha_hash, tipo, telefone)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, nome, email, tipo;
        `;
        
        const dbRes = await pool.query(query, [nome, email, senhaHash, tipo, telefone]);
        
        res.json({ sucesso: true, usuario: dbRes.rows[0] });

    } catch (error) {
        console.error("Erro cadastro:", error);
        if (error.code === '23505') { // Código do Postgres para "Email duplicado"
            return res.status(409).json({ erro: 'Email já cadastrado.' });
        }
        res.status(500).json({ erro: 'Erro interno.' });
    }
});

// 2. LOGIN (Verifica senha e gera Token JWT)
app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;

    try {
        // Busca o usuário pelo email
        const userQuery = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        
        if (userQuery.rowCount === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado.' });
        }

        const usuario = userQuery.rows[0];

        // Compara a senha enviada com a senha criptografada no banco
        const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);

        if (!senhaValida) {
            // Se a senha antiga do banco for texto puro (ex: seeds), isso falha.
            // Para produção, sempre use bcrypt.
            return res.status(401).json({ erro: 'Senha incorreta.' });
        }

        // Gera o Token JWT (O "Crachá")
        // Esse token expira em 24 horas
        const token = jwt.sign(
            { id: usuario.id, tipo: usuario.tipo, nome: usuario.nome },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log(`🔑 Login realizado: ${usuario.email} (${usuario.tipo})`);

        res.json({
            sucesso: true,
            token: token,
            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                tipo: usuario.tipo
            }
        });

    } catch (error) {
        console.error("Erro login:", error);
        res.status(500).json({ erro: 'Erro interno no login.' });
    }
});

// ========================================================
// --- MIDDLEWARE DE PROTEÇÃO 👮‍♂️ ---
// ========================================================
function autenticarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    // O token vem assim: "Bearer eyJhbGc..."
    const token = authHeader && authHeader.split(' ')[1]; 

    if (!token) return res.status(401).json({ erro: 'Acesso negado. Faça login.' });

    jwt.verify(token, process.env.JWT_SECRET, (err, usuario) => {
        if (err) return res.status(403).json({ erro: 'Token inválido ou expirado.' });
        
        req.usuario = usuario; // Salva os dados do user na requisição
        next(); // Pode passar!
    });
}

// ========================================================
// NOVA ROTA: FINALIZAR CORRIDA 🏁
// ========================================================
app.post('/api/finalizar-corrida', async (req, res) => {
    const { id_corrida } = req.body;

    if (!id_corrida) return res.status(400).json({ erro: 'ID obrigatório' });

    try {
        const query = `
            UPDATE corridas 
            SET status = 'finalizada', 
                finalizado_em = NOW()
            WHERE id = $1
            RETURNING *;
        `;
        
        const dbRes = await pool.query(query, [id_corrida]);

        if (dbRes.rowCount === 0) {
            return res.status(404).json({ erro: 'Corrida não encontrada.' });
        }

        console.log(`🏁 Corrida #${id_corrida} finalizada.`);

        if(io) {
            io.emit('status_corrida', {
                tipo: 'FINALIZADA',
                id_corrida: id_corrida,
                status: 'finalizada',
                msg: 'Corrida finalizada!'
            });
        }

        res.json({ sucesso: true });

    } catch (error) {
        console.error("Erro finalizar:", error);
        res.status(500).json({ erro: 'Erro interno' });
    }
});

// ========================================================
// NOVA ROTA: HISTÓRICO DE CORRIDAS 📜
// ========================================================
app.get('/api/corridas/:usuario_id', async (req, res) => {
    const { usuario_id } = req.params;

    try {
        // Busca corridas onde o usuário foi passageiro OU motorista
        // Ordena da mais recente para a mais antiga
        const query = `
            SELECT id, origem_texto, destino_texto, valor_total, status, criado_em, distancia_km 
            FROM corridas 
            WHERE id_passageiro = $1 OR id_motorista = $1
            ORDER BY id DESC
            LIMIT 20;
        `;
        
        const dbRes = await pool.query(query, [usuario_id]);
        
        res.json({ sucesso: true, historico: dbRes.rows });

    } catch (error) {
        console.error("Erro histórico:", error);
        res.status(500).json({ erro: 'Erro ao buscar histórico' });
    }
});

// ATENÇÃO: Mudou de 'app.listen' para 'server.listen'
server.listen(PORTA_API, () => {
    console.log(`🚀 TripShare Backend rodando na porta ${PORTA_API}`);
});
// Código desenvolvido por Davidson. Inicializado em 28/11/2025.