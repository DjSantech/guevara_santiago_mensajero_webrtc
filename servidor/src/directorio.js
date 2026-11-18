/**
 * Directorio de usuarios: sabe quién está conectado y en qué nodo.
 *
 * - Usuarios LOCALES: conectados a este nodo. Se guarda su WebSocket para
 *   poder entregarles mensajes.
 * - Usuarios REMOTOS: conectados al otro nodo. Solo se guarda el nombre del
 *   nodo donde están; la lista llega por el enlace entre nodos (mensaje "presencia").
 */
class Directorio {
  constructor(nombreNodo) {
    this.nombreNodo = nombreNodo;
    this.locales = new Map();  // usuario -> WebSocket del cliente
    this.remotos = new Map();  // usuario -> nombre del nodo donde está
  }

  /** Registra un usuario conectado a este nodo. */
  agregarLocal(usuario, socket) {
    this.locales.set(usuario, socket);
  }

  /** Quita un usuario local (se desconectó). */
  quitarLocal(usuario) {
    this.locales.delete(usuario);
  }

  /** Devuelve el WebSocket de un usuario local, o undefined. */
  socketDe(usuario) {
    return this.locales.get(usuario);
  }

  /** true si el nombre ya está en uso en cualquiera de los dos nodos. */
  existe(usuario) {
    return this.locales.has(usuario) || this.remotos.has(usuario);
  }

  /**
   * Dice dónde está un usuario.
   * @returns {'local' | string | null} 'local', el nombre del otro nodo, o null si no está.
   */
  dondeEsta(usuario) {
    if (this.locales.has(usuario)) return 'local';
    if (this.remotos.has(usuario)) return this.remotos.get(usuario);
    return null;
  }

  /** Reemplaza la lista de usuarios de un nodo remoto con la que él mismo envió. */
  reemplazarRemotos(nodo, usuarios) {
    this.quitarRemotosDe(nodo);
    for (const usuario of usuarios) this.remotos.set(usuario, nodo);
  }

  /** Olvida a todos los usuarios de un nodo remoto (por ejemplo, si ese nodo se cayó). */
  quitarRemotosDe(nodo) {
    for (const [usuario, dondeEsta] of this.remotos) {
      if (dondeEsta === nodo) this.remotos.delete(usuario);
    }
  }

  /** Nombres de los usuarios conectados a este nodo. */
  nombresLocales() {
    return [...this.locales.keys()].sort();
  }

  /** Lista completa para los clientes: [{ usuario, nodo }], ordenada por nombre. */
  listaCompleta() {
    const lista = [];
    for (const usuario of this.locales.keys()) lista.push({ usuario, nodo: this.nombreNodo });
    for (const [usuario, nodo] of this.remotos) lista.push({ usuario, nodo });
    return lista.sort((a, b) => a.usuario.localeCompare(b.usuario));
  }
}

module.exports = { Directorio };
