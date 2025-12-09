// --- VARIABLES GLOBALES DE ESTADO ---
let userData = {
    dni: null,
    nombre: null
};
let preguntaActual = null;
let yaVoto = false;

// Auto-detecta localhost o Render
const socket = io();
const userIconHtml = '<i class="bi bi-person-fill me-1"></i>';

// --- GESTIÓN DE MODAL Y VALIDACIÓN LOCAL ---

function checkLocalStorage() {
    const dni = localStorage.getItem('dni');
    const nombre = localStorage.getItem('nombre');
    const btnLogout = document.getElementById('btnLogout');

    if (dni && nombre) {
        userData.dni = dni;
        userData.nombre = nombre;
        document.getElementById('user-info').innerHTML = `${userIconHtml} ${nombre} (${dni})`;
        btnLogout.style.display = 'inline-block';

        // Si hay datos, nos conectamos. El mensaje de estado lo maneja el on('connect')
        socket.connect();
    } else {
        btnLogout.style.display = 'none';

        document.getElementById("main-message").textContent = "Ingresá tus datos para participar.";
        document.getElementById("spinner").classList.add('d-none'); // Asegurarse que esté oculto

        const modal = new bootstrap.Modal(document.getElementById('modalIngreso'), {});
        modal.show();
    }
}

// --- GESTIÓN DE SESIÓN ---

function cerrarSesion() {
    const confirmacion = confirm(
        "Seguro que querés cerrar la sesión?\n\nVas a perder tu DNI y Nombre en este dispositivo y podrías perder tu progreso en la trivia si está activa."
    );

    if (confirmacion) {
        // 1. Borrar datos de identidad
        localStorage.removeItem('dni');
        localStorage.removeItem('nombre');

        // Limpiar todos los indicadores de voto (voto_q_X)
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('voto_q_')) {
                localStorage.removeItem(key);
            }
        }

        // 2. Desconectar y reiniciar
        socket.disconnect();
        window.location.reload();
    }
}


function validarDNI(dni) {
    const cleanDNI = dni.trim().replace(/\D/g, '');
    return cleanDNI.length >= 8 && cleanDNI.length <= 10;
}

function validarNombre(nombre) {
    const cleanNombre = nombre.trim();
    if (cleanNombre.length === 0 || cleanNombre.length > 50) {
        return false;
    }
    // Valida que contenga al menos un carácter que NO sea un número.
    return /[^0-9]/.test(cleanNombre);
}

function guardarDatos() {

    // Desenfocar el botón para evitar que retenga el foco mientras el modal se cierra
    document.activeElement.blur();

    const inputDNI = document.getElementById('inputDNI').value;
    const inputNombre = document.getElementById('inputNombre').value;
    const dniError = document.getElementById('dniError');
    const nombreError = document.getElementById('nombreError');

    dniError.style.display = 'none';
    nombreError.style.display = 'none';

    if (!validarDNI(inputDNI)) {
        dniError.textContent = "El DNI no parece válido. Solo entre 8 y 10 dígitos numéricos.";
        dniError.style.display = 'block';
        return;
    }

    if (!validarNombre(inputNombre)) {
        nombreError.textContent = "Hay un error en este campo. Fijate que no esté vacío, que no sean solo números y que sean menos de 50 caracteres.";
        nombreError.style.display = 'block';
        return;
    }

    // Si la validación es exitosa:
    localStorage.setItem('dni', inputDNI.trim());
    localStorage.setItem('nombre', inputNombre.trim());
    userData.dni = inputDNI.trim();
    userData.nombre = inputNombre.trim();

    document.getElementById('user-info').innerHTML = `${userIconHtml} ${userData.nombre} (${userData.dni})`;
    document.getElementById('btnLogout').style.display = 'inline-block';

    const modal = bootstrap.Modal.getInstance(document.getElementById('modalIngreso'));
    modal.hide();

    // Si la conexión se inició, forzar la UI de espera
    document.getElementById("main-message").textContent = "Esperando próxima pregunta...";
    document.getElementById("spinner").classList.remove('d-none');


    socket.connect();
}


// --- GESTIÓN DE INTERFAZ ---

/** Dibuja los botones de respuesta y establece los listeners */
function renderQuestion(pregunta) {
    // 1. Lógica de inicialización
    preguntaActual = pregunta;
    yaVoto = false;
    document.getElementById("voto-status").textContent = "";
    document.getElementById("pregunta-texto").textContent = pregunta.texto_pregunta;

    // 🔑 2. OBTENER EL VOTO GUARDADO: Lee la clave de la opción (A, B, C, D)
    const votoClave = localStorage.getItem(`voto_q_${pregunta.id}`);

    // 3. Crear HTML de Opciones
    const opcionesContainer = document.getElementById("opciones-container");
    opcionesContainer.innerHTML = '';

    pregunta.opciones.forEach(opcion => {
        const btn = document.createElement('button');
        // 🔑 CAMBIO CLAVE: Usamos 'btn-outline-dark' y 'btn-opcion' como base para que coincida con disableOptions
        btn.className = 'btn btn-outline-dark btn-lg w-100 mb-2 btn-opcion';
        btn.setAttribute('data-opcion', opcion.clave);
        btn.textContent = `${opcion.clave}. ${opcion.texto}`;
        btn.onclick = () => enviarRespuesta(opcion.clave, btn);
        opcionesContainer.appendChild(btn);
    });


    document.getElementById("pregunta-area").style.display = "block";
    document.getElementById("spinner").classList.add('d-none');

    // 🔑 4. APLICAR ESTADO DE VOTO LOCAL Y DESTACAR
    if (votoClave) {
        yaVoto = true;
        disableOptions(null); // Deshabilita todos los botones

        document.getElementById("voto-status").textContent = "Tu voto ya está registrado para esta pregunta.";

        // Seleccionamos el botón usando el atributo data-opcion guardado
        const btnVotado = document.querySelector(`#opciones-container button[data-opcion="${votoClave}"]`);

        if (btnVotado) {
            // 🔑 APLICAR EL MISMO ESTILO QUE disableOptions APLICA AL VOTAR
            btnVotado.classList.remove('btn-outline-dark');
            btnVotado.classList.add('btn-secondary');
            // Opcional: Si querés que diga VOTADO: btnVotado.textContent += " (VOTADO)";
        }
    }
}


/** Desactiva todos los botones de respuesta después de votar */
function disableOptions(btnSeleccionado) {
    document.querySelectorAll('.btn-opcion').forEach(btn => {
        btn.disabled = true;
        if (btn === btnSeleccionado) {
            //  ESTOS ESTILOS SON LOS QUE DEBEN COINCIDIR CON renderQuestion
            btn.classList.remove('btn-outline-dark');
            btn.classList.add('btn-secondary');
            // Si quieres que el voto se destaque visualmente de todos los demás botones deshabilitados,
            // podrías usar btn.classList.add('btn-success') aquí.
            // Pero si el objetivo es que solo parezca deshabilitado:
            // btn.textContent += " (VOTADO)"; // Opcional, como en tu código original
        }
    });
}

/** Vuelve a la portada de espera */
function volverAportada(message) {
    preguntaActual = null;
    yaVoto = false;
    document.getElementById("pregunta-area").style.display = "none";
    document.getElementById("main-message").textContent = message || "Esperando próxima pregunta...";
    document.getElementById("spinner").classList.remove('d-none');
}


// --- COMUNICACIÓN CON EL SERVIDOR ---

function enviarRespuesta(opcion, btnSeleccionado) {
    if (!preguntaActual || yaVoto) {
        document.getElementById("voto-status").textContent = "Ya votaste en esta pregunta o la pregunta ha terminado.";
        return;
    }

    // Oculta el botón
    disableOptions(btnSeleccionado);
    yaVoto = true;

    // 🔑 1. CAMBIO: Guardar la CLAVE de la opción (A, B, C, D) en el localStorage
    localStorage.setItem(`voto_q_${preguntaActual.id}`, opcion);

    socket.emit("respuesta", {
        dni: userData.dni,
        nombre: userData.nombre,
        id_pregunta: preguntaActual.id,
        respuesta: opcion,
        tiempo: Date.now()
    });

    document.getElementById("voto-status").textContent = `Voto enviado: Opción ${opcion}. Esperando resultados...`;
}


// --- HANDLERS DE SOCKET.IO ---

socket.on("estadoJuego", (data) => {
    if (data.status === 'inicio' || data.status === 'ganadoresMostrados') {
        let message = (data.status === 'inicio') ?
            "Esperando indicaciones del moderador." :
            "";
        volverAportada(message);
    } else if (data.status === 'respuestaMostrada') {
        document.getElementById("voto-status").textContent = "¡Tiempo terminado! Revisando resultados...";
    } else if (data.status === 'aResponder') { // ⬅️ ¡NUEVO!
        document.getElementById("main-message").textContent = "¡A Responder!";
    }
});

socket.on("error", (data) => {
    if (data.msg === 'DNI ya votó esta pregunta') {
        yaVoto = true;
        disableOptions(null);
        document.getElementById("voto-status").textContent = "Tu voto ya está registrado para esta pregunta.";
    } else {
        console.error("Error del servidor:", data.msg);
        document.getElementById("voto-status").textContent = data.msg;
    }
});

socket.on("preguntaActiva", (data) => {
    renderQuestion(data);
});

socket.on("estadoJuego", (data) => {
    if (data.status === 'inicio' || data.status === 'ganadoresMostrados') {
        let message = (data.status === 'inicio') ?
            "Esperando indicaciones del moderador." :
            "";
        volverAportada(message);
    } else if (data.status === 'respuestaMostrada') {
        document.getElementById("voto-status").textContent = "¡Tiempo terminado! Revisando resultados...";
    }
});

socket.on("respuestaOk", () => {
    document.getElementById("voto-status").textContent = "Registramos tu voto!";
});

socket.on("disconnect", () => {
    document.getElementById("main-message").textContent = "Conexión perdida. Intentando reconectar...";
    document.getElementById("spinner").classList.remove('d-none');
});

// ---------------------------------------------
// --- INICIALIZACIÓN ---
// ---------------------------------------------
checkLocalStorage(); // Inicia la verificación del login y la conexión (si hay datos).

document.getElementById('modalIngreso').addEventListener('hidden.bs.modal', function () {
    // 🔑 CORRECCIÓN: Si el modal se cierra y AÚN no tenemos DNI, 
    // lo reabrimos (Esto solo es necesario si se permite cerrar el modal sin ingresar datos).
    // Como tiene data-bs-backdrop="static", este código es un poco redundante 
    // pero asegura la re-apertura si algo falla en el flujo normal.
    if (!userData.dni) {
        const modal = bootstrap.Modal.getInstance(document.getElementById('modalIngreso')) || new bootstrap.Modal(document.getElementById('modalIngreso'), {});
        modal.show();
    }
});