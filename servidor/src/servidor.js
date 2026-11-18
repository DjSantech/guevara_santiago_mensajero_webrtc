/**
 * Servidor de un nodo del mensajero.
 *
 * Un solo proceso atiende en el mismo puerto (8080 dentro del contenedor):
 *   - HTTP  GET /          -> página web (la interfaz llega en la fase 3)
 *   - HTTP  GET /salud     -> estado del nodo en JSON (lo usa el healthcheck de Docker)
 *   - HTTP  GET /usuarios  -> usuarios conectados en JSON
 *   - WebSocket  /ws       -> clientes (navegador, wscat o el cliente de consola)
 *
 * Mensajes que entiende por /ws (JSON, uno por trama):
 *   {"tipo":"registro","usuario":"ana"}
 *   {"tipo":"mensaje","para":"beto","texto":"hola"}
 *   {"tipo":"oferta"|"respuesta"|"candidato"|"colgar","para":"beto",...}  (señalización WebRTC, fase 3)
 *   {"tipo":"lista"}
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');

const { log, NODO } = require('./registro');
const { Directorio } = require('./directorio');

const PUERTO = Number(process.env.PUERTO || 8080);
const CARPETA_PUBLICA = path.join(__dirname, '..', 'public');

// Tipos de mensaje que van dirigidos a otro usuario y que el nodo solo enruta.
const TIPOS_DIRIGIDOS = ['mensaje', 'oferta', 'respuesta', 'candidato', 'colgar'];
// Nombres válidos: letras, números, guion y guion bajo, de 1 a 20 caracteres.
const NOMBRE_VALIDO = /^[a-zA-Z0-9_-]{1,20}$/;

const directorio = new Directorio(NODO);

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
    usuarios_locales: directorio.nombresLocales(),
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

/** Avisa a todos los clientes locales quién está conectado. */
function difundirPresencia() {
  const aviso = { tipo: 'presencia', usuarios: directorio.listaCompleta() };
  for (const usuario of directorio.nombresLocales()) enviar(directorio.socketDe(usuario), aviso);
}

/** Texto corto para el log: el texto del chat o solo el tipo (no se loguea el SDP completo). */
function resumen(m) {
  return m.tipo === 'mensaje' ? `${m.de} -> ${m.para}: ${m.texto}` : `${m.de} -> ${m.para} (${m.tipo})`;
}

/**
 * Lleva un mensaje dirigido a su destinatario.
 * En esta versión solo entrega a usuarios del mismo nodo.
 */
function enrutar(mensaje, socketOrigen) {
  const destino = directorio.dondeEsta(mensaje.para);
  if (destino === 'local') {
    enviar(directorio.socketDe(mensaje.para), mensaje);
    log('ENTREGADO', resumen(mensaje));
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
  difundirPresencia();
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
  difundirPresencia();
}

// ---------------------------------------------------------------- Arranque

const servidorHttp = http.createServer(atenderHttp);
const wsClientes = new WebSocketServer({ noServer: true });

// Las conexiones WebSocket llegan como un "upgrade" de HTTP; aquí se aceptan solo en /ws.
servidorHttp.on('upgrade', (req, socket, cabeza) => {
  const ruta = new URL(req.url, 'http://nodo').pathname;
  if (ruta === '/ws') {
    wsClientes.handleUpgrade(req, socket, cabeza, (ws) => wsClientes.emit('connection', ws));
  } else {
    socket.destroy();
  }
});

wsClientes.on('connection', (socket) => {
  socket.on('message', (datos) => alMensajeDeCliente(socket, datos.toString()));
  socket.on('close', () => alCerrarCliente(socket));
});

servidorHttp.listen(PUERTO, () => log('INICIO', `escuchando en el puerto ${PUERTO}`));

// docker compose down envía SIGTERM: se cierra ordenadamente en vez de esperar 10 s.
for (const senal of ['SIGTERM', 'SIGINT']) {
  process.on(senal, () => {
    log('APAGADO', `señal ${senal}`);
    servidorHttp.close();
    process.exit(0);
  });
}
