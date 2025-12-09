const { createClient } = require('redis');

const client = createClient({
    url: process.env.REDIS_URL
});

client.connect()
  .then(() => console.log("Redis conectado"))
  .catch(err => console.error("Redis ERROR:", err));

module.exports = client;
