# Mensajero WebRTC en dos nodos Docker

Laboratorio de Sistemas Distribuidos, Universidad Tecnológica de Pereira.
Autor: Santiago Guevara.

Mensajero web en el que dos usuarios intercambian texto, audio, video y archivos y hacen videollamadas con WebRTC. El sistema corre en dos nodos (contenedores Docker) conectados por una red virtual. Cada nodo tiene un servidor de señalización por WebSocket, y los dos nodos se reenvían los mensajes entre sí.

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1. Investigación | Informe en [`docs/informe/informe_investigacion.pdf`](docs/informe/informe_investigacion.pdf) y diagramas en [`docs/uml/`](docs/uml/) | Entregado |
| 2. Primer avance sin interfaz | Dos nodos, señalización y mensajes desde la consola | Entregado (este README) |
| 3. Interfaz, medios y archivos | Chat web, videollamada y archivos | Pendiente (25 al 30 de noviembre) |

## Requisitos

- **Docker Desktop** (probado con Docker 29.9 y Docker Compose 5.6, en Windows 11 con WSL 2). En Linux basta Docker Engine con el plugin Compose.
- **Node.js 20 o más reciente** en el anfitrión, solo si se quiere correr la prueba o el cliente de consola fuera de los contenedores. Dentro de los contenedores ya viene incluido.

## Puertos

| Puerto en el anfitrión | Puerto en el contenedor | Servicio |
|---|---|---|
| 8081/TCP | 8080/TCP | `nodo-a`: HTTP (`/`, `/salud`, `/usuarios`) y WebSocket (`/ws`, `/nodo`) |
| 8082/TCP | 8080/TCP | `nodo-b`: lo mismo |

Entre ellos, los nodos se hablan por la red `mensajero-red` usando el nombre del otro: `ws://nodo-b:8080/nodo` y `ws://nodo-a:8080/nodo`. No hay ninguna IP escrita en el código.

## 1. Arrancar los dos nodos

Desde la carpeta del repositorio:

```bash
docker compose up --build -d
docker compose ps
```

Los dos contenedores deben aparecer como `Up (healthy)`. Para ver los logs de ambos nodos en vivo (conviene dejarlo abierto en otra terminal):

```bash
docker compose logs -f
```

Al arrancar, cada nodo escribe `ENLACE conectado al par ws://nodo-X:8080/nodo`.

## 2. Comprobar la red y los nombres

```bash
docker network inspect mensajero-red                 # los dos contenedores y sus IP
docker compose exec nodo-a nslookup nodo-b           # el DNS interno de Docker resuelve el nombre
curl http://localhost:8081/salud                     # en PowerShell: curl.exe ...
curl http://localhost:8082/usuarios
```

En `/salud`, `"par_conectado": true` indica que el enlace entre nodos está abierto.

## 3. Intercambiar mensajes desde la consola

### Opción A: prueba automática (un comando)

```bash
# desde el anfitrión, por los puertos publicados
cd servidor && npm install && node src/prueba-avance.js

# o desde dentro de un contenedor, buscando los nodos por nombre (no necesita Node en el anfitrión)
docker compose exec nodo-a node src/prueba-avance.js ws://nodo-a:8080/ws ws://nodo-b:8080/ws
```

Conecta un usuario a cada nodo y comprueba seis cosas: los dos registros, la presencia compartida, el mensaje de A a B, el de B a A y el error con un destinatario que no existe. Termina con `Resultado: todas las pruebas pasaron.`

### Opción B: cliente de consola interactivo

En una terminal (Ana, conectada al nodo A):

```bash
docker compose exec nodo-a node src/cliente-consola.js ws://nodo-a:8080/ws ana
```

En otra terminal (Beto, conectado al nodo B):

```bash
docker compose exec nodo-b node src/cliente-consola.js ws://nodo-b:8080/ws beto
```

Se escribe `<destinatario> <mensaje>`, por ejemplo `beto hola`. También están `/usuarios` y `/salir`.

### Opción C: wscat

```bash
npx wscat -c ws://localhost:8081/ws
> {"tipo":"registro","usuario":"ana"}
> {"tipo":"mensaje","para":"beto","texto":"hola"}
```

### Qué se ve en los logs

```
[nodo-a] REGISTRO    ana se conectó
[nodo-b] PRESENCIA   nodo-a tiene conectados: [ana]
[nodo-a] REENVIADO   ana -> beto: hola  [hacia nodo-b]
[nodo-b] ENTREGADO   ana -> beto: hola  [desde nodo-a]
```

## 4. Probar la caída de un nodo

```bash
docker compose stop nodo-b      # nodo-a registra "nodo-b cerró su conexión" y reintenta cada 2 s
curl http://localhost:8081/salud   # "par_conectado": false
docker compose start nodo-b     # se reconectan solos
```

## 5. Apagar

```bash
docker compose down
```

## Formato de los mensajes

Mensajes JSON por WebSocket. El nodo completa `de`, `id`, `ts` y `nodo_origen`, así un cliente no puede hacerse pasar por otro.

| Dirección | Mensaje |
|---|---|
| cliente → nodo | `{"tipo":"registro","usuario":"ana"}` |
| cliente → nodo | `{"tipo":"mensaje","para":"beto","texto":"hola"}` |
| cliente → nodo | `{"tipo":"lista"}` |
| cliente → nodo (fase 3) | `{"tipo":"oferta" / "respuesta" / "candidato" / "colgar","para":"beto",...}` |
| nodo → cliente | `registrado`, `presencia`, `mensaje`, `error` |
| nodo → nodo | `{"tipo":"presencia","nodo":"nodo-a","usuarios":["ana"]}` y `{"tipo":"reenvio","mensaje":{...}}` |

## Estructura

```
docker-compose.yml        dos servicios (nodo-a, nodo-b) y la red mensajero-red
servidor/
  Dockerfile              imagen node:22-alpine, usuario sin privilegios y healthcheck
  src/servidor.js         HTTP + WebSocket (/ws clientes, /nodo enlace) y enrutamiento
  src/enlace.js           conexión saliente al otro nodo, con reintento
  src/directorio.js       usuarios locales y remotos
  src/registro.js         formato de los logs
  src/cliente-consola.js  cliente interactivo para la consola
  src/prueba-avance.js    prueba automática del avance
  public/index.html       página provisional (la interfaz llega en la fase 3)
docs/
  informe/                informe de investigación (PDF y fuente HTML)
  uml/                    diagramas PlantUML (.puml) y sus imágenes (.png)
BITACORA.md               una entrada por sesión de trabajo
```

Para regenerar los diagramas sin instalar Java:

```bash
docker run --rm -v "${PWD}/docs/uml:/data" -w /data plantuml/plantuml:1.2024.7 -tpng -charset UTF-8 "*.puml"
```

## Problemas conocidos

- **Windows: `additional privileges requested: pass "--allow=fs.read=servidor\Dockerfile"` al construir.** Docker Compose 5 construye con `bake`, que compara rutas distinguiendo mayúsculas. Si la terminal abrió la carpeta como `c:\...` (minúscula, como hace VS Code), falla. Solución: entrar a la carpeta con la letra en mayúscula, por ejemplo en PowerShell `Set-Location "C:\Users\...\guevara_santiago_mensajero_webrtc"`, y repetir `docker compose up --build`.
- **Puertos 8081 u 8082 ocupados.** Cambiar el lado izquierdo de `ports` en `docker-compose.yml` (por ejemplo `"9081:8080"`).
- Esta fase no tiene interfaz gráfica; `http://localhost:8081` muestra solo una página informativa.
