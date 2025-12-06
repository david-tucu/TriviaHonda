const express = require('express');
const http = require('http');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Servidor HTTP
const server = http.createServer(app);

// Socket.IO
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

// Variables en memoria (solo pruebas)
let preguntaActiva = null;
let respuestas = [];  // { nombre, dni, respuesta, tiempo }

// Cuando un móvil se conecta
io.on('connection', socket => {
  console.log('Nuevo móvil conectado:', socket.id);

  // Si ya hay una pregunta activa, la enviamos
  if (preguntaActiva !== null) {
    socket.emit('preguntaActiva', { id: preguntaActiva });
  }

  // Recibir respuesta desde el móvil
  socket.on('respuesta', data => {
    console.log('Respuesta recibida:', data);

    respuestas.push({
      nombre: data.nombre,
      dni: data.dni,
      respuesta: data.respuesta,
      tiempo: Date.now()
    });

    // Enviar confirmación al móvil
    socket.emit('respuestaOk');
  });

  socket.on('disconnect', () => {
    console.log('Móvil desconectado:', socket.id);
  });
});

// -----------------------------
// ENDPOINTS ADMIN
// -----------------------------

// PRINCIPAL:
app.get('/', (req, res) => {
  //res.sendFile(__dirname + '/public/front-trivia.html');
  res.sendFile(__dirname + '/public/front-temp.html');
});

// Temporal para prueba:
app.get('/test', (req, res) => {
  res.sendFile(__dirname + '/public/front-trivia.html');
});


// Servir el panel en /panel
app.get("/panel", (req, res) => {
  res.sendFile(__dirname + "/panel.html");
});

// Cambiar pregunta desde el panel admin
app.post('/admin/pregunta', (req, res) => {
  const { id } = req.body;

  preguntaActiva = id;

  // Broadcast a todos los móviles
  io.emit('preguntaActiva', { id });

  res.json({ ok: true, preguntaActiva });
});

// Ver respuestas
app.get('/admin/respuestas', (req, res) => {
  res.json(respuestas);
});

// Servir archivos estáticos
app.use(express.static('public'));



// Iniciar servidor
server.listen(3000, () => {
  console.log('Servidor trivia activo en http://localhost:3000');
});
