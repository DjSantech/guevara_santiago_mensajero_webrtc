/**
 * llamada.js: videollamada entre dos usuarios.
 *
 * Flujo:
 *   1. Ana pulsa "Llamar": su navegador pide cámara y micrófono (getUserMedia)
 *      y le manda a Beto el aviso {"tipo":"llamada"} por el nodo.
 *   2. Beto ve "Ana te está llamando" y pulsa "Contestar" (o "Rechazar").
 *   3. Cada uno agrega sus pistas de audio y video a la conexión (addTrack);
 *      eso dispara la negociación de webrtc.js (oferta, respuesta y candidatos).
 *   4. Cuando llegan las pistas del otro (evento "track"), se muestran en el video remoto.
 *   5. "Colgar" detiene la cámara y el micrófono, deja de enviarlas con
 *      replaceTrack(null) y avisa con {"tipo":"colgar"}.
 *
 * Por qué replaceTrack y no removeTrack: removeTrack obliga a renegociar en los
 * dos navegadores a la vez y, si en ese momento se abría el canal de archivos,
 * Chrome entraba en un ciclo de renegociaciones y el canal nunca abría.
 * replaceTrack cambia lo que se envía SIN renegociar; en la siguiente llamada se
 * reutilizan los mismos canales de medios con replaceTrack(pistaNueva).
 *
 * Silenciar y apagar la cámara solo desactivan la pista (track.enabled = false):
 * la llamada sigue y no hay que renegociar.
 */
(function () {
  'use strict';

  const ui = App.ui;
  let medios = null;          // MediaStream local (cámara y micrófono)
  let llamadaCon = null;      // usuario con el que hay una llamada activa
  let entranteDe = null;      // usuario que está llamando
  // Último audio/video recibido de cada usuario. Hace falta porque al que contesta
  // le llegan las pistas del que llama ANTES de pulsar "Contestar".
  const remotos = new Map();  // usuario -> MediaStream remoto

  /** Pista local de audio o video (la usa también la prueba automática). */
  App.pistaLocal = (tipo) => (medios ? medios.getTracks().find((t) => t.kind === tipo) : null);

  /** Mensaje claro según el error de getUserMedia. */
  function explicarErrorMedios(err) {
    switch (err.name) {
      case 'NotAllowedError': return 'Permiso de cámara o micrófono denegado. Autorícelo en el candado de la barra de direcciones y en Windows (Configuración > Privacidad).';
      case 'NotFoundError': return 'No se encontró cámara o micrófono en este equipo.';
      case 'NotReadableError': return 'La cámara o el micrófono están siendo usados por otra aplicación.';
      case 'SecurityError':
      case 'TypeError': return 'La cámara solo funciona en HTTPS o en localhost.';
      default: return `No se pudo acceder a la cámara o al micrófono (${err.name}).`;
    }
  }

  /** Pide cámara y micrófono. Devuelve true si se obtuvieron. */
  async function capturarMedios() {
    try {
      if (!navigator.mediaDevices) throw new TypeError('sin mediaDevices');
      medios = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      ui.local.srcObject = medios;
      return true;
    } catch (err) {
      App.mostrarAviso(explicarErrorMedios(err));
      return false;
    }
  }

  /**
   * Envía las pistas locales al otro.
   * - Primera llamada: addTrack (crea los canales de medios y dispara la negociación).
   * - Llamadas siguientes: ya hay un canal de medios de ese tipo sin pista (quedó así
   *   al colgar), y se le pone la pista nueva con replaceTrack, sin renegociar.
   */
  function enviarPistas(otro) {
    const par = App.obtenerPar(otro, true);
    for (const pista of medios.getTracks()) {
      const libre = par.pc.getTransceivers().find((t) =>
        !t.stopped && t.sender.track === null && t.receiver.track.kind === pista.kind &&
        (t.direction === 'sendrecv' || t.direction === 'sendonly'));
      if (libre) libre.sender.replaceTrack(pista);
      else par.pc.addTrack(pista, medios);
    }
  }

  /** Activa o desactiva los botones según haya o no llamada. */
  function actualizarBotones() {
    const hayLlamada = Boolean(llamadaCon);
    const puedeLlamar = App.conversacion && App.estaEnLinea(App.conversacion) && !hayLlamada && !entranteDe;
    ui.llamar.disabled = !puedeLlamar;
    ui.colgar.disabled = !hayLlamada;
    ui.silenciar.disabled = !hayLlamada;
    ui.camara.disabled = !hayLlamada;
    ui.videos.hidden = !hayLlamada;
    if (!hayLlamada) {
      ui.silenciar.textContent = 'Silenciar micrófono';
      ui.camara.textContent = 'Apagar cámara';
    }
  }

  /** Botón "Llamar". */
  async function llamar() {
    const otro = App.conversacion;
    if (!otro || llamadaCon) return;
    if (!App.estaEnLinea(otro)) return App.mostrarAviso(`${otro} no está conectado.`);
    if (!(await capturarMedios())) return;
    llamadaCon = otro;
    ui.remotoNombre.textContent = otro;
    if (remotos.has(otro)) ui.remoto.srcObject = remotos.get(otro);   // en una 2.ª llamada no hay nuevo evento "track"
    actualizarBotones();
    App.enviar({ tipo: 'llamada', para: otro });
    App.avisoEnChat(otro, `Llamando a ${otro}…`);
    enviarPistas(otro);
  }

  /** Llega una llamada. Si ya hay otra en curso, se responde "ocupado" colgando. */
  function alLlamada(m) {
    if (llamadaCon || entranteDe) {
      App.enviar({ tipo: 'colgar', para: m.de });
      return;
    }
    entranteDe = m.de;
    ui.entranteTexto.textContent = `${m.de} te está llamando.`;
    ui.entrante.hidden = false;
    actualizarBotones();
  }

  /** Botón "Contestar". */
  async function contestar() {
    const otro = entranteDe;
    entranteDe = null;
    ui.entrante.hidden = true;
    if (!otro) return;
    if (!(await capturarMedios())) {
      App.enviar({ tipo: 'colgar', para: otro });   // sin cámara no se puede contestar: se avisa
      return actualizarBotones();
    }
    llamadaCon = otro;
    ui.remotoNombre.textContent = otro;
    if (remotos.has(otro)) ui.remoto.srcObject = remotos.get(otro);   // video que ya había llegado
    actualizarBotones();
    App.avisoEnChat(otro, `Llamada con ${otro} iniciada.`);
    enviarPistas(otro);
  }

  /** Botón "Rechazar". */
  function rechazar() {
    if (entranteDe) App.enviar({ tipo: 'colgar', para: entranteDe });
    entranteDe = null;
    ui.entrante.hidden = true;
    actualizarBotones();
  }

  /** Termina la llamada con "otro": apaga cámara y micrófono y deja de enviarlos. */
  function terminar(otro, motivo) {
    if (entranteDe === otro) {
      entranteDe = null;
      ui.entrante.hidden = true;
    }
    if (llamadaCon !== otro) return actualizarBotones();

    llamadaCon = null;
    if (medios) medios.getTracks().forEach((t) => t.stop());   // se apaga la luz de la cámara
    medios = null;
    ui.local.srcObject = null;
    ui.remoto.srcObject = null;

    const par = App.buscarPar(otro);   // buscar, no crear: si el otro se fue, la conexión ya no existe
    if (par && par.pc.signalingState !== 'closed') {
      for (const sender of par.pc.getSenders()) {
        if (sender.track) sender.replaceTrack(null);   // deja de enviar sin renegociar
      }
    }
    if (motivo) App.avisoEnChat(otro, motivo);
    actualizarBotones();
  }

  /** Botón "Colgar". */
  function colgar() {
    if (!llamadaCon) return;
    const otro = llamadaCon;
    App.enviar({ tipo: 'colgar', para: otro });
    terminar(otro, 'Llamada terminada.');
  }

  /** Silenciar o activar el micrófono sin cortar la llamada. */
  function alternarMicrofono() {
    const pista = App.pistaLocal('audio');
    if (!pista) return;
    pista.enabled = !pista.enabled;
    ui.silenciar.textContent = pista.enabled ? 'Silenciar micrófono' : 'Activar micrófono';
  }

  /** Apagar o encender la cámara sin cortar la llamada. */
  function alternarCamara() {
    const pista = App.pistaLocal('video');
    if (!pista) return;
    pista.enabled = !pista.enabled;
    ui.camara.textContent = pista.enabled ? 'Apagar cámara' : 'Encender cámara';
  }

  // Llegan las pistas del otro: se muestran en el video remoto.
  App.alPista.push((otro, evento) => {
    remotos.set(otro, evento.streams[0]);
    if (otro === llamadaCon) ui.remoto.srcObject = evento.streams[0];
  });

  App.on('llamada', alLlamada);
  App.on('colgar', (m) => terminar(m.de, `${m.de} terminó o rechazó la llamada.`));
  App.alDesconectarse.push((usuario) => {
    terminar(usuario, 'La llamada se cortó porque el otro usuario se desconectó.');
    remotos.delete(usuario);   // su conexión se cerró: el video guardado ya no sirve
  });
  App.alCambiarChat.push(actualizarBotones);

  ui.llamar.addEventListener('click', llamar);
  ui.colgar.addEventListener('click', colgar);
  ui.contestar.addEventListener('click', contestar);
  ui.rechazar.addEventListener('click', rechazar);
  ui.silenciar.addEventListener('click', alternarMicrofono);
  ui.camara.addEventListener('click', alternarCamara);
})();
