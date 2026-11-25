/**
 * webrtc.js: conexión directa entre dos navegadores (RTCPeerConnection).
 *
 * Hay una conexión ("par") por cada usuario con el que se habla. La señalización
 * (oferta, respuesta y candidatos ICE) viaja por el nodo con App.enviar; los
 * medios y los archivos van directo entre navegadores.
 *
 * Se usa el patrón "perfect negotiation" de la especificación del W3C: cada vez
 * que cambia algo (se agrega o quita una pista, se crea un canal de datos), el
 * navegador dispara "negotiationneeded" y se manda una oferta nueva. Si los dos
 * lados mandan oferta al mismo tiempo (choque o "glare"), el lado "cortés"
 * (polite) cede y acepta la del otro.
 *
 * Usa: App.enviar, App.on, App.mostrarAviso.
 * Ofrece: App.obtenerPar(usuario), App.buscarPar(usuario), App.cerrarPar(usuario), App.estadoConexion(usuario),
 *         App.alPista (lista de funciones para pistas remotas) y App.alCanal (canales de datos).
 */
(function () {
  'use strict';

  // STUN público: solo hace falta si los navegadores están en redes distintas.
  const CONFIGURACION = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  const pares = new Map();  // usuario -> { pc, otro, cortes, haciendoOferta, ignorarOferta, candidatosPendientes }
  App.alPista = [];         // funciones(usuario, evento) para cuando llega audio o video
  App.alCanal = [];         // funciones(par, canal) para cuando hay un canal de datos nuevo

  /**
   * Devuelve la conexión con "otro"; si no existe, la crea.
   * Quien la crea por iniciativa propia (llamar o enviar un archivo) abre también el
   * canal de datos "archivos" en ese momento. Así el canal queda negociado desde la
   * primera oferta y nunca hay que agregarlo en medio de una llamada.
   */
  App.obtenerPar = (otro, iniciador = false) => {
    if (pares.has(otro)) return pares.get(otro);

    const pc = new RTCPeerConnection(CONFIGURACION);
    const par = {
      otro,
      pc,
      cortes: App.miNombre < otro,   // regla fija para que los dos lados sepan quién cede
      haciendoOferta: false,
      ignorarOferta: false,
      candidatosPendientes: [],
    };
    pares.set(otro, par);

    // Cada candidato ICE que descubre el navegador se le manda al otro por el nodo.
    pc.onicecandidate = (e) => {
      if (e.candidate) App.enviar({ tipo: 'candidato', para: otro, candidato: e.candidate });
    };

    // Algo cambió (pistas o canal de datos): se crea y se envía una oferta nueva.
    pc.onnegotiationneeded = async () => {
      try {
        par.haciendoOferta = true;
        await pc.setLocalDescription();   // sin argumentos: el navegador crea la oferta
        App.enviar({ tipo: 'oferta', para: otro, sdp: pc.localDescription });
      } catch (err) {
        App.mostrarAviso(`No se pudo negociar con ${otro}: ${err.message}`);
      } finally {
        par.haciendoOferta = false;
      }
    };

    pc.ontrack = (e) => App.alPista.forEach((f) => f(otro, e));
    pc.ondatachannel = (e) => App.alCanal.forEach((f) => f(par, e.channel));

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        App.mostrarAviso(`No fue posible conectar directamente con ${otro}. Se reintenta… (en redes distintas puede hacer falta un servidor TURN).`);
        pc.restartIce();   // pide candidatos nuevos; dispara negotiationneeded y una oferta nueva
      } else if (pc.connectionState === 'disconnected') {
        App.mostrarAviso(`La conexión con ${otro} está inestable…`);
      }
    };

    if (iniciador) {
      const canal = pc.createDataChannel('archivos', { ordered: true });
      App.alCanal.forEach((f) => f(par, canal));
    }
    return par;
  };

  /** Devuelve la conexión con "otro" solo si ya existe (no crea una nueva). */
  App.buscarPar = (otro) => pares.get(otro);

  /** Cierra y olvida la conexión con "otro". */
  App.cerrarPar = (otro) => {
    const par = pares.get(otro);
    if (!par) return;
    par.pc.close();
    pares.delete(otro);
  };

  /** Estado de la conexión con "otro": new, connecting, connected, disconnected, failed, closed. */
  App.estadoConexion = (otro) => (pares.has(otro) ? pares.get(otro).pc.connectionState : 'sin conexión');

  /** Oferta o respuesta que llega del otro navegador (perfect negotiation). */
  async function alDescripcion(m) {
    const par = App.obtenerPar(m.de);
    const pc = par.pc;
    try {
      const esOferta = m.sdp.type === 'offer';
      const choque = esOferta && (par.haciendoOferta || pc.signalingState !== 'stable');
      par.ignorarOferta = !par.cortes && choque;   // el lado no cortés ignora la oferta del otro
      if (par.ignorarOferta) return;

      await pc.setRemoteDescription(m.sdp);        // el cortés que estaba ofreciendo hace "rollback" solo
      for (const c of par.candidatosPendientes.splice(0)) await pc.addIceCandidate(c);
      if (esOferta) {
        await pc.setLocalDescription();            // crea la respuesta
        App.enviar({ tipo: 'respuesta', para: m.de, sdp: pc.localDescription });
      }
    } catch (err) {
      App.mostrarAviso(`Error de señalización con ${m.de}: ${err.message}`);
    }
  }

  /** Candidato ICE que llega del otro navegador. */
  async function alCandidato(m) {
    const par = App.obtenerPar(m.de);
    try {
      // Si todavía no hay descripción remota, el candidato se guarda para después.
      if (!par.pc.remoteDescription) return par.candidatosPendientes.push(m.candidato);
      await par.pc.addIceCandidate(m.candidato);
    } catch (err) {
      if (!par.ignorarOferta) App.mostrarAviso(`Candidato ICE inválido de ${m.de}: ${err.message}`);
    }
  }

  /**
   * Los mensajes de señalización de cada usuario se procesan EN ORDEN, de a uno.
   * Sin esta cola, una oferta nueva podía llegar mientras todavía se aplicaba la
   * respuesta anterior; el navegador seguía en "have-local-offer", lo tomaba como
   * choque y el lado no cortés la ignoraba: el canal de archivos nunca se abría.
   */
  const colas = new Map();   // usuario -> promesa del último mensaje en proceso
  function enCola(manejador) {
    return (m) => {
      const anterior = colas.get(m.de) || Promise.resolve();
      colas.set(m.de, anterior.then(() => manejador(m)));
    };
  }

  App.on('oferta', enCola(alDescripcion));
  App.on('respuesta', enCola(alDescripcion));
  App.on('candidato', enCola(alCandidato));
  App.alDesconectarse.push((usuario) => {
    App.cerrarPar(usuario);
    colas.delete(usuario);
  });
})();
