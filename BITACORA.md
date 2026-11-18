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
