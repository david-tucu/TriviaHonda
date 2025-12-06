const express = require('express');
const cors = require('cors');
const { PORT } = require('./config/config');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Rutas
app.get('/', (req, res) => {
  res.send('API Trivia Honda');
});

// Importamos rutas reales
app.use('/api', require('./routes/apiRoutes'));

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

