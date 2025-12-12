let client;
let mockStore = {};

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
        //  MODIFICADO: Devuelve el valor del mockStore
        async get(key) {
            return mockStore[key] || null;
        },
        //  MODIFICADO: Guarda el valor en el mockStore (ignorando TTL por simplicidad)
        async set(key, value, options) {
            mockStore[key] = value;
            return "OK";
        },
        async del(key) {
            delete mockStore[key]; // Simula la eliminación
            return 1;
        },
        //  NUEVO: Función para ver el store (útil para debugging)
        async debugStore() {
            return mockStore;
        }
    };
}

module.exports = client;
