# Bitácora del laboratorio: mensajero WebRTC

Una entrada por sesión de trabajo: fecha, tiempo dedicado, qué se hizo, qué problema apareció y cómo se resolvió, y para qué se usó IA.

---

## Sesión 1. 2026-11-18. Investigación y arquitectura

- **Tiempo dedicado:** (completar)
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

- **Tiempo dedicado:** (completar)
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
