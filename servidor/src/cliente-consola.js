/**
 * Cliente de consola del mensajero (primer avance, sin interfaz gráfica).
 *
 * Uso:
 *   node src/cliente-consola.js <url-del-nodo> <usuario>
 *   node src/cliente-consola.js ws://localhost:8081/ws ana
 *
 * Dentro de un contenedor (se conecta a su propio nodo por nombre):
 *   docker compose exec nodo-a node src/cliente-consola.js ws://nodo-a:8080/ws ana
 *
 * Comandos que se escriben en la consola:
 *   beto hola, ¿cómo vas?   -> envía "hola, ¿cómo vas?" al usuario beto
 *   /usuarios               -> muestra quién está conectado y en qué nodo
 *   /salir                  -> cierra el cliente
 */

const readline = require('node:readline');
const WebSocket = require('ws');

const [url, usuario] = process.argv.slice(2);
if (!url || !usuario) {
  console.log('Uso: node src/cliente-consola.js <url-del-nodo> <usuario>');
  console.log('Ejemplo: node src/cliente-consola.js ws://localhost:8081/ws ana');
  process.exit(1);
}

const socket = new WebSocket(url);
const consola = readline.createInterface({ input: process.stdin, output: process.stdout });

/** Hora corta para mostrar en pantalla, p. ej. 18:52:09. */
function hora(iso) {
  return (iso ? new Date(iso) : new Date()).toTimeString().slice(0, 8);
}

/** Muestra lo que llega del nodo de forma legible. */
function mostrar(mensaje) {
  switch (mensaje.tipo) {
    case 'registrado':
      console.log(`* Conectado como ${mensaje.usuario} en ${mensaje.nodo}. Escriba: <usuario> <mensaje>`);
      break;
    case 'presencia':
      console.log('* En línea: ' + mensaje.usuarios.map((u) => `${u.usuario} (${u.nodo})`).join(', '));
      break;
    case 'mensaje':
      console.log(`[${hora(mensaje.ts)}] ${mensaje.de} (vía ${mensaje.nodo_origen}): ${mensaje.texto}`);
      break;
    case 'error':
      console.log(`! Error: ${mensaje.motivo}`);
      break;
    default:
      console.log('< ' + JSON.stringify(mensaje));
  }
}

socket.on('open', () => socket.send(JSON.stringify({ tipo: 'registro', usuario })));
socket.on('message', (datos) => mostrar(JSON.parse(datos.toString())));
socket.on('close', () => {
  console.log('* Conexión cerrada por el nodo.');
  process.exit(0);
});
socket.on('error', (error) => {
  console.log(`! No se pudo conectar a ${url}: ${error.message}`);
  process.exit(1);
});

// Cada línea escrita se convierte en un mensaje JSON.
consola.on('line', (linea) => {
  const texto = linea.trim();
  if (!texto) return;
  if (texto === '/salir') return socket.close();
  if (texto === '/usuarios') return socket.send(JSON.stringify({ tipo: 'lista' }));

  const espacio = texto.indexOf(' ');
  if (espacio === -1) return console.log('! Formato: <usuario> <mensaje>');
  const para = texto.slice(0, espacio);
  const contenido = texto.slice(espacio + 1);
  socket.send(JSON.stringify({ tipo: 'mensaje', para, texto: contenido }));
});
