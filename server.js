require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

// Socket.IO
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- Redis Adapter solo en producción ---
if (process.env.NODE_ENV === 'production' && process.env.REDIS_URL) {
    const { createClient } = require('redis');
    const { createAdapter } = require('@socket.io/redis-adapter');

    const pubClient = createClient({ url: process.env.REDIS_URL });
    const subClient = pubClient.duplicate();

    Promise.all([pubClient.connect(), subClient.connect()])
        .then(() => {
            io.adapter(createAdapter(pubClient, subClient));
            console.log('Redis Adapter conectado: escalado habilitado.');
        })
        .catch(err => {
            console.error('ERROR Redis:', err.message);
        });
} else {
    console.log("Modo desarrollo: Redis deshabilitado, Socket.IO en instancia única.");
}

// --- Variables de estado ---
let preguntaActiva = null;
let respuestas = []; // memoria temporal

// --- Lógica Socket.IO ---
io.on('connection', socket => {
  console.log('Cliente conectado:', socket.id);

  if (preguntaActiva !== null) {
    socket.emit('preguntaActiva', { id: preguntaActiva });
  }

  socket.on('adminAction', data => {
    const { action, data: payload } = data;
    let broadcastEvent = '';
    let broadcastPayload = {};

    switch(action) {
        case 'mostrarPregunta':
            preguntaActiva = payload;
            broadcastEvent = 'preguntaActiva';
            broadcastPayload = { id: payload, estado: 'activa' };
            break;
        case 'destacarRespuesta':
            broadcastEvent = 'estadoJuego';
            broadcastPayload = { status: 'respuestaMostrada', respuestaCorrecta: payload };
            break;
        case 'irAInicio':
            preguntaActiva = null;
            broadcastEvent = 'estadoJuego';
            broadcastPayload = { status: 'inicio' };
            break;
        case 'pantallaRanking':
            broadcastEvent = 'pantallaPrincipal';
            broadcastPayload = { view: 'ranking' };
            break;
        case 'mostrarRanking':
            broadcastEvent = 'estadoJuego';
            broadcastPayload = { status: 'ganadoresMostrados' };
            break;
        case 'limpiarRespuestas':
            respuestas = [];
            console.log('Respuestas limpiadas.');
            break;
        default: break;
    }

    if (broadcastEvent) {
        io.emit(broadcastEvent, broadcastPayload);
    }

    socket.emit('actionConfirmed', { action, success: !!broadcastEvent, event: broadcastEvent });
  });

  socket.on('respuesta', data => {
    if (preguntaActiva !== null) {
        respuestas.push({ ...data, tiempo: Date.now() });
        socket.emit('respuestaOk');
    } else {
        socket.emit('error', { msg: 'No hay pregunta activa.' });
    }
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// --- Endpoints ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'front-temp.html'));
});

app.get('/test', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'front-trivia.html'));
});

app.get('/panel', (req, res) => {
  res.sendFile(path.join(__dirname, 'panel.html'));
});

app.get('/admin/respuestas', (req, res) => res.json(respuestas));

// --- Test DB (PostgreSQL) ---
const pool = require('./db');
app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM usuarios ORDER BY id DESC LIMIT 200');
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('Error /test-db:', err);
    res.json({ ok: false, error: err.message });
  }
});

// --- ENDPOINT: Últimas 200 Participaciones ---
app.get('/test-db-200', async (req, res) => {
  try {
    // Consulta SQL para obtener las 200 respuestas más recientes.
    // ORDER BY id DESC asegura que las más nuevas aparezcan primero.
    const result = await pool.query(
      'SELECT id, dni_jugador, id_pregunta, respuesta_elegida, es_correcta, tiempo_respuesta FROM respuestas ORDER BY id DESC LIMIT 200'
    );
    
    // Devolver un objeto JSON con ok: true y los datos.
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    // Si hay un error de conexión o de SQL, registrarlo y devolverlo al frontend.
    console.error("Error en /test-db-200:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});




// --- Archivos estáticos ---
app.use(express.static('public'));

// --- Iniciar servidor ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor trivia activo en puerto ${PORT}`);
});
