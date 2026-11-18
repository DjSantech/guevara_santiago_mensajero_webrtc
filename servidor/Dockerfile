# Imagen de un nodo del mensajero. Los dos nodos (nodo-a y nodo-b) usan esta misma imagen;
# lo único que cambia entre ellos son las variables de entorno que pone docker-compose.yml.

# Imagen base: Node.js 22 (LTS) sobre Alpine Linux, pequeña (~50 MB comprimida).
FROM node:22-alpine

# Carpeta de trabajo dentro del contenedor.
WORKDIR /app

# Primero solo los archivos de dependencias: si el código cambia pero las dependencias no,
# Docker reutiliza esta capa de la caché y la construcción es más rápida.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Luego el código del servidor y la página web.
COPY src ./src
COPY public ./public

# Valores por defecto; docker-compose.yml los sobrescribe para cada nodo.
ENV PUERTO=8080 \
    NODO_NOMBRE=nodo \
    NODE_ENV=production

# Documenta el puerto en el que escucha el servidor (no lo publica: eso lo hace "ports" en Compose).
EXPOSE 8080

# No correr como root: la imagen oficial de Node trae el usuario sin privilegios "node".
USER node

# Docker revisa cada 10 s que el nodo responda en /salud; si falla 3 veces, lo marca "unhealthy".
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/salud > /dev/null || exit 1

# Comando que arranca el contenedor.
CMD ["node", "src/servidor.js"]
