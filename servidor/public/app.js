/**
 * app.js: núcleo del cliente web.
 *
 * - Conecta el navegador a SU nodo por WebSocket (/ws) y registra al usuario.
 * - Muestra quién está en línea (mensajes "presencia" del nodo).
 * - Chat de texto: los mensajes viajan por el nodo (y por el enlace entre nodos).
 * - Avisos de error y estado de la conexión.
 *
 * Los otros archivos (webrtc.js, llamada.js, archivos.js) usan el objeto App que
 * se define aquí: App.on(tipo, función) para recibir mensajes del nodo,
 * App.enviar(...) para mandarlos y App.guardar(...) para escribir en el chat.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // Elementos de la página que se usan desde el código.
  const ui = {
    login: $('login'), nombre: $('nombre'), entrar: $('entrar'), loginMsg: $('login-msg'),
    app: $('app'), yo: $('yo'), estado: $('estado'), usuarios: $('usuarios'),
    chatTitulo: $('chat-titulo'), mensajes: $('mensajes'), formChat: $('form-chat'), texto: $('texto'),
    archivo: $('archivo'), enviarArchivo: $('enviar-archivo'),
    zonaProgreso: $('zona-progreso'), progreso: $('progreso'), progresoTexto: $('progreso-texto'),
    llamar: $('llamar'), colgar: $('colgar'), silenciar: $('silenciar'), camara: $('camara'),
    videos: $('videos'), local: $('local'), remoto: $('remoto'), remotoNombre: $('remoto-nombre'),
    entrante: $('entrante'), entranteTexto: $('entrante-texto'), contestar: $('contestar'), rechazar: $('rechazar'),
    toast: $('toast'),
  };

  const App = {
    ui,
    miNombre: '',
    conversacion: null,     // usuario con el que está abierto el chat
    usuarios: [],           // otros usuarios en línea: [{ usuario, nodo }]
    manejadores: {},        // tipo de mensaje -> lista de funciones que lo atienden
    alDesconectarse: [],    // funciones(usuario) que se llaman cuando alguien sale
    alCambiarChat: [],      // funciones(usuario) que se llaman al abrir otro chat
  };
  window.App = App;

  let ws = null;
  let registrado = false;
  let motivoRechazo = '';
  const chats = new Map();  // usuario -> lista de entradas del chat
  let temporizadorToast = null;

  // ------------------------------------------------------------ utilidades

  /** Hora corta, p. ej. 18:05. */
  App.hora = () => new Date().toTimeString().slice(0, 5);

  /** Registra una función para un tipo de mensaje que llega del nodo. */
  App.on = (tipo, funcion) => {
    (App.manejadores[tipo] = App.manejadores[tipo] || []).push(funcion);
  };

  /** Envía un objeto JSON al nodo. Devuelve false si no hay conexión. */
  App.enviar = (objeto) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(objeto));
    return true;
  };

  /** Muestra un aviso breve en la parte de abajo de la pantalla. */
  App.mostrarAviso = (texto) => {
    ui.toast.textContent = texto;
    ui.toast.hidden = false;
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(() => { ui.toast.hidden = true; }, 6000);
  };

  /** true si el usuario está en línea según el último aviso de presencia. */
  App.estaEnLinea = (usuario) => App.usuarios.some((u) => u.usuario === usuario);

  /** Cambia el indicador de conexión de la parte superior. */
  function ponerEstado(texto, clase) {
    ui.estado.textContent = texto;
    ui.estado.className = clase;
  }

  // ------------------------------------------------------------ chat

  /**
   * Agrega una entrada al chat con "otro" y la dibuja si ese chat está abierto.
   * entrada = { tipo: 'texto' | 'archivo' | 'sistema', de, texto?, nombre?, mime?, url?, hora }
   */
  App.guardar = (otro, entrada) => {
    if (!chats.has(otro)) chats.set(otro, []);
    chats.get(otro).push(entrada);
    if (otro === App.conversacion) dibujarMensajes();
    else if (entrada.tipo !== 'sistema') App.mostrarAviso(`Nuevo mensaje de ${otro}`);
  };

  /** Agrega un aviso del sistema solo si ya existe un chat con ese usuario. */
  App.avisoEnChat = (otro, texto) => {
    if (chats.has(otro) || otro === App.conversacion) {
      App.guardar(otro, { tipo: 'sistema', de: otro, texto, hora: App.hora() });
    }
  };

  /** Dibuja todos los mensajes del chat abierto. */
  function dibujarMensajes() {
    ui.mensajes.textContent = '';
    for (const e of chats.get(App.conversacion) || []) {
      const div = document.createElement('div');
      const mio = e.de === App.miNombre;
      div.className = 'linea ' + (e.tipo === 'sistema' ? 'sistema' : mio ? 'mia' : 'otra');
      const quien = mio ? 'Yo' : e.de;

      if (e.tipo === 'texto') {
        div.textContent = `[${e.hora}] ${quien}: ${e.texto}`;   // textContent: nunca se interpreta como HTML
      } else if (e.tipo === 'archivo') {
        div.append(`[${e.hora}] ${quien}: ${e.nombre} `);
        div.append(vistaPrevia(e));
        const enlace = document.createElement('a');
        enlace.href = e.url;
        enlace.download = e.nombre;
        enlace.textContent = 'Descargar';
        div.append(enlace);
      } else {
        div.textContent = `[${e.hora}] ${e.texto}`;
      }
      ui.mensajes.append(div);
    }
    ui.mensajes.scrollTop = ui.mensajes.scrollHeight;
  }

  /** Imagen, video o audio para reproducir el archivo dentro del chat. */
  function vistaPrevia(e) {
    const tipo = (e.mime || '').split('/')[0];
    let elemento;
    if (tipo === 'image') {
      elemento = document.createElement('img');
      elemento.alt = e.nombre;
    } else if (tipo === 'video' || tipo === 'audio') {
      elemento = document.createElement(tipo);
      elemento.controls = true;
    } else {
      return document.createTextNode('');
    }
    elemento.src = e.url;
    return elemento;
  }

  /** Abre el chat con un usuario. */
  function abrirChat(otro) {
    App.conversacion = otro;
    ui.chatTitulo.textContent = `Chat con ${otro}`;
    ui.texto.disabled = false;
    ui.texto.focus();
    dibujarUsuarios();
    dibujarMensajes();
    App.alCambiarChat.forEach((f) => f(otro));
  }

  /** Envía el texto escrito al usuario del chat abierto. */
  function enviarTexto(evento) {
    evento.preventDefault();
    const texto = ui.texto.value.trim();
    const para = App.conversacion;
    if (!para || !texto) return;
    if (!App.estaEnLinea(para)) return App.mostrarAviso(`${para} no está conectado.`);
    if (!App.enviar({ tipo: 'mensaje', para, texto })) return App.mostrarAviso('Sin conexión con el nodo: el mensaje no se envió.');
    App.guardar(para, { tipo: 'texto', de: App.miNombre, texto, hora: App.hora() });
    ui.texto.value = '';
  }

  // ------------------------------------------------------------ usuarios en línea

  /** Actualiza la lista con el aviso de presencia y detecta quién se fue. */
  function actualizarUsuarios(lista) {
    const otros = lista.filter((u) => u.usuario !== App.miNombre);
    const ahora = new Set(otros.map((u) => u.usuario));
    const antes = App.usuarios.map((u) => u.usuario);
    App.usuarios = otros;

    for (const usuario of antes) {
      if (!ahora.has(usuario)) {
        App.avisoEnChat(usuario, `${usuario} se desconectó.`);
        App.alDesconectarse.forEach((f) => f(usuario));
      }
    }
    dibujarUsuarios();
    if (App.conversacion) App.alCambiarChat.forEach((f) => f(App.conversacion));
  }

  /** Dibuja la lista de usuarios en línea (con el nodo de cada uno). */
  function dibujarUsuarios() {
    ui.usuarios.textContent = '';
    if (App.usuarios.length === 0) {
      const p = document.createElement('p');
      p.className = 'vacio';
      p.textContent = 'No hay nadie más conectado.';
      ui.usuarios.append(p);
    }
    for (const u of App.usuarios) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'usuario' + (u.usuario === App.conversacion ? ' activo' : '');
      const nombre = document.createElement('span');
      nombre.textContent = u.usuario;
      const nodo = document.createElement('small');
      nodo.textContent = u.nodo;
      boton.append(nombre, nodo);
      boton.addEventListener('click', () => abrirChat(u.usuario));
      ui.usuarios.append(boton);
    }
  }

  // ------------------------------------------------------------ conexión con el nodo

  /** Valida el nombre y se conecta. */
  function entrar() {
    const nombre = ui.nombre.value.trim();
    if (!/^[a-zA-Z0-9_-]{1,20}$/.test(nombre)) {
      ui.loginMsg.textContent = 'Use de 1 a 20 letras, números, - o _.';
      return;
    }
    App.miNombre = nombre;
    ui.loginMsg.textContent = '';
    motivoRechazo = '';
    conectar();
  }

  /** Abre el WebSocket con el nodo que sirvió esta página. */
  function conectar() {
    const protocolo = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocolo}://${location.host}/ws`);
    ponerEstado('Conectando…', 'aviso');

    ws.onopen = () => App.enviar({ tipo: 'registro', usuario: App.miNombre });
    ws.onmessage = (evento) => recibir(JSON.parse(evento.data));
    ws.onclose = () => {
      if (registrado) {
        // Ya estaba dentro: el nodo se cayó o se reinició. Se reintenta cada 2 s.
        ponerEstado('Sin conexión con el nodo. Reintentando…', 'error');
        actualizarUsuarios([]);
        setTimeout(conectar, 2000);
      } else {
        ui.app.hidden = true;
        ui.login.hidden = false;
        ui.loginMsg.textContent = motivoRechazo || 'No se pudo conectar con el nodo.';
      }
    };
  }

  /** Atiende cada mensaje que llega del nodo. */
  function recibir(m) {
    if (m.tipo === 'registrado') {
      registrado = true;
      ui.login.hidden = true;
      ui.app.hidden = false;
      ui.yo.textContent = `${m.usuario} (${m.nodo})`;
      ponerEstado(`Conectado al nodo ${m.nodo}`, 'ok');
    } else if (m.tipo === 'presencia') {
      actualizarUsuarios(m.usuarios);
    } else if (m.tipo === 'mensaje') {
      App.guardar(m.de, { tipo: 'texto', de: m.de, texto: m.texto, hora: App.hora() });
    } else if (m.tipo === 'error') {
      if (!registrado) {
        motivoRechazo = m.motivo;   // p. ej. el nombre ya está en uso
        ws.close();
      } else {
        App.mostrarAviso(m.motivo);
      }
    }
    // Los demás tipos (llamada, oferta, respuesta, candidato, colgar) los atienden los otros módulos.
    (App.manejadores[m.tipo] || []).forEach((f) => f(m));
  }

  // ------------------------------------------------------------ eventos de la página

  ui.entrar.addEventListener('click', entrar);
  ui.nombre.addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
  ui.formChat.addEventListener('submit', enviarTexto);
})();
