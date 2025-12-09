let client;

if (process.env.NODE_ENV === 'production') {
    // --- Producción: Redis real ---
    const { createClient } = require('redis');

    client = createClient({
        url: process.env.REDIS_URL
    });

    client.connect()
        .then(() => console.log("Redis conectado"))
        .catch(err => console.error("Redis ERROR:", err));

} else {
    // --- Desarrollo: Redis desactivado / modo mock ---
    console.log("Redis desactivado en desarrollo (usando mock)");

    client = {
        async get(key) {
            return null;
        },
        async set(key, value) {
            // simulamos respuesta de Redis
            return "OK";
        },
        async del(key) {
            return 1;
        }
    };
}

module.exports = client;
