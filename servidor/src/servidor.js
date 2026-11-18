/**
 * Servidor de un nodo del mensajero.
 *
 * Un solo proceso atiende en el mismo puerto (8080 dentro del contenedor):
 *   - HTTP  GET /          -> página web (la interfaz llega en la fase 3)
 *   - HTTP  GET /salud     -> estado del nodo en JSON (lo usa el healthcheck de Docker)
 *   - HTTP  GET /usuarios  -> usuarios conectados en JSON
 *   - WebSocket  /ws       -> clientes (navegador, wscat o el cliente de consola)
 *   - WebSocket  /nodo     -> el otro nodo (enlace entre nodos)
 *
 * Mensajes que entiende por /ws (JSON, uno por trama):
 *   {"tipo":"registro","usuario":"ana"}
 *   {"tipo":"mensaje","para":"beto","texto":"hola"}
 *   {"tipo":"oferta"|"respuesta"|"candidato"|"colgar","para":"beto",...}  (señalización WebRTC, fase 3)
 *   {"tipo":"lista"}
 *
 * Mensajes que entiende por /nodo (los envía el nodo par):
 *   {"tipo":"presencia","nodo":"nodo-b","usuarios":["beto"]}
 *   {"tipo":"reenvio","mensaje":{...mensaje dirigido completo...}}
 *
 * Configuración por variables de entorno (las pone docker-compose.yml):
 *   NODO_NOMBRE  nombre de este nodo (nodo-a)
 *   PAR_URL      dirección del otro nodo por nombre (ws://nodo-b:8080/nodo)
 *   PUERTO       puerto interno (8080)
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');

const { log, NODO } = require('./registro');
const { Directorio } = require('./directorio');
const { EnlaceNodos } = require('./enlace');

const PUERTO = Number(process.env.PUERTO || 8080);
const PAR_URL = process.env.PAR_URL || '';
const CARPETA_PUBLICA = path.join(__dirname, '..', 'public');

// Tipos de mensaje que van dirigidos a otro usuario y que el nodo solo enruta.
const TIPOS_DIRIGIDOS = ['mensaje', 'oferta', 'respuesta', 'candidato', 'colgar'];
// Nombres válidos: letras, números, guion y guion bajo, de 1 a 20 caracteres.
const NOMBRE_VALIDO = /^[a-zA-Z0-9_-]{1,20}$/;

const directorio = new Directorio(NODO);
// Al abrirse el enlace se le cuenta al par quién está conectado aquí.
const enlace = new EnlaceNodos(PAR_URL, () => enviarPresenciaAlPar());

// ---------------------------------------------------------------- HTTP

/** Responde un objeto como JSON. */
function responderJson(res, codigo, objeto) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(objeto, null, 2));
}

/** Estado del nodo: lo devuelve /salud. */
function estadoNodo() {
  return {
    nodo: NODO,
    par: PAR_URL || null,
    par_conectado: enlace.conectado,
    usuarios: directorio.listaCompleta(),
  };
}

/** Sirve un archivo de la carpeta public/ (sin dejar salir de ella). */
function servirArchivo(res, rutaUrl) {
  const relativa = rutaUrl === '/' ? 'index.html' : rutaUrl.slice(1);
  const ruta = path.normalize(path.join(CARPETA_PUBLICA, relativa));
  if (!ruta.startsWith(CARPETA_PUBLICA)) return responderJson(res, 403, { error: 'ruta no permitida' });

  fs.readFile(ruta, (error, contenido) => {
    if (error) return responderJson(res, 404, { error: 'no encontrado' });
    const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    const tipo = tipos[path.extname(ruta)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': `${tipo}; charset=utf-8` });
    res.end(contenido);
  });
}

/** Atiende cada petición HTTP. */
function atenderHttp(req, res) {
  const rutaUrl = new URL(req.url, 'http://nodo').pathname;
  if (req.method !== 'GET') return responderJson(res, 405, { error: 'solo GET' });
  if (rutaUrl === '/salud') return responderJson(res, 200, estadoNodo());
  if (rutaUrl === '/usuarios') return responderJson(res, 200, directorio.listaCompleta());
  return servirArchivo(res, rutaUrl);
}

// ---------------------------------------------------------------- Clientes WebSocket

/** Envía un objeto JSON por un WebSocket si está abierto. */
function enviar(socket, objeto) {
  if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(objeto));
}

/** Avisa a todos los clientes locales quién está conectado (en los dos nodos). */
function difundirPresencia() {
  const aviso = { tipo: 'presencia', usuarios: directorio.listaCompleta() };
  for (const usuario of directorio.nombresLocales()) enviar(directorio.socketDe(usuario), aviso);
}

/** Le cuenta al nodo par qué usuarios están conectados en este nodo. */
function enviarPresenciaAlPar() {
  enlace.enviar({ tipo: 'presencia', nodo: NODO, usuarios: directorio.nombresLocales() });
}

/** Algo cambió en este nodo: se avisa a los clientes locales y al par. */
function presenciaCambio() {
  difundirPresencia();
  enviarPresenciaAlPar();
}

/** Texto corto para el log: el texto del chat o solo el tipo (no se loguea el SDP completo). */
function resumen(m) {
  return m.tipo === 'mensaje' ? `${m.de} -> ${m.para}: ${m.texto}` : `${m.de} -> ${m.para} (${m.tipo})`;
}

/**
 * Lleva un mensaje dirigido a su destinatario:
 *   - si está en este nodo, se lo entrega directamente;
 *   - si está en el otro nodo, lo reenvía por el enlace entre nodos;
 *   - si no está en ninguno, le devuelve un error a quien lo envió.
 */
function enrutar(mensaje, socketOrigen) {
  const destino = directorio.dondeEsta(mensaje.para);

  if (destino === 'local') {
    enviar(directorio.socketDe(mensaje.para), mensaje);
    log('ENTREGADO', resumen(mensaje));
    return;
  }
  if (destino) {
    if (enlace.enviar({ tipo: 'reenvio', mensaje })) {
      log('REENVIADO', `${resumen(mensaje)}  [hacia ${destino}]`);
    } else {
      log('ERROR', `enlace con ${destino} caído; no se pudo reenviar (${resumen(mensaje)})`);
      enviar(socketOrigen, { tipo: 'error', motivo: `el nodo ${destino} no está disponible` });
    }
    return;
  }
  log('ERROR', `${mensaje.para} no está conectado (${resumen(mensaje)})`);
  enviar(socketOrigen, { tipo: 'error', motivo: `usuario '${mensaje.para}' no está conectado` });
}

/** Procesa el primer mensaje del cliente: debe ser el registro con su nombre. */
function registrar(socket, mensaje) {
  const usuario = String(mensaje.usuario || '').trim();
  if (!NOMBRE_VALIDO.test(usuario)) {
    return enviar(socket, { tipo: 'error', motivo: 'nombre inválido: use letras, números, - o _ (máx. 20)' });
  }
  if (directorio.existe(usuario)) {
    return enviar(socket, { tipo: 'error', motivo: `el nombre '${usuario}' ya está en uso` });
  }
  socket.usuario = usuario;
  directorio.agregarLocal(usuario, socket);
  log('REGISTRO', `${usuario} se conectó`);
  enviar(socket, { tipo: 'registrado', usuario, nodo: NODO });
  presenciaCambio();
}

/** Procesa cada mensaje que llega de un cliente. */
function alMensajeDeCliente(socket, datos) {
  let mensaje;
  try {
    mensaje = JSON.parse(datos);
  } catch {
    return enviar(socket, { tipo: 'error', motivo: 'el mensaje no es JSON válido' });
  }

  if (mensaje.tipo === 'registro') return registrar(socket, mensaje);
  if (!socket.usuario) return enviar(socket, { tipo: 'error', motivo: 'primero envíe {"tipo":"registro","usuario":"..."}' });
  if (mensaje.tipo === 'lista') return enviar(socket, { tipo: 'presencia', usuarios: directorio.listaCompleta() });

  if (TIPOS_DIRIGIDOS.includes(mensaje.tipo)) {
    if (!mensaje.para) return enviar(socket, { tipo: 'error', motivo: 'falta el campo "para"' });
    // El nodo completa estos campos: así un cliente no puede hacerse pasar por otro.
    mensaje.de = socket.usuario;
    mensaje.id = crypto.randomUUID();
    mensaje.ts = new Date().toISOString();
    mensaje.nodo_origen = NODO;
    return enrutar(mensaje, socket);
  }
  enviar(socket, { tipo: 'error', motivo: `tipo desconocido: ${mensaje.tipo}` });
}

/** Un cliente se desconectó: se quita del directorio y se avisa a los demás. */
function alCerrarCliente(socket) {
  if (!socket.usuario) return;
  directorio.quitarLocal(socket.usuario);
  log('SALIDA', `${socket.usuario} se desconectó`);
  presenciaCambio();
}

// ---------------------------------------------------------------- Nodo par (conexión entrante /nodo)

/** Procesa lo que envía el otro nodo. */
function alMensajeDelPar(socket, datos) {
  let mensaje;
  try {
    mensaje = JSON.parse(datos);
  } catch {
    return log('ERROR', 'el par envió algo que no es JSON');
  }

  if (mensaje.tipo === 'presencia') {
    socket.nodo = mensaje.nodo;  // así se sabe de quién es esta conexión
    directorio.reemplazarRemotos(mensaje.nodo, mensaje.usuarios || []);
    log('PRESENCIA', `${mensaje.nodo} tiene conectados: [${(mensaje.usuarios || []).join(', ')}]`);
    difundirPresencia();
    return;
  }

  if (mensaje.tipo === 'reenvio') {
    const m = mensaje.mensaje;
    // Solo se entrega aquí: un mensaje que vino del par NUNCA se reenvía de vuelta (evita ciclos).
    if (directorio.dondeEsta(m.para) === 'local') {
      enviar(directorio.socketDe(m.para), m);
      log('ENTREGADO', `${resumen(m)}  [desde ${m.nodo_origen}]`);
    } else {
      log('DESCARTADO', `${m.para} ya no está en este nodo (${resumen(m)})`);
    }
    return;
  }
  log('ERROR', `tipo desconocido desde el par: ${mensaje.tipo}`);
}

/** El otro nodo se cayó o se apagó: se olvidan sus usuarios. */
function alCerrarPar(socket) {
  if (!socket.nodo) return;
  directorio.quitarRemotosDe(socket.nodo);
  log('ENLACE', `${socket.nodo} cerró su conexión; sus usuarios quedan fuera de línea`);
  difundirPresencia();
}

// ---------------------------------------------------------------- Arranque

const servidorHttp = http.createServer(atenderHttp);
const wsClientes = new WebSocketServer({ noServer: true });
const wsNodos = new WebSocketServer({ noServer: true });

// Las conexiones WebSocket llegan como un "upgrade" de HTTP; según la ruta van a clientes o a nodos.
servidorHttp.on('upgrade', (req, socket, cabeza) => {
  const ruta = new URL(req.url, 'http://nodo').pathname;
  if (ruta === '/ws') {
    wsClientes.handleUpgrade(req, socket, cabeza, (ws) => wsClientes.emit('connection', ws));
  } else if (ruta === '/nodo') {
    wsNodos.handleUpgrade(req, socket, cabeza, (ws) => wsNodos.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

wsClientes.on('connection', (socket) => {
  socket.on('message', (datos) => alMensajeDeCliente(socket, datos.toString()));
  socket.on('close', () => alCerrarCliente(socket));
});

wsNodos.on('connection', (socket, req) => {
  log('ENLACE', `el par se conectó desde ${req.socket.remoteAddress}`);
  socket.on('message', (datos) => alMensajeDelPar(socket, datos.toString()));
  socket.on('close', () => alCerrarPar(socket));
});

servidorHttp.listen(PUERTO, () => {
  log('INICIO', `escuchando en el puerto ${PUERTO}; par: ${PAR_URL || '(ninguno)'}`);
  enlace.conectar();
});

// docker compose down envía SIGTERM: se cierra ordenadamente en vez de esperar 10 s.
for (const senal of ['SIGTERM', 'SIGINT']) {
  process.on(senal, () => {
    log('APAGADO', `señal ${senal}`);
    servidorHttp.close();
    process.exit(0);
  });
}
