/**
 * Prueba automática del primer avance: comprueba que dos usuarios conectados a
 * NODOS DISTINTOS se ven y se mandan mensajes en los dos sentidos.
 *
 * Uso desde el anfitrión (con los nodos levantados por docker compose):
 *   node src/prueba-avance.js
 *   node src/prueba-avance.js ws://localhost:8081/ws ws://localhost:8082/ws
 *
 * Uso desde dentro de un contenedor (los nodos se buscan por NOMBRE):
 *   docker compose exec nodo-a node src/prueba-avance.js ws://nodo-a:8080/ws ws://nodo-b:8080/ws
 *
 * Termina con código 0 si todo pasa y 1 si algo falla.
 */

const WebSocket = require('ws');

const URL_A = process.argv[2] || 'ws://localhost:8081/ws';
const URL_B = process.argv[3] || 'ws://localhost:8082/ws';
const ESPERA_MS = 5000;  // tiempo máximo para cada paso

// Nombres con un sufijo aleatorio para no chocar con usuarios que ya estén conectados.
const sufijo = Math.random().toString(36).slice(2, 6);
const ANA = `ana_${sufijo}`;
const BETO = `beto_${sufijo}`;

let fallos = 0;

/** Imprime el resultado de una comprobación. */
function comprobar(descripcion, ok, detalle = '') {
  console.log(`${ok ? '  OK  ' : ' FALLA'}  ${descripcion}${detalle ? '  ->  ' + detalle : ''}`);
  if (!ok) fallos++;
}

/** Conecta un usuario a un nodo y espera la confirmación de registro. */
function conectar(url, usuario) {
  return new Promise((resolver, rechazar) => {
    const socket = new WebSocket(url);
    socket.recibidos = [];  // todo lo que llega queda aquí para revisarlo después
    socket.on('message', (datos) => socket.recibidos.push(JSON.parse(datos.toString())));
    socket.on('open', () => socket.send(JSON.stringify({ tipo: 'registro', usuario })));
    socket.on('error', rechazar);
    esperarQue(() => socket.recibidos.some((m) => m.tipo === 'registrado'))
      .then(() => resolver(socket))
      .catch(() => rechazar(new Error(`${usuario} no recibió "registrado" de ${url}`)));
  });
}

/** Espera hasta que una condición se cumpla o se acabe el tiempo. */
function esperarQue(condicion) {
  return new Promise((resolver, rechazar) => {
    const inicio = Date.now();
    const revisar = () => {
      if (condicion()) return resolver(true);
      if (Date.now() - inicio > ESPERA_MS) return rechazar(new Error('tiempo agotado'));
      setTimeout(revisar, 50);
    };
    revisar();
  });
}

/** true si el socket ya recibió una presencia donde aparece el usuario indicado. */
function vePresenciaDe(socket, usuario) {
  return socket.recibidos.some((m) => m.tipo === 'presencia' && m.usuarios.some((u) => u.usuario === usuario));
}

/** Busca un mensaje de chat recibido con ese texto. */
function mensajeCon(socket, texto) {
  return socket.recibidos.find((m) => m.tipo === 'mensaje' && m.texto === texto);
}

async function main() {
  console.log(`Prueba del primer avance\n  nodo A: ${URL_A}\n  nodo B: ${URL_B}\n`);

  const ana = await conectar(URL_A, ANA);
  comprobar(`${ANA} se registró en el nodo A`, true, ana.recibidos[0].nodo);
  const beto = await conectar(URL_B, BETO);
  comprobar(`${BETO} se registró en el nodo B`, true, beto.recibidos[0].nodo);

  const seVen = await esperarQue(() => vePresenciaDe(ana, BETO) && vePresenciaDe(beto, ANA)).catch(() => false);
  comprobar('cada uno ve al otro en la lista de presencia (los nodos comparten usuarios)', seVen);

  const ida = `hola desde A (${sufijo})`;
  ana.send(JSON.stringify({ tipo: 'mensaje', para: BETO, texto: ida }));
  await esperarQue(() => mensajeCon(beto, ida)).catch(() => false);
  const m1 = mensajeCon(beto, ida);
  comprobar('mensaje del nodo A llega al nodo B', Boolean(m1), m1 && `de=${m1.de}, nodo_origen=${m1.nodo_origen}`);

  const vuelta = `hola desde B (${sufijo})`;
  beto.send(JSON.stringify({ tipo: 'mensaje', para: ANA, texto: vuelta }));
  await esperarQue(() => mensajeCon(ana, vuelta)).catch(() => false);
  const m2 = mensajeCon(ana, vuelta);
  comprobar('mensaje del nodo B llega al nodo A', Boolean(m2), m2 && `de=${m2.de}, nodo_origen=${m2.nodo_origen}`);

  ana.send(JSON.stringify({ tipo: 'mensaje', para: 'nadie_xyz', texto: 'prueba' }));
  const hayError = await esperarQue(() => ana.recibidos.some((m) => m.tipo === 'error')).catch(() => false);
  comprobar('un destinatario inexistente devuelve error', hayError);

  ana.close();
  beto.close();
  console.log(fallos === 0 ? '\nResultado: todas las pruebas pasaron.' : `\nResultado: ${fallos} prueba(s) fallaron.`);
  console.log('Revise los logs con: docker compose logs nodo-a nodo-b');
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((error) => {
  console.log(` FALLA  ${error.message}`);
  console.log('¿Están levantados los nodos? Pruebe: docker compose ps');
  process.exit(1);
});
