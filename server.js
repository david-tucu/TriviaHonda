require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

// Socket.IO
const { Server } = require('socket.io');

// 🔑 CARGAR PREGUNTAS (Asegúrate de que este archivo exista y use module.exports)
const ALL_QUESTIONS = require('./questions'); 

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


// --- FUNCIONES DE UTILIDAD ---

/** Obtiene una pregunta por su ID. */
const getPreguntaPorId = (id) => {
    // Busca por ID, asegurando la comparación con el mismo tipo (parseInt)
    return ALL_QUESTIONS.find(q => q.id === parseInt(id)); 
};

/**
 * Filtra la pregunta para NO incluir la respuesta correcta antes de enviarla al cliente.
 * @param {object} pregunta
 * @returns {object} La pregunta sin la propiedad 'correcta'.
 */
const getPreguntaSinRespuesta = (pregunta) => {
    if (!pregunta) return null;
    // Usamos destructuring para extraer 'correcta' y capturar el resto en 'preguntaLimpia'
    const { correcta, ...preguntaLimpia } = pregunta; 
    return preguntaLimpia;
};

/** Verifica si la respuesta elegida es la correcta. */
const esRespuestaCorrecta = (id, respuesta) => {
    const pregunta = getPreguntaPorId(id);
    return pregunta && pregunta.correcta === respuesta;
};


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
let preguntaActivaId = null; // ID de la pregunta activa
let respuestas = []; // memoria temporal de respuestas

// --- Lógica Socket.IO ---
io.on('connection', socket => {
  console.log('Cliente conectado:', socket.id);

  // LATE JOIN: Si hay pregunta activa, enviarla al nuevo cliente (sin la respuesta)
  if (preguntaActivaId !== null) {
    const pregunta = getPreguntaPorId(preguntaActivaId);
    if (pregunta) {
      socket.emit('preguntaActiva', getPreguntaSinRespuesta(pregunta));
    }
  }

  socket.on('adminAction', data => {
    const { action, data: payload } = data;
    let broadcastEvent = '';
    let broadcastPayload = {};

    switch(action) {
        case 'mostrarPregunta':
            preguntaActivaId = payload; // payload debe ser el ID de la pregunta (e.g., 1)
            const pregunta = getPreguntaPorId(preguntaActivaId);

            if (pregunta) {
                broadcastEvent = 'preguntaActiva';
                // ENVIAR LA PREGUNTA COMPLETA (PERO LIMPIA)
                broadcastPayload = getPreguntaSinRespuesta(pregunta); 
            } else {
                console.error(`Error: Pregunta con ID ${preguntaActivaId} no encontrada.`);
                socket.emit('error', { msg: 'Pregunta no encontrada.' });
                return; // Salir sin emitir
            }
            break;

        case 'destacarRespuesta':
            // Esta acción usa la pregunta activa actual para obtener la respuesta correcta
            const pregActual = getPreguntaPorId(preguntaActivaId); 
            
            broadcastEvent = 'estadoJuego';
            broadcastPayload = { 
                status: 'respuestaMostrada', 
                respuestaCorrecta: pregActual ? pregActual.correcta : null 
            };
            break;

        case 'irAInicio':
            preguntaActivaId = null; // Limpiar la pregunta activa
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
    const { dni, id_pregunta, respuesta, nombre } = data;

    if (preguntaActivaId === null || id_pregunta !== preguntaActivaId) {
        socket.emit('error', { msg: 'No hay pregunta activa o ID incorrecto.' });
        return;
    }

    // 1. VALIDAR SI EL DNI YA VOTÓ ESTA PREGUNTA
    const yaVoto = respuestas.some(r => 
        r.dni === dni && r.id_pregunta === id_pregunta
    );

    if (yaVoto) {
        socket.emit('error', { msg: 'DNI ya votó esta pregunta' });
        return;
    }

    // 2. DETERMINAR SI LA RESPUESTA ES CORRECTA
    const esCorrecta = esRespuestaCorrecta(id_pregunta, respuesta);

    // 3. GUARDAR RESPUESTA
    respuestas.push({ 
        dni, 
        nombre,
        id_pregunta, 
        respuesta_elegida: respuesta, 
        es_correcta: esCorrecta,
        tiempo_respuesta: Date.now(),
    });
    
    console.log(`Voto registrado: DNI ${dni}, Pregunta ${id_pregunta}, Respuesta ${respuesta}, Correcta: ${esCorrecta}`);

    socket.emit('respuestaOk');
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

// ENDPOINTS ADMIN
app.get('/admin/respuestas', (req, res) => res.json(respuestas));
app.get('/admin/preguntas', (req, res) => res.json(ALL_QUESTIONS));


// --- Test DB (PostgreSQL) ---
const pool = require('./db');
app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM usuarios ORDER BY id DESC LIMIT 200');
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('Error /test-db:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- ENDPOINT: Últimas 200 Participaciones ---
app.get('/test-db-200', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, dni_jugador, id_pregunta, respuesta_elegida, es_correcta, tiempo_respuesta FROM respuestas ORDER BY id DESC LIMIT 200'
    );
    res.json({ ok: true, data: result.rows });
  } catch (err) {
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