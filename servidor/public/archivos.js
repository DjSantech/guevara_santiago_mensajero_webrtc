/**
 * archivos.js: envío de archivos de cualquier tipo por un RTCDataChannel.
 *
 * El archivo NO pasa por los nodos: va directo de navegador a navegador, por el
 * canal de datos "archivos" (confiable y ordenado: SCTP sobre DTLS sobre UDP).
 *
 * Protocolo dentro del canal:
 *   1. {"tipo":"inicio","id","nombre","tamano","mime","sha256"}   (texto)
 *   2. fragmentos binarios de 16 KiB                              (ArrayBuffer)
 *   3. {"tipo":"fin","id"}                                         (texto)
 *   4. el receptor responde {"tipo":"recibido","id","ok":true|false}
 *
 * Control del búfer: si hay más de 1 MiB esperando en el canal (bufferedAmount),
 * se pausa hasta el evento "bufferedamountlow". Así un archivo de 20 MB no satura
 * la memoria ni el canal.
 *
 * Integridad: el emisor calcula el SHA-256 del archivo y el receptor lo recalcula
 * al unir los fragmentos; si no coincide (o el tamaño no cuadra) lo marca como dañado.
 */
(function () {
  'use strict';

  const ui = App.ui;
  const TAM_FRAGMENTO = 16 * 1024;      // 16 KiB: tamaño seguro entre navegadores
  const LIMITE_BUFER = 1024 * 1024;     // pausar si hay más de 1 MiB sin enviar
  const UMBRAL_BAJO = 256 * 1024;       // reanudar cuando baje de 256 KiB

  /** SHA-256 en hexadecimal (Web Crypto API; requiere HTTPS o localhost). */
  async function sha256(buffer) {
    const huella = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(huella)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ------------------------------------------------------------ barra de progreso

  function mostrarProgreso(texto, total) {
    ui.progresoTexto.textContent = texto;
    ui.progreso.max = total;
    ui.progreso.value = 0;
    ui.zonaProgreso.hidden = false;
  }

  function ocultarProgreso() {
    ui.zonaProgreso.hidden = true;
  }

  // ------------------------------------------------------------ canal de datos

  /** Prepara un canal (propio o recibido) para enviar y recibir archivos. */
  function configurarCanal(par, canal) {
    par.canal = canal;
    canal.binaryType = 'arraybuffer';
    canal.bufferedAmountLowThreshold = UMBRAL_BAJO;
    canal.onmessage = (e) => alDatos(par, canal, e.data);
    canal.onclose = () => {
      // Si se estaba recibiendo un archivo y el canal se cerró antes del "fin": interrumpido.
      if (canal.recepcion) {
        App.avisoEnChat(par.otro, `Archivo ${canal.recepcion.nombre} interrumpido: se cerró la conexión con ${par.otro}.`);
        canal.recepcion = null;
        ocultarProgreso();
      }
    };
  }

  /** Espera hasta que el canal con "otro" esté abierto (máx. 15 s). Lo crea si no existe. */
  function canalAbierto(otro) {
    const par = App.obtenerPar(otro);
    if (!par.canal || par.canal.readyState === 'closed') {
      configurarCanal(par, par.pc.createDataChannel('archivos', { ordered: true }));   // dispara la negociación
    }
    return new Promise((resolver, rechazar) => {
      const inicio = Date.now();
      const revisar = () => {
        if (par.canal && par.canal.readyState === 'open') return resolver(par.canal);
        if (Date.now() - inicio > 15000) return rechazar(new Error(`no se pudo abrir el canal con ${otro}`));
        setTimeout(revisar, 100);
      };
      revisar();
    });
  }

  /** Espera a que baje el búfer del canal; falla si el canal se cierra mientras tanto. */
  function esperarBuferBajo(canal) {
    return new Promise((resolver, rechazar) => {
      const listo = () => { canal.removeEventListener('close', cerrado); resolver(); };
      const cerrado = () => { canal.removeEventListener('bufferedamountlow', listo); rechazar(new Error('se cerró el canal')); };
      canal.addEventListener('bufferedamountlow', listo, { once: true });
      canal.addEventListener('close', cerrado, { once: true });
    });
  }

  // ------------------------------------------------------------ enviar

  let cola = Promise.resolve();   // los archivos se envían de a uno

  /** Botón "Enviar archivo": pone el archivo elegido en la cola de envío. */
  function enviarArchivo() {
    const archivo = ui.archivo.files[0];
    const otro = App.conversacion;
    if (!archivo || !otro) return;
    if (!App.estaEnLinea(otro)) return App.mostrarAviso(`${otro} no está conectado.`);
    if (archivo.size === 0) return App.mostrarAviso('El archivo está vacío.');
    ui.archivo.value = '';
    cola = cola.then(() => transferir(otro, archivo)).catch((err) => {
      ocultarProgreso();
      App.avisoEnChat(otro, `No se pudo enviar ${archivo.name}: ${err.message}.`);
    });
  }

  /** Envía un archivo por fragmentos al usuario "otro". */
  async function transferir(otro, archivo) {
    mostrarProgreso(`Preparando ${archivo.name}…`, archivo.size);
    const canal = await canalAbierto(otro);
    const datos = await archivo.arrayBuffer();
    const id = crypto.randomUUID();

    canal.send(JSON.stringify({
      tipo: 'inicio', id, nombre: archivo.name, tamano: archivo.size,
      mime: archivo.type || 'application/octet-stream', sha256: await sha256(datos),
    }));
    mostrarProgreso(`Enviando ${archivo.name} a ${otro}`, archivo.size);

    for (let desde = 0; desde < datos.byteLength; desde += TAM_FRAGMENTO) {
      if (canal.readyState !== 'open') throw new Error('se cerró la conexión');
      if (canal.bufferedAmount > LIMITE_BUFER) await esperarBuferBajo(canal);
      canal.send(datos.slice(desde, desde + TAM_FRAGMENTO));
      ui.progreso.value = Math.min(desde + TAM_FRAGMENTO, datos.byteLength);
    }
    canal.send(JSON.stringify({ tipo: 'fin', id }));
    ocultarProgreso();

    // El emisor también ve el archivo en su chat.
    App.guardar(otro, {
      tipo: 'archivo', de: App.miNombre, nombre: archivo.name, mime: archivo.type,
      url: URL.createObjectURL(archivo), hora: App.hora(),
    });
  }

  // ------------------------------------------------------------ recibir

  /** Todo lo que llega por el canal: texto de control o fragmentos binarios. */
  function alDatos(par, canal, datos) {
    if (typeof datos !== 'string') {
      const r = canal.recepcion;
      if (!r) return;
      r.partes.push(datos);
      r.recibido += datos.byteLength;
      ui.progreso.value = r.recibido;
      return;
    }

    const m = JSON.parse(datos);
    if (m.tipo === 'inicio') {
      canal.recepcion = { ...m, partes: [], recibido: 0 };
      mostrarProgreso(`Recibiendo ${m.nombre} de ${par.otro}`, m.tamano);
    } else if (m.tipo === 'fin') {
      terminarRecepcion(par, canal);
    } else if (m.tipo === 'recibido') {
      App.avisoEnChat(par.otro, m.ok
        ? `${par.otro} recibió ${m.nombre} completo (SHA-256 verificado).`
        : `${par.otro} recibió ${m.nombre} dañado o incompleto.`);
    }
  }

  /** Une los fragmentos, verifica tamaño y SHA-256 y lo muestra en el chat. */
  async function terminarRecepcion(par, canal) {
    const r = canal.recepcion;
    canal.recepcion = null;
    ocultarProgreso();
    if (!r) return;

    const blob = new Blob(r.partes, { type: r.mime });
    const correcto = blob.size === r.tamano && (await sha256(await blob.arrayBuffer())) === r.sha256;
    if (canal.readyState === 'open') canal.send(JSON.stringify({ tipo: 'recibido', id: r.id, nombre: r.nombre, ok: correcto }));

    if (!correcto) {
      App.avisoEnChat(par.otro, `El archivo ${r.nombre} llegó incompleto o dañado (no coincide el tamaño o la huella SHA-256).`);
      return;
    }
    App.guardar(par.otro, {
      tipo: 'archivo', de: par.otro, nombre: r.nombre, mime: r.mime,
      url: URL.createObjectURL(blob), hora: App.hora(),
    });
  }

  // ------------------------------------------------------------ conexión con el resto

  /** Habilita el selector de archivo solo si el otro está en línea. */
  function actualizarBotones() {
    const habilitado = Boolean(App.conversacion && App.estaEnLinea(App.conversacion));
    ui.archivo.disabled = !habilitado;
    ui.enviarArchivo.disabled = !habilitado;
  }

  App.alCanal.push(configurarCanal);
  App.alCambiarChat.push(actualizarBotones);
  ui.enviarArchivo.addEventListener('click', enviarArchivo);
})();
