require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');



// Socket.IO
const { Server } = require('socket.io');

// CARGAR PREGUNTAS (Asegúrate de que este archivo exista y use module.exports)
const ALL_QUESTIONS = require('./questions');

//PAR CALCULAR EL PUNTAJE DE CADA PREGUNTA:
const TIEMPO_MAXIMO_MS = 20000; // 20 segundos en milisegundos


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
let tiempoInicioPregunta = null; // para calcular la diferencia al guardar

// --- Lógica Socket.IO ---
io.on('connection', socket => {
  console.log('Cliente conectado:', socket.id);

  // LATE JOIN: Si hay pregunta activa, enviarla al nuevo cliente (sin la respuesta)
  if (preguntaActivaId !== null) {
    const pregunta = getPreguntaPorId(preguntaActivaId);
    if (pregunta) {
      console.log("Late Joing: " + pregunta);
      socket.emit('preguntaActiva', getPreguntaSinRespuesta(pregunta));
      // 💡 Al hacer Late Join, también notificamos que la votación está activa.
      socket.emit('estadoJuego', { status: 'aResponder' });
    }
  }

  socket.on('adminAction', async (data) => {

    console.log(data);

    //FIX: Desestructurar la propiedad 'data' y renombrarla a 'payload'
    const { action, data: payload } = data; // payload puede ser el ID de la pregunta (1, 2, 3, 4)

    let broadcastEvent = null;
    let broadcastPayload = {};

    console.log(`[ADMIN] Acción recibida: ${action} con payload: ${payload}`);

    switch (action) {
      case 'mostrarPregunta':
        
        preguntaActivaId = payload;
        const pregunta = getPreguntaPorId(preguntaActivaId);

        if (pregunta) {
          tiempoInicioPregunta = Date.now();
          // 1. Emitir a la PANTALLA
          broadcastEvent = 'mostrar_pregunta'; // ⬅️ Evento que pantalla.html escucha para renderQuestion
          // (La pantalla puede hacer fetch o esperar la data. Por ahora, asumiremos que
          // el server envía la data de la pregunta para evitar un fetch extra)
          broadcastPayload = { ...getPreguntaSinRespuesta(pregunta), respuestaCorrecta: pregunta.correcta };

          // 2. Emitir al MÓVIL (estadoJuego)
          io.emit('estadoJuego', { status: 'aResponder', pregunta: broadcastPayload });

          socket.emit('actionConfirmed', { action, success: true });
        } else {
          console.error(`Error: Pregunta con ID ${preguntaActivaId} no encontrada.`);
          socket.emit('error', { msg: 'Pregunta no encontrada.' });
          return;
        }
        break;

      case 'destacarRespuesta':
        // 1. Emitir a la PANTALLA
        broadcastEvent = 'revelar_respuesta'; // ⬅️ Evento que pantalla.html escucha para toggleRespuestaCorrecta
        broadcastPayload = {};

        // 2. Emitir al MÓVIL (estadoJuego)
        const respuestaCorrecta = getPreguntaPorId(preguntaActivaId)?.correcta;
        io.emit('estadoJuego', { status: 'respuestaMostrada', respuestaCorrecta: respuestaCorrecta });

        socket.emit('actionConfirmed', { action, success: true });
        break;

      case 'irAInicio':
        preguntaActivaId = null;
        // 1. Emitir a la PANTALLA
        broadcastEvent = 'ir_a_inicio'; // ⬅️ Evento que pantalla.html escucha para switchView('portada')
        broadcastPayload = {};

        // 2. Emitir al MÓVIL (estadoJuego)
        io.emit('estadoJuego', { status: 'inicio' });

        socket.emit('actionConfirmed', { action, success: true });
        break;

      case 'pantallaRanking':
        // 1. Emitir a la PANTALLA
        broadcastEvent = 'mostrar_ranking_procesando'; // ⬅️ Evento que pantalla.html escucha para switchView('placaRanking')
        broadcastPayload = {};

        socket.emit('actionConfirmed', { action, success: true });
        break;

      case 'mostrarRanking':
        try {
          const rankingData = await getRanking(pool, 17);
          // 1. Emitir a la PANTALLA
          broadcastEvent = 'revelar_ranking'; // ⬅️ Evento que pantalla.html escucha para renderRanking
          broadcastPayload = { ranking: rankingData };

          // 2. Emitir al MÓVIL (estadoJuego)
          io.emit('estadoJuego', { status: 'ganadoresMostrados' });

          socket.emit('actionConfirmed', { action, success: true });
        } catch (error) {
          console.error('Error al calcular/enviar ranking:', error);
          socket.emit('error', { msg: 'Fallo al obtener el ranking.' });
          return;
        }
        break;

      case 'limpiarRespuestas':
        // Lógica para limpiar las respuestas (si aplica)
        // Esto solo es una acción interna del server, no emite a frontend
        respuestas = [];
        console.log('Respuestas limpiadas.');
        socket.emit('actionConfirmed', { action, success: true });
        return; // No emitir broadcast

      default:
        console.warn(`Acción desconocida: ${action}`);
        socket.emit('actionConfirmed', { action, success: false });
        return; // No emitir broadcast
    }

    if (broadcastEvent) {
      // Broadcast a todas las pantallas (pantalla.html)
      io.emit(broadcastEvent, broadcastPayload);
    }
  });


  // Asegúrate de que tu 'pool' de PostgreSQL esté importado correctamente

  socket.on('respuesta', async (data) => {
    const { dni, id_pregunta, respuesta, nombre } = data;

    // VALIDACIÓN CRUCIAL: Asegurarse de que el tiempo de inicio existe
    if (tiempoInicioPregunta === null) {
      socket.emit('error', { msg: 'La pregunta aún no ha comenzado o ya finalizó.' });
      return;
    }

    // CALCULO DE LA LATENCIA: Tiempo actual - Tiempo de inicio de la pregunta
    const latencia = Date.now() - tiempoInicioPregunta;

    if (preguntaActivaId === null || id_pregunta !== preguntaActivaId) {
      socket.emit('error', { msg: 'No hay pregunta activa o ID incorrecto.' });
      return;
    }

    // 1. VALIDAR SI EL DNI YA VOTÓ ESTA PREGUNTA (en memoria temporal o DB)
    // Para simplificar, asumimos que la validación en memoria (respuestas = []) sigue siendo válida
    // para la pregunta activa. Si usas escalabilidad (Redis), DEBES validar contra la DB.

    /* TODO: verifica si conviene validar o no si ya votó en memoria
    const yaVotoEnDB = await pool.query(
      'SELECT id FROM respuestas WHERE dni_jugador = $1 AND id_pregunta = $2',
      [dni, id_pregunta]
    );

    if (yaVotoEnDB.rows.length > 0) {
      socket.emit('error', { msg: 'DNI ya votó esta pregunta' });
      return;
    }
    */

    // 2. DETERMINAR SI LA RESPUESTA ES CORRECTA (Lógica que ya tienes)
    const esCorrecta = esRespuestaCorrecta(id_pregunta, respuesta);
    const puntajeObtenido = esCorrecta ? 1 : 0; // Asumimos 1 punto por respuesta correcta

    // 3. REGISTRAR O ACTUALIZAR USUARIO (upsert)
    try {
      //  Solo INSERTAR o ACTUALIZAR el NOMBRE
      await pool.query(
        `INSERT INTO usuarios (dni, nombre)
         VALUES ($1, $2) 
         ON CONFLICT (dni) DO UPDATE
         SET nombre = EXCLUDED.nombre;`, // Solo actualizamos el nombre
        [dni, nombre]
      );
    } catch (err) {
      console.error('Error al asegurar el registro de usuario:', err);
    }

    // 4. GUARDAR RESPUESTA EN LA BASE DE DATOS (UPSERT)
    try {
      // 🔑 Consulta con ON CONFLICT DO UPDATE
      await pool.query(
        `INSERT INTO respuestas (dni_jugador, id_pregunta, respuesta_elegida, es_correcta, tiempo_respuesta)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (dni_jugador, id_pregunta) DO UPDATE
         SET 
             respuesta_elegida = EXCLUDED.respuesta_elegida,
             es_correcta = EXCLUDED.es_correcta,
             tiempo_respuesta = EXCLUDED.tiempo_respuesta;`,
        [dni, id_pregunta, respuesta, esCorrecta, latencia]
      );

      console.log(`Respuesta registrada/actualizada para ${dni} en la DB.`);

      // 5. RESPUESTA AL CLIENTE
      socket.emit('respuestaOk');

    } catch (err) {
      // Ya no debería haber errores 23505 (duplicado), solo errores graves
      console.error('Error al guardar/actualizar respuesta en DB:', err);
      socket.emit('error', { msg: 'Error interno al guardar la respuesta.' });
    }

    // 6. GUARDAR EN MEMORIA (Opcional: solo si mantienes la variable 'respuestas = []' temporal)
    respuestas.push({
      dni,
      nombre,
      id_pregunta,
      respuesta_elegida: respuesta,
      es_correcta: esCorrecta,
      tiempo_respuesta: latencia,
    });

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

app.get('/pantalla', (req, res) => {
  res.sendFile(path.join(__dirname, 'pulic', 'pantalla.html'));
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

// --- ENDPOINT: Últimas 500 acciones ---
app.get('/test-db-500', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, dni_jugador, id_pregunta, respuesta_elegida, es_correcta, tiempo_respuesta FROM respuestas ORDER BY id DESC LIMIT 500'
    );
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error("Error en /test-db-500:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- ENDPOINT: Ranking General con Cálculo de Velocidad ---
app.get('/ver-rank', async (req, res) => {
  try {
    // 🔑 USAMOS la función getRanking y le pasamos el objeto 'pool'
    const rankingData = await getRanking(pool, 17); // 100 es un ejemplo de límite

    res.json({
      ok: true,
      data: rankingData
    });

  } catch (err) {
    console.error("Error en /ver-rank:", err);
    res.status(500).json({
      ok: false,
      error: 'Error interno del servidor al calcular el ranking.'
    });
  }
});


// --- ENDPOINT: Obtener data de Pregunta para Pantalla ---
app.get('/api/pregunta/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    return res.status(400).json({ ok: false, error: 'ID de pregunta inválido.' });
  }

  const pregunta = getPreguntaPorId(id);

  if (pregunta) {
    // 🔑 Incluimos la respuesta correcta para uso administrativo/de pantalla
    const preguntaConRespuesta = {
      ...pregunta,
      respuestaCorrecta: pregunta.correcta // Exponemos la clave 'correcta' con otro nombre
    };
    // Ya no usamos getPreguntaSinRespuesta aquí.
    res.json({ ok: true, data: preguntaConRespuesta });
  } else {
    res.status(404).json({ ok: false, error: 'Pregunta no encontrada.' });
  }
});



// Asegúrate de que esta función está disponible en tu server.js o archivo de rutas
async function getRanking(pool, limit_ = 17) {

  const limitValue = parseInt(limit_, 10) || 17;

  try {
    const rankingResult = await pool.query(`
            WITH ultima_respuesta AS (
                SELECT
                    dni_jugador,
                    id_pregunta,
                    es_correcta,
                    tiempo_respuesta,
                    ROW_NUMBER() OVER (
                        PARTITION BY dni_jugador, id_pregunta
                        ORDER BY id DESC
                    ) as rn
                FROM 
                    respuestas
            ),
            respuestas_validas AS (
                SELECT
                    dni_jugador,
                    es_correcta,
                    tiempo_respuesta
                FROM
                    ultima_respuesta
                WHERE
                    rn = 1
            ),
            -- 1. CTE para calcular el puntaje y filtrar (Solo usuarios con puntaje > 0)
            puntaje_calculado AS (
                SELECT
                    u.dni,
                    u.nombre,
                    COALESCE(SUM(
                        CASE 
                            WHEN r.es_correcta = TRUE THEN 
                                (2000) + 
                                TRUNC((CAST(${TIEMPO_MAXIMO_MS} AS NUMERIC) - r.tiempo_respuesta) / 40.0) 
                            ELSE 
                                0 
                        END
                    ), 0)::BIGINT AS puntaje_final
                FROM 
                    usuarios u
                LEFT JOIN 
                    respuestas_validas r ON u.dni = r.dni_jugador
                
                -- Excluir usuarios con borrado lógico
                WHERE 
                    u.borrado = FALSE

                GROUP BY 
                    u.dni, u.nombre
                HAVING 
                    COALESCE(SUM(
                        CASE WHEN r.es_correcta = TRUE THEN 1 ELSE 0 END
                    ), 0) > 0 --  FILTRO CLAVE: Solo si tienen al menos 1 respuesta correcta
            )
            -- 2. SELECT final para aplicar la posición (RANK)
            SELECT
                RANK() OVER (ORDER BY puntaje_final DESC) AS posicion,
                dni,
                nombre,
                puntaje_final
            FROM
                puntaje_calculado
            ORDER BY 
                puntaje_final DESC
            LIMIT $1;
        `, [limitValue]);

    return rankingResult.rows;

  } catch (err) {
    console.error('Error al generar el ranking con cálculo de velocidad:', err);
    throw new Error('No se pudo generar el ranking.');
  }
}

// --- Archivos estáticos ---
app.use(express.static('public'));

// --- Iniciar servidor ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor trivia activo en puerto ${PORT}`);
});