const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

// --- 🔑 Importaciones REDIS/VALKEY ---
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
// ----------------------------------------

const app = express();
// Configuración de Middlewares
app.use(cors()); // Permite solicitudes CORS (ajustar origin en producción si es necesario)
app.use(express.json()); // Permite parsear cuerpos JSON

// Servidor HTTP
const server = http.createServer(app);

// Socket.IO
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: "*", // Permite cualquier origen para WebSockets (ajustar en producción)
    methods: ["GET", "POST"]
  }
});

// --- INTEGRACIÓN DE REDIS (VALKEY) PARA ESCALADO ---
require('dotenv').config();
const REDIS_URL = process.env.REDIS_URL;

if (REDIS_URL) {
    const pubClient = createClient({ url: REDIS_URL });
    const subClient = pubClient.duplicate();

    Promise.all([pubClient.connect(), subClient.connect()])
        .then(() => {
            io.adapter(createAdapter(pubClient, subClient));
            console.log('Redis Adapter (Valkey) conectado exitosamente. Escalado habilitado.');
        })
        .catch(err => {
            console.error('ERROR al conectar con Redis/Valkey:', err.message);
        });
} else {
    console.warn("ADVERTENCIA: REDIS_URL no definida. Socket.IO funcionará solo en una instancia (sin escalado).");
}
// ----------------------------------------------------

const pool = require('./db');



// --- Variables de Estado (MEMORIA - Temporal para pruebas) ---
let preguntaActiva = null; 
let respuestas = []; // { nombre, dni, respuesta, tiempo }
// -----------------------------------------------------------

// --- LÓGICA SOCKET.IO ---
io.on('connection', socket => {
  console.log('Nuevo cliente conectado:', socket.id);

  // Si ya hay una pregunta activa, la enviamos al nuevo cliente
  if (preguntaActiva !== null) {
    socket.emit('preguntaActiva', { id: preguntaActiva });
  }

  // Escuchar todas las acciones del panel administrador
  socket.on('adminAction', data => {
    const { action, data: payloadData } = data;
    console.log(`[ADMIN] Acción recibida: ${action}`, payloadData || '');

    let success = true;
    let broadcastEvent = '';
    let broadcastPayload = {};

    switch (action) {
        case 'mostrarPregunta':
            preguntaActiva = payloadData; 
            broadcastEvent = 'preguntaActiva';
            broadcastPayload = { id: payloadData, estado: 'activa' };
            break;

        case 'destacarRespuesta':
            // Lógica: Se supone que la respuesta ya se guardó y ahora se destaca.
            broadcastEvent = 'estadoJuego';
            broadcastPayload = { status: 'respuestaMostrada', respuestaCorrecta: payloadData };
            break;

        case 'irAInicio':
            preguntaActiva = null; 
            broadcastEvent = 'estadoJuego';
            broadcastPayload = { status: 'inicio' }; 
            break;
            
        case 'pantallaRanking':
            // Lógica: Indica a la pantalla principal (si es un cliente distinto) que cambie de vista.
            broadcastEvent = 'pantallaPrincipal';
            broadcastPayload = { view: 'ranking' };
            break;

        case 'mostrarRanking':
            // Lógica: Muestra ganadores/ranking final. Deshabilita móviles.
            broadcastEvent = 'estadoJuego';
            broadcastPayload = { status: 'ganadoresMostrados' };
            break;

        case 'limpiarRespuestas':
            // Lógica de limpieza (debe usar Redis/BD en producción)
            respuestas = [];
            console.log('RESPUESTAS LIMPIADAS.');
            break;

        default:
            success = false;
            break;
    }
    
    // Si se definió un evento de broadcast, enviarlo a todos los clientes (móviles y pantalla)
    if (broadcastEvent) {
        io.emit(broadcastEvent, broadcastPayload);
    }

    // Enviar confirmación de vuelta al panel administrador
    socket.emit('actionConfirmed', { action: action, success: success, event: broadcastEvent });
  });

  // Recibir respuesta desde el móvil
  socket.on('respuesta', data => {
    // Si la pregunta está activa, registrar respuesta
    if (preguntaActiva !== null) {
        console.log('Respuesta recibida:', data);
        respuestas.push({
            nombre: data.nombre,
            dni: data.dni,
            respuesta: data.respuesta,
            tiempo: Date.now()
        });
        socket.emit('respuestaOk');
    } else {
        socket.emit('error', { msg: 'No hay pregunta activa.' });
    }
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// --- ENDPOINTS HTTP ---

// PRINCIPAL:
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'front-temp.html'));
});

// Temporal para prueba:
app.get('/test', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'front-trivia.html'));
});

// Servir el panel en /panel (Se asume que panel.html está en la raíz)
// Si mueves panel.html a /views, ajusta esta línea.
app.get("/panel", (req, res) => {
  res.sendFile(path.join(__dirname, "panel.html")); 
});

// Ver respuestas (DEBUGGING)
app.get('/admin/respuestas', (req, res) => {
  res.json(respuestas);
});


// --- TEST DB ---
app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM usuarios ORDER BY id ASC'); 
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error("Error en /test-db:", err);
    res.json({ ok: false, error: err.message });
  }
});



// Servir archivos estáticos (va al final de las rutas GET)
app.use(express.static('public'));


// --- 🚀 INICIAR SERVIDOR ---

// CORRECCIÓN FINAL: Usar la variable de entorno PORT de Render
const PORT = process.env.PORT || 3000; 

server.listen(PORT, () => {
  console.log(`Servidor trivia activo en el puerto ${PORT}`);
});