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

        //document.getElementById("main-message").textContent = "Ingresá tus datos para participar.";
        //document.getElementById("spinner").classList.add('d-none'); // Asegurarse que esté oculto

        const modal = new bootstrap.Modal(document.getElementById('modalIngreso'), {});
        modal.show();

    }
}

// --- GESTIÓN DE SESIÓN ---

// NUEVA FUNCIÓN: Contiene la lógica REAL de cerrar la sesión
function ejecutarCierreSesion() {
    // 1. Borrar datos de identidad
    localStorage.removeItem('dni');
    localStorage.removeItem('nombre');

    // 2. Limpiar todas las marcas de voto (voto_q_X) - SOLUCIÓN SEGURA
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        console.log("veo si borro " + key);

        if (key && key.startsWith('voto_q_')) {
            console.log("sí! Borrando: " + key);
            localStorage.removeItem(key);
        }
    }

    // 3. Desconectar y reiniciar
    socket.disconnect();
    window.location.reload();
}

// Función existente (ahora solo muestra el modal)
function cerrarSesion() {
    // Muestra el modal de Bootstrap en lugar de confirm()
    const modalConfirm = new bootstrap.Modal(document.getElementById('modalConfirmarCerrarSesion'), {});
    modalConfirm.show();
}

// --- Asignar Listener al Botón de Confirmación del Modal ---
document.getElementById('btnConfirmarLogout').addEventListener('click', (event) => {

    //  CORRECCIÓN CLAVE: Desenfocar el botón inmediatamente después del clic.
    // Esto asegura que el foco no esté dentro del modal antes de ocultarlo.
    event.currentTarget.blur();

    // 1. Ocultar el modal
    const modalConfirm = bootstrap.Modal.getInstance(document.getElementById('modalConfirmarCerrarSesion'));
    if (modalConfirm) {
        modalConfirm.hide();
    }

    // 2. Ejecutar la lógica de cierre de sesión
    ejecutarCierreSesion();
});


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

    // Actualizar la UI inmediatamente a "Conectando..."
    //document.getElementById("main-message").textContent = "Conectando con el servidor...";
    //document.getElementById("spinner").classList.remove('d-none'); // Muestra el spinner

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

    //  2. OBTENER EL VOTO GUARDADO: Lee la clave de la opción (A, B, C, D)
    const votoClave = localStorage.getItem(`voto_q_${pregunta.id}`);

    // 3. Crear HTML de Opciones
    const opcionesContainer = document.getElementById("opciones-container");
    opcionesContainer.innerHTML = '';

    pregunta.opciones.forEach(opcion => {
        const btn = document.createElement('button');
        //  CAMBIO CLAVE: Usamos 'btn-outline-dark' y 'btn-opcion' como base para que coincida con disableOptions
        btn.className = 'btn btn-outline-dark btn-lg w-100 mb-2 btn-opcion';
        btn.setAttribute('data-opcion', opcion.clave);
        btn.textContent = `${opcion.clave}. ${opcion.texto}`;
        btn.onclick = () => enviarRespuesta(opcion.clave, btn);
        opcionesContainer.appendChild(btn);
    });


    document.getElementById("pregunta-area").style.display = "block";
    document.getElementById("spinner").classList.add('d-none');

    //  4. APLICAR ESTADO DE VOTO LOCAL Y DESTACAR
    if (votoClave) {
        yaVoto = true;
        disableOptions(null); // Deshabilita todos los botones

        document.getElementById("voto-status").textContent = "Tu voto ya está registrado para esta pregunta.";

        // Seleccionamos el botón usando el atributo data-opcion guardado
        const btnVotado = document.querySelector(`#opciones-container button[data-opcion="${votoClave}"]`);

        if (btnVotado) {
            //  APLICAR EL MISMO ESTILO QUE disableOptions APLICA AL VOTAR
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

    // Detener cualquier cuenta regresiva activa
    detenerCuentaRegresivaMovil();
    

    preguntaActual = null;
    yaVoto = false;
    document.getElementById("pregunta-area").style.display = "none";
    document.getElementById("main-message").textContent = message || "Esperando pregunta...";
    document.getElementById("spinner").classList.remove('d-none');

    
}


// --- COMUNICACIÓN CON EL SERVIDOR ---

function enviarRespuesta(opcion, btnSeleccionado) {

    //detiene el timer:
    detenerCuentaRegresivaMovil();

    if (!preguntaActual || yaVoto) {
        document.getElementById("voto-status").textContent = "Ya votaste en esta pregunta o la pregunta ha terminado.";
        return;
    }

    // Oculta el botón
    disableOptions(btnSeleccionado);
    yaVoto = true;

    //  1. CAMBIO: Guardar la CLAVE de la opción (A, B, C, D) en el localStorage
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

socket.on("connect", () => {
    console.log("Conectado al backend. DNI:", userData.dni);

    // Si ya estamos logueados (DNI existe), establecemos la UI de espera.
    // Esto corrige que se quede en "Esperando conexión..." si el DNI estaba guardado.
    if (userData.dni) {
        document.getElementById("main-message").textContent = "Esperando próxima pregunta...";
        document.getElementById("spinner").classList.remove('d-none');
    }
});


socket.on("preguntaActiva", (data) => {

    // Al recibir la pregunta, renderizamos el HTML para que el usuario pueda votar.
    renderQuestion(data);
    // data ahora tiene data.tiempoLimiteMs
    iniciarCuentaRegresivaMovil(data.tiempoLimiteMs); // ⬅️ Asume que implementarás esta función

});

/* para el timer */
let countdownIntervalMovil = null;
const timerContainerMovil = document.getElementById('countdown-timer-mobile');
const timerDisplayMovil = document.getElementById('timer-display-mobile');

/**
 * Detiene cualquier intervalo de cuenta regresiva activo y oculta el contenedor.
 */
function detenerCuentaRegresivaMovil() {
    //vuelve a mostrar el status:
    const cajaMensaje = document.getElementById("main-message");
    if (cajaMensaje) {
        cajaMensaje.classList.remove("d-none");
        cajaMensaje.textContent = "Esperando próxima pregunta...";
    }



    if (countdownIntervalMovil) {
        clearInterval(countdownIntervalMovil);
        countdownIntervalMovil = null;
    }
    // Ocultar el timer y remover la clase de animación
    if (timerContainerMovil) {
        timerContainerMovil.classList.add('d-none');
        document.body.classList.remove('timer-active-mobile');
    }
}

/**
 * Inicia la cuenta regresiva visible en la interfaz del móvil.
 * @param {number} tiempoMs - Tiempo límite en milisegundos.
 */
function iniciarCuentaRegresivaMovil(tiempoMs) {

    //si el tiempo es 0 o negativo o NaN, no hace nada
    if (!tiempoMs || tiempoMs <= 0) {
        console.warn("Tiempo inválido para la cuenta regresiva móvil:", tiempoMs);
        return;
    }

    console.log("intenta iniciar cuenta regresiva");

    // 1. Detener cualquier timer anterior
    detenerCuentaRegresivaMovil();

    //quita el status de texto:
    document.getElementById("main-message").classList.add("d-none");


    // 2. Verificar que el elemento exista (seguridad)
    if (!timerContainerMovil || !timerDisplayMovil) {
        console.warn("Elemento del cronómetro no encontrado en el móvil. No se iniciará la cuenta regresiva.");
        return;
    }

    // 3. Mostrar el timer y activar las animaciones
    timerContainerMovil.classList.remove('d-none');
    document.body.classList.add('timer-active-mobile');

    // 4. Inicializar el tiempo en segundos
    let segundosRestantes = Math.floor(tiempoMs / 1000);
    timerDisplayMovil.textContent = segundosRestantes;

    // 5. Iniciar el intervalo de 1 segundo
    countdownIntervalMovil = setInterval(() => {
        segundosRestantes--;

        if (segundosRestantes >= 0) {
            timerDisplayMovil.textContent = segundosRestantes;
        }

        //si falta 5 segundos o menos, cambia a fast:
        if (segundosRestantes <= 5) {
            timerContainerMovil.classList.add('fast');
        } else {
            timerContainerMovil.classList.remove('fast');
        }


        // 6. Condición de finalización
        if (segundosRestantes <= 0) {
            detenerCuentaRegresivaMovil();
            // 💡 Aquí puedes agregar lógica para deshabilitar botones si el tiempo acabó
            document.getElementById('voto-status').textContent = "¡Tiempo de respuesta agotado!";
            // La lógica para deshabilitar los botones debería ir aquí.
            const opciones = document.querySelectorAll('#opciones-container button');
            opciones.forEach(btn => btn.disabled = true);
        }

    }, 1000); // 1000 ms = 1 segundo
}


// --- HANDLERS DE SOCKET.IO ---

socket.on("estadoJuego", (data) => {
    // Maneja todos los cambios de estado del juego (inicio, fin de tiempo, ranking, etc.)
    const { status, pregunta, respuestaCorrecta } = data; //  CLAVE: Desestructurar 'pregunta' y 'respuestaCorrecta'

    console.log(`Estado del juego recibido: ${status}`);

    if (status === 'inicio' || status === 'ganadoresMostrados') {
        let message = (status === 'inicio') ?
            "Esperando indicaciones del moderador." :
            "¡Ranking Finalizado!";
        // Vuelve a la pantalla de espera
        volverAportada(message);
    } else if (status === 'respuestaMostrada') {
        document.getElementById("voto-status").textContent = "¡Tiempo terminado! Revisando resultados...";

        /*
        //Opcional: Destacar la respuesta correcta en el móvil si la envía el servidor
        if (preguntaActual && respuestaCorrecta) {
            highlightCorrectAnswer(respuestaCorrecta);
        }
        */

    } else if (status === 'aResponder') {

        console.log("tiempo recibido: " + data.tiempoLimiteMs);
        //Si la pregunta viene en el payload y no la tenemos, la renderizamos
        if (pregunta && pregunta.id !== (preguntaActual ? preguntaActual.id : null)) {
            // Es una pregunta nueva: renderizar
            renderQuestion(pregunta);
            document.getElementById("main-message").textContent = `¡A Responder!`;

            //  LLAMADA CLAVE: Iniciar el cronómetro
            if (data.tiempoLimiteMs) {
                iniciarCuentaRegresivaMovil(data.tiempoLimiteMs);
            }
            // NOTA: Si ya votó (yaVoto es true), renderQuestion ya lo manejará

        } else if (preguntaActual) {
            // Ya tenemos la pregunta, solo actualizamos el mensaje si no hay voto
            if (!yaVoto) {
                document.getElementById("main-message").textContent = "¡A responder!";
                // Iniciar el cronómetro
                if (data.tiempoLimiteMs) {
                    iniciarCuentaRegresivaMovil(data.tiempoLimiteMs);
                }
            }
        }
    } else if (status === 'procesandoRanking') {
        // desactiva el timer
        detenerCuentaRegresivaMovil();
        volverAportada("Procesando resultados...");

        document.getElementById("voto-status").textContent = "Procesando resultados...";
    } else if (status === 'ganadoresMostrados') {
        // desactiva el timer
        detenerCuentaRegresivaMovil();
        volverAportada("¡Ranking Finalizado!");
    }
});


socket.on("respuestaOk", () => {
    // Se confirma que el voto fue registrado en el servidor.
    document.getElementById("voto-status").textContent = "Registramos tu voto!";
});

socket.on("error", (data) => {
    // Maneja errores específicos del servidor, como votar dos veces.
    if (data.msg === 'DNI ya votó esta pregunta') {
        yaVoto = true;
        disableOptions(null);
        document.getElementById("voto-status").textContent = "Tu voto ya está registrado para esta pregunta.";
    } else if (data.msg === 'La pregunta aún no ha comenzado o ya finalizó.') {
        //no desacativa las opciones



    } else {
        console.error("Error del servidor:", data.msg);
        document.getElementById("voto-status").textContent = data.msg;
    }
});

socket.on("disconnect", () => {
    // Se dispara cuando se pierde la conexión con el servidor.
    document.getElementById("main-message").textContent = "Conexión perdida. Intentando reconectar...";
    document.getElementById("spinner").classList.remove('d-none');
});



// ---------------------------------------------
// --- INICIALIZACIÓN ---
// ---------------------------------------------
checkLocalStorage(); // Inicia la verificación del login y la conexión (si hay datos).

document.getElementById('modalIngreso').addEventListener('hidden.bs.modal', function () {
    //  CORRECCIÓN: Si el modal se cierra y AÚN no tenemos DNI, 
    // lo reabrimos (Esto solo es necesario si se permite cerrar el modal sin ingresar datos).
    // Como tiene data-bs-backdrop="static", este código es un poco redundante 
    // pero asegura la re-apertura si algo falla en el flujo normal.
    if (!userData.dni) {
        const modal = bootstrap.Modal.getInstance(document.getElementById('modalIngreso')) || new bootstrap.Modal(document.getElementById('modalIngreso'), {});
        modal.show();
    }
});