/**
 * Enlace SALIENTE hacia el nodo par.
 *
 * Cada nodo abre una conexión WebSocket hacia el otro usando su NOMBRE
 * (por ejemplo ws://nodo-b:8080/nodo). El DNS interno de Docker traduce ese
 * nombre a la IP actual del contenedor, así que no hay ninguna IP en el código.
 *
 * Por esta conexión el nodo ENVÍA al par:
 *   - su lista de usuarios   {"tipo":"presencia","nodo":"nodo-a","usuarios":["ana"]}
 *   - mensajes para usuarios que están allá   {"tipo":"reenvio","mensaje":{...}}
 *
 * Lo que el par le envía a este nodo llega por la conexión ENTRANTE (/nodo),
 * que atiende servidor.js. Así cada nodo es cliente del otro para enviar y
 * servidor para recibir, y los dos lados funcionan igual.
 *
 * Si el par todavía no arrancó o se cae, se reintenta cada 2 segundos.
 */

const WebSocket = require('ws');
const { log } = require('./registro');

const REINTENTO_MS = 2000;

class EnlaceNodos {
  /**
   * @param {string} urlPar     dirección del nodo par, p. ej. ws://nodo-b:8080/nodo
   * @param {Function} alConectar  se llama cada vez que el enlace queda abierto
   */
  constructor(urlPar, alConectar) {
    this.urlPar = urlPar;
    this.alConectar = alConectar;
    this.socket = null;
    this.conectado = false;
    this.fallaAvisada = false;  // para no llenar el log con un error cada 2 s
  }

  /** Abre la conexión con el par y programa el reintento si se cierra. */
  conectar() {
    if (!this.urlPar) {
      log('ENLACE', 'sin PAR_URL: este nodo trabaja solo');
      return;
    }
    const socket = new WebSocket(this.urlPar);
    this.socket = socket;

    socket.on('open', () => {
      this.conectado = true;
      this.fallaAvisada = false;
      log('ENLACE', `conectado al par ${this.urlPar}`);
      this.alConectar();
    });

    socket.on('error', (error) => {
      if (!this.conectado && !this.fallaAvisada) {
        log('ENLACE', `no se pudo conectar a ${this.urlPar} (${error.code || error.message}); reintento cada 2 s`);
        this.fallaAvisada = true;
      }
    });

    socket.on('close', () => {
      if (this.conectado) log('ENLACE', `se perdió la conexión con ${this.urlPar}`);
      this.conectado = false;
      setTimeout(() => this.conectar(), REINTENTO_MS);
    });
  }

  /**
   * Envía un objeto JSON al par.
   * @returns {boolean} false si el enlace no está abierto (el mensaje no salió).
   */
  enviar(objeto) {
    if (!this.conectado) return false;
    this.socket.send(JSON.stringify(objeto));
    return true;
  }
}

module.exports = { EnlaceNodos };
