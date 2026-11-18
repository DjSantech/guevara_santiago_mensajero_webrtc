/**
 * Registro de eventos (logs) del nodo.
 *
 * Todo se escribe en la salida estándar. Docker guarda esa salida, así que los
 * logs de cada nodo se ven con:  docker compose logs -f nodo-a
 *
 * Formato de cada línea:
 *   2026-11-18T23:10:05.120Z [nodo-a] ENTREGADO   ana -> beto: hola
 */

const NODO = process.env.NODO_NOMBRE || 'nodo-local';

/**
 * Escribe una línea de log.
 * @param {string} evento  palabra corta en mayúsculas (REGISTRO, REENVIADO, ERROR...)
 * @param {string} detalle texto libre con lo que pasó
 */
function log(evento, detalle) {
  const hora = new Date().toISOString();
  console.log(`${hora} [${NODO}] ${evento.padEnd(11)} ${detalle}`);
}

module.exports = { log, NODO };
