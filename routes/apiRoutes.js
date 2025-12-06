const express = require('express');
const router = express.Router();

router.get('/preguntas', (req, res) => {
  res.json([
    { id: 1, pregunta: "Ejemplo de pregunta 1" },
    { id: 2, pregunta: "Ejemplo de pregunta 2" }
  ]);
});

module.exports = router;
