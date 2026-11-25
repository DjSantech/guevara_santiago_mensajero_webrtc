# Bitácora del laboratorio: mensajero WebRTC

Una entrada por sesión de trabajo: fecha, tiempo dedicado, qué se hizo, qué problema apareció y cómo se resolvió, y para qué se usó IA.

---

## Sesión 1. 2026-11-18. Investigación y arquitectura

- **Tiempo dedicado:** 2 horas
- **Qué se hizo:**
  - Leí el enunciado del laboratorio y la transcripción de la clase del 12 de noviembre (códecs H.264, VP9, AV1 y la lectura de MirrorFly).
  - Elegí Docker como plataforma de los nodos y escribí el informe de investigación (bloques A a G) con fuentes: RFC del IETF, especificaciones del W3C y del WHATWG, documentación oficial de Docker y Node.js, y dos artículos (Felter et al. 2015; Chen et al. 2018).
  - Hice los diagramas UML en PlantUML (`docs/uml/`): componentes, despliegue, secuencia del mensaje entre nodos, secuencia de la videollamada, secuencia del envío de archivos, estados de la conexión y bosquejo de la interfaz.
  - Generé el PDF del informe (`docs/informe/informe_investigacion.pdf`, 10 páginas).
- **Problemas y soluciones:**
  - PlantUML necesita Java y no lo tengo instalado. Lo resolví corriendo la imagen oficial `plantuml/plantuml` en Docker, que además deja la generación de diagramas reproducible.
  - Al poner dos diagramas lado a lado, el de envío de archivos quedaba ilegible en el PDF. Lo pasé a ancho completo; el informe quedó en 10 páginas, el máximo permitido.
  - No tengo pandoc para pasar el informe a PDF. Lo escribí en HTML y lo imprimí a PDF con Microsoft Edge en modo sin interfaz.
- **Uso de IA:** usé un asistente de IA para ordenar las preguntas por bloque, proponer una primera versión de los textos y de los diagramas PlantUML, y revisar el formato del PDF. Revisé y ajusté las respuestas y comprobé que cada afirmación técnica tuviera su fuente (RFC, W3C o documentación oficial).

---

## Sesión 2. 2026-11-18. Primer avance sin interfaz

- **Tiempo dedicado:** 2 horas
- **Qué se hizo** (en el orden de los commits, después de subir el informe):
  1. Servidor de un nodo en Node.js con la librería `ws`: HTTP (`/`, `/salud`, `/usuarios`), WebSocket `/ws` para clientes y directorio de usuarios. Lo probé con dos clientes en el mismo nodo.
  2. Enlace entre nodos (`enlace.js`): cada nodo abre una conexión WebSocket hacia el otro por nombre (`PAR_URL`), comparte su lista de usuarios (presencia) y reenvía los mensajes cuyo destinatario está en el otro nodo. Lo probé con dos nodos en local (puertos 9091 y 9092) antes de pasarlo a Docker.
  3. `Dockerfile` (`node:22-alpine`, usuario `node`, `HEALTHCHECK`) y `docker-compose.yml` con dos servicios y la red bridge `mensajero-red`.
  4. Cliente de consola interactivo y prueba automática (`prueba-avance.js`) que comprueba registro, presencia, mensajes en ambos sentidos y error con un destinatario inexistente.
  5. README parcial con los comandos para ejecutar y probar el avance.
- **Pruebas realizadas:**
  - La prueba automática pasa desde el anfitrión (puertos 8081 y 8082) y desde dentro del contenedor `nodo-a` usando los nombres `nodo-a` y `nodo-b`.
  - `nslookup nodo-b` dentro de `nodo-a` devuelve la IP del contenedor (DNS interno de Docker).
  - Al detener `nodo-b`, `nodo-a` registra la caída y `/salud` muestra `par_conectado: false`; al iniciarlo de nuevo se reconectan solos.
  - Cloné el repositorio en una carpeta vacía, borré la imagen y lo levanté con `docker compose up --build`: los dos nodos quedan `healthy` y la prueba pasa.
- **Problemas y soluciones:**
  - El primer nodo que arranca no encuentra al otro (`ECONNREFUSED`). Se resolvió con reintento cada 2 s en el enlace; el log avisa solo la primera falla para no llenarse.
  - `docker compose build` fallaba en Windows con `additional privileges requested: pass "--allow=fs.read=servidor\Dockerfile"`. Con `--verbose` vi que Compose 5 construye con `bake` y le pasa la carpeta como `c:\...` (minúscula, como la abre VS Code) y el Dockerfile como `C:\...`; `bake` compara distinguiendo mayúsculas. Se resuelve entrando a la carpeta con `C:` en mayúscula. Quedó documentado en el README.
  - Si los mensajes que llegan del par se reenviaran otra vez, podrían quedar dando vueltas entre los nodos. Lo evité así: lo que llega por `/nodo` solo se entrega localmente, nunca se reenvía.
  - `docker compose down` tardaba porque Node, como proceso principal del contenedor, no atiende `SIGTERM` por defecto. Agregué un manejador que cierra el servidor.
- **Uso de IA:** usé un asistente de IA para proponer la estructura del servidor y del enlace entre nodos, escribir una primera versión del código comentado y de las pruebas, y diagnosticar el error de `bake`. Ejecuté y verifiqué cada paso (pruebas, logs, caída de un nodo y clon limpio) antes de cada commit.
- **Pendiente para la fase 3:** interfaz web, videollamada (oferta, respuesta y candidatos ya se enrutan), archivos por `RTCDataChannel` y correcciones del seguimiento del 24 de noviembre.

---

## Sesión 3. 2026-11-25. Fase 3: interfaz, videollamada y archivos

- **Tiempo dedicado:** (completar)
- **Qué se hizo** (en el orden de los commits):
  1. Interfaz web (`index.html` y `app.js`): ingreso con nombre, usuarios en línea con su nodo, chat de texto por la señalización e indicador de conexión con reconexión automática.
  2. Videollamada (`webrtc.js` y `llamada.js`): un `RTCPeerConnection` por usuario con el patrón *perfect negotiation* del W3C, aviso de llamada con Contestar y Rechazar, silenciar micrófono, apagar cámara y colgar. En el servidor se agregó el tipo `llamada` a los mensajes que se enrutan.
  3. Archivos (`archivos.js`): `RTCDataChannel` confiable, fragmentos de 16 KiB, pausa si `bufferedAmount` pasa de 1 MiB, barra de progreso, verificación SHA-256 y vista previa de imágenes, audio y video.
  4. Prueba de extremo a extremo (`pruebas/prueba-navegador.mjs`): Chrome sin ventana con perfil temporal y cámara simulada, controlado por el protocolo de depuración de Chrome.
  5. UML actualizado (componentes con los archivos reales y secuencia de la llamada como quedó), documento final en PDF con capturas y README completo.
- **Pruebas realizadas:** la prueba en navegador pasa completa: chat entre nodos, video en ambos sentidos, silenciar, apagar cámara, colgar, segunda llamada, archivo de 20 MB idéntico (SHA-256) en unos 5 s e imagen en el chat. La de errores también pasa: cámara denegada, archivo interrumpido y desconexión del otro. En los logs se ven la oferta, la respuesta y los candidatos cruzando de un nodo al otro.
- **Problemas y soluciones:**
  - La extensión de Chrome para automatizar el navegador no estaba conectada. Lo resolví lanzando un Chrome aparte sin ventana y controlándolo por el protocolo de depuración, con el WebSocket que ya trae Node: no hubo que instalar nada.
  - Al que contesta le llegaban el audio y el video del que llama antes de pulsar Contestar, y se perdían. Ahora se guarda el último video recibido de cada usuario y se muestra al contestar.
  - Al desconectarse alguien, el cierre de la llamada creaba una conexión nueva vacía, porque usaba `obtenerPar`. Se agregó `buscarPar`, que solo busca.
  - **El canal de archivos no abría después de colgar.** Al tomar las capturas, un archivo enviado justo después de colgar nunca salía. Diagnóstico registrando el estado de la conexión segundo a segundo:
    1. Una oferta llegaba mientras todavía se aplicaba la respuesta anterior; el navegador seguía en `have-local-offer`, lo tomaba como choque y el lado no cortés la ignoraba. Solución: cola de señalización por usuario, para procesar los mensajes en orden.
    2. Además, quitar las pistas con `removeTrack` en los dos lados a la vez metía a Chrome en un ciclo infinito de renegociaciones (cientos en pocos segundos). Solución: al colgar se usa `replaceTrack(null)`, que no renegocia, y el canal de datos se crea junto con la conexión. Quedó en una sola renegociación, y el caso se agregó a la prueba automática.
  - El diagrama de estados mostraba un reinicio de ICE que el código no hacía. Se implementó `restartIce()` cuando la conexión falla.
- **Cambios frente a la arquitectura inicial** (detallados en el documento final, sección 3.4): nuevo mensaje `llamada`; la oferta del que llama sale antes de contestar; el canal de datos nace con la conexión; `replaceTrack` al colgar; no se implementó HTTPS con Caddy porque en `localhost` la cámara ya funciona; no se configuró TURN.
- **Uso de IA:** usé un asistente de IA para escribir la primera versión de la interfaz y de los módulos WebRTC, armar la prueba en Chrome sin ventana, diagnosticar el error del canal de archivos y redactar el documento final. Revisé el comportamiento con las pruebas automáticas y los logs antes de cada commit.
- **Pendiente:** grabar el video de demostración (máx. 5 min) y poner el enlace en el README; atender las correcciones del seguimiento del 24 de noviembre si llegan como issues.
