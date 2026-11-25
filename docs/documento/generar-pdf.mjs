/**
 * Genera docs/documento/documento_final.pdf a partir de documento_final.html.
 *
 * 1. Inserta en el HTML las salidas reales de la terminal guardadas en salidas/*.txt
 *    (cada <pre class="terminal" data-salida="archivo.txt"></pre> se llena con ese archivo).
 * 2. Imprime el resultado a PDF con Microsoft Edge o Google Chrome sin ventana.
 *
 * Uso (desde la raíz del repositorio):  node docs/documento/generar-pdf.mjs
 * Otro navegador: variable de entorno NAVEGADOR con la ruta del ejecutable.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const carpeta = path.dirname(fileURLToPath(import.meta.url));
const escapar = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let html = readFileSync(path.join(carpeta, 'documento_final.html'), 'utf8');
html = html.replace(/<pre class="terminal" data-salida="([^"]+)"><\/pre>/g, (_, archivo) => {
  const texto = readFileSync(path.join(carpeta, 'salidas', archivo), 'utf8').replace(/^\uFEFF/, '').trimEnd();
  return `<pre class="terminal">${escapar(texto)}</pre>`;
});

const temporal = path.join(carpeta, '_documento_completo.html');
const pdf = path.join(carpeta, 'documento_final.pdf');
writeFileSync(temporal, html, 'utf8');

const candidatos = [
  process.env.NAVEGADOR,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean);
const navegador = candidatos.find((ruta) => existsSync(ruta));
if (!navegador) {
  console.log('No se encontró Edge ni Chrome. Indique la ruta en la variable NAVEGADOR.');
  process.exit(1);
}

const r = spawnSync(navegador, [
  '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
  `--print-to-pdf=${pdf}`, pathToFileURL(temporal).href,
], { encoding: 'utf8' });
unlinkSync(temporal);
console.log(existsSync(pdf) ? `PDF generado: ${pdf}` : `No se generó el PDF:\n${r.stderr}`);
