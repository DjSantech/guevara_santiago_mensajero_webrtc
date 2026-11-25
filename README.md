# Mensajero WebRTC en dos nodos Docker

Laboratorio de Sistemas Distribuidos, Universidad Tecnológica de Pereira.
Autor: Santiago Guevara.

Mensajero web en el que dos usuarios chatean, hacen videollamadas y se envían archivos de cualquier tipo (audio, video, imágenes, documentos). El sistema corre en **dos nodos** (contenedores Docker) conectados por una red virtual:

- Cada usuario se conecta a **su** nodo por WebSocket.
- Los nodos se reenvían la señalización entre sí por un enlace WebSocket que se abre **por nombre** (`ws://nodo-b:8080/nodo`), gracias al DNS interno de Docker.
- El audio, el video y los archivos van **directo entre navegadores** con WebRTC, sin pasar por los nodos.

**Video de demostración (máx. 5 min):** _(pendiente: pegar aquí el enlace)_

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/informe/informe_investigacion.pdf`](docs/informe/informe_investigacion.pdf) | Informe de investigación (bloques A a G) y arquitectura propuesta |
| [`docs/documento/documento_final.pdf`](docs/documento/documento_final.pdf) | Manual técnico con capturas, manual de usuario y explicación del proyecto |
| [`docs/uml/`](docs/uml/) | Diagramas UML en PlantUML (`.puml`) y sus imágenes (`.png`) |
| [`BITACORA.md`](BITACORA.md) | Una entrada por sesión de trabajo |

## Requisitos

- **Docker Desktop** con Docker Compose (probado con Docker 29.9 y Compose 5.6 en Windows 11 con WSL 2). En Linux, Docker Engine con el plugin Compose.
- **Chrome o Edge** en el anfitrión. La cámara y el micrófono se usan desde el navegador, no desde los contenedores.
- **Node.js 22 o más reciente** en el anfitrión, solo para las pruebas automáticas.

## Ejecución

En Windows, abra PowerShell en la carpeta del repositorio **con la `C` mayúscula** en la ruta (ver *Problemas conocidos*):

```powershell
docker compose up --build -d
docker compose ps          # los dos nodos deben decir "healthy"
```

Luego abra en el navegador:

- **http://localhost:8081**: nodo A (por ejemplo, para el usuario «ana»).
- **http://localhost:8082**: nodo B, en otra ventana o en otro perfil del navegador (por ejemplo, para «beto»).

Use `localhost` y no la IP del equipo: el navegador solo permite la cámara en HTTPS o en `localhost`.

Para ver los logs de los dos nodos en vivo: `docker compose logs -f`. Para apagar: `docker compose down`.

## Puertos

| Anfitrión | Contenedor | Servicio |
|---|---|---|
| 8081/TCP | 8080/TCP | `nodo-a`: HTTP (`/`, `/salud`, `/usuarios`) y WebSocket (`/ws`, `/nodo`) |
| 8082/TCP | 8080/TCP | `nodo-b`: lo mismo |
| — | 8080/TCP | enlace entre nodos dentro de la red `mensajero-red` (`nodo-a` ↔ `nodo-b`, sin publicar) |
| puertos UDP efímeros | — | WebRTC directo entre navegadores (SRTP y SCTP/DTLS) |
| 19302/UDP (saliente) | — | STUN público, solo si los navegadores están en redes distintas |

## Uso

1. **Entrar:** escriba un nombre y pulse *Entrar*. En *En línea* aparecen los demás usuarios con su nodo.
2. **Chatear:** pulse un usuario de la lista, escriba y pulse *Enviar*.
3. **Videollamada:** *Llamar*. El otro ve «… te está llamando» y pulsa *Contestar* o *Rechazar*. Durante la llamada están *Silenciar micrófono*, *Apagar cámara* y *Colgar*.
4. **Archivos:** *Seleccionar archivo* y luego *Enviar archivo*. Se ve una barra de progreso. El receptor ve las imágenes y reproduce el audio y el video en el chat, y puede descargar cualquier archivo. El emisor recibe la confirmación con el SHA-256 verificado.

El manual de usuario completo, con capturas, está en el [documento final](docs/documento/documento_final.pdf).

## Pruebas

```bash
# 1. Mensajes entre los nodos desde la consola (dentro de un contenedor, por nombre)
docker compose exec nodo-a node src/prueba-avance.js ws://nodo-a:8080/ws ws://nodo-b:8080/ws

# 2. Sistema completo en un Chrome sin ventana con cámara simulada (desde el anfitrión)
node pruebas/prueba-navegador.mjs todo      # chat, videollamada, archivo de 20 MB e imagen
node pruebas/prueba-navegador.mjs errores   # cámara denegada y archivo interrumpido
```

También se puede chatear desde la consola con el cliente del primer avance:

```bash
docker compose exec nodo-a node src/cliente-consola.js ws://nodo-a:8080/ws ana
docker compose exec nodo-b node src/cliente-consola.js ws://nodo-b:8080/ws beto
```

Y comprobar la red y los nombres:

```bash
docker network inspect mensajero-red
docker compose exec nodo-a nslookup nodo-b
curl http://localhost:8081/salud           # en PowerShell: curl.exe ...
```

## Formato de los mensajes

Mensajes JSON por WebSocket. El nodo completa `de`, `id`, `ts` y `nodo_origen`, así un cliente no puede hacerse pasar por otro.

| Dirección | Mensaje |
|---|---|
| cliente → nodo | `{"tipo":"registro","usuario":"ana"}`, `{"tipo":"lista"}` |
| cliente → nodo → (otro nodo) → cliente | `{"tipo":"mensaje","para":"beto","texto":"hola"}` |
| ídem (señalización WebRTC) | `llamada`, `oferta`, `respuesta`, `candidato`, `colgar`, todos con `"para"` |
| nodo → cliente | `registrado`, `presencia`, `error` |
| nodo → nodo | `{"tipo":"presencia","nodo":"nodo-a","usuarios":["ana"]}` y `{"tipo":"reenvio","mensaje":{...}}` |
| navegador ↔ navegador (canal de datos) | `inicio` (nombre, tamaño, tipo, SHA-256), fragmentos de 16 KiB, `fin`, `recibido` |

## Estructura

```
docker-compose.yml            dos servicios (nodo-a, nodo-b) y la red mensajero-red
servidor/
  Dockerfile                  imagen node:22-alpine, usuario sin privilegios y healthcheck
  src/servidor.js             HTTP + WebSocket (/ws clientes, /nodo enlace) y enrutamiento
  src/enlace.js               conexión saliente al otro nodo, con reintento cada 2 s
  src/directorio.js           usuarios locales y remotos
  src/registro.js             formato de los logs
  src/cliente-consola.js      cliente de consola
  src/prueba-avance.js        prueba automática entre nodos
  public/index.html           interfaz web
  public/app.js               conexión con el nodo, usuarios en línea y chat
  public/webrtc.js            conexión entre navegadores (perfect negotiation)
  public/llamada.js           videollamada
  public/archivos.js          archivos por RTCDataChannel
pruebas/prueba-navegador.mjs  prueba de extremo a extremo en Chrome sin ventana
docs/informe/                 informe de investigación
docs/documento/               documento final, capturas y salidas de terminal
docs/uml/                     diagramas PlantUML
```

Para regenerar los diagramas y el documento final:

```bash
docker run --rm -v "${PWD}/docs/uml:/data" -w /data plantuml/plantuml:1.2024.7 -tpng -charset UTF-8 "*.puml"
node docs/documento/generar-pdf.mjs
```

## Problemas conocidos

- **Windows: `additional privileges requested: pass "--allow=fs.read=servidor\Dockerfile"` al construir.** Docker Compose 5 construye con `bake`, que compara rutas distinguiendo mayúsculas. Si la terminal abrió la carpeta como `c:\...` (minúscula, como hace VS Code), falla. Solución: entrar a la carpeta con la letra en mayúscula, por ejemplo `Set-Location "C:\Users\...\guevara_santiago_mensajero_webrtc"`, y repetir el comando.
- **Puertos 8081 u 8082 ocupados.** Cambie el lado izquierdo de `ports` en `docker-compose.yml`, por ejemplo `"9081:8080"`.
- **Cámara bloqueada si se abre por IP.** Sin HTTPS, el navegador solo permite la cámara en `localhost`. No se implementó HTTPS (Caddy): para usarlo desde otro equipo haría falta.
- **Redes distintas.** Solo se probó con los dos navegadores en el mismo equipo. Entre redes distintas detrás de NAT simétrico haría falta un servidor TURN (no configurado).
- **El chat no se guarda:** al recargar la página el historial se pierde, y un mensaje para alguien desconectado devuelve error.
