/**
 * Prueba de extremo a extremo de la interfaz web, en un navegador real.
 *
 * Abre un Chrome SIN ventana, con un perfil temporal (no toca el Chrome del usuario)
 * y con cámara y micrófono SIMULADOS (--use-fake-device-for-media-stream). Lo controla
 * por el protocolo de depuración de Chrome (DevTools Protocol) usando el WebSocket
 * incluido en Node, así que no necesita instalar nada.
 *
 * Ana entra por el nodo A (localhost:8081) y Beto por el nodo B (localhost:8082).
 *
 * Requisitos: los nodos levantados (docker compose up -d), Node 22 o más reciente y Chrome.
 * Uso:
 *   node pruebas/prueba-navegador.mjs todo      chat, videollamada y archivo de 20 MB
 *   node pruebas/prueba-navegador.mjs errores   cámara denegada y archivo interrumpido
 *   (también: chat | llamada | archivos). Otra ruta de Chrome: variable de entorno CHROME.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FASE = process.argv[2] || 'todo';
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PUERTO = 9333;
const perfil = mkdtempSync(path.join(tmpdir(), 'perfil-prueba-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${perfil}`,
  '--use-fake-device-for-media-stream',
  // en la fase "errores" NO se acepta el permiso automáticamente: la cámara queda denegada
  ...(FASE === 'errores' ? ['--deny-permission-prompts'] : ['--use-fake-ui-for-media-stream']),
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const ok = (desc, cond, det = '') => { console.log(`${cond ? '  OK  ' : ' FALLA'}  ${desc}${det ? '  ->  ' + det : ''}`); if (!cond) fallos++; };

async function abrir(url) {
  const r = await fetch(`http://127.0.0.1:${PUERTO}/json/new?${url}`, { method: 'PUT' });
  const t = await r.json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res) => ws.addEventListener('open', res, { once: true }));
  let n = 0; const pend = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const cmd = (method, params = {}) => new Promise((res) => { const id = ++n; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => {
    const m = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || 'error en la página');
    return m.result?.result?.value;
  };
  await dormir(1500);
  return { ev, cerrar: () => ws.close() };
}

async function esperar(tab, expr, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await tab.ev(expr)) return true; await dormir(200); }
  return false;
}

const entrarComo = (tab, nombre) => tab.ev(`document.getElementById('nombre').value='${nombre}'; document.getElementById('entrar').click(); true`);
const abrirChat = (tab, nombre) => tab.ev(`[...document.querySelectorAll('.usuario')].find(b=>b.querySelector('span').textContent==='${nombre}').click(); true`);
const textoChat = (tab) => tab.ev(`document.getElementById('mensajes').textContent`);

try {
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PUERTO}/json/version`); break; } catch { await dormir(250); } }
  const A = await abrir('http://localhost:8081/');
  const B = await abrir('http://localhost:8082/');

  // ---------------- chat
  await entrarComo(A, 'ana'); await entrarComo(B, 'beto');
  ok('ana entra al nodo A', await esperar(A, `document.getElementById('estado').textContent.includes('nodo-a')`));
  ok('beto entra al nodo B', await esperar(B, `document.getElementById('estado').textContent.includes('nodo-b')`));
  ok('ana ve a beto (nodo-b) en línea', await esperar(A, `document.getElementById('usuarios').textContent.includes('betonodo-b')`));
  await abrirChat(A, 'beto'); await abrirChat(B, 'ana');
  await A.ev(`document.getElementById('texto').value='hola beto desde el navegador'; document.getElementById('form-chat').requestSubmit(); true`);
  ok('beto recibe el mensaje de ana', await esperar(B, `document.getElementById('mensajes').textContent.includes('hola beto desde el navegador')`));
  await B.ev(`document.getElementById('texto').value='hola ana'; document.getElementById('form-chat').requestSubmit(); true`);
  ok('ana recibe la respuesta', await esperar(A, `document.getElementById('mensajes').textContent.includes('hola ana')`));

  if (FASE === 'llamada' || FASE === 'todo') {
    await A.ev(`document.getElementById('llamar').click(); true`);
    ok('beto ve "te está llamando"', await esperar(B, `!document.getElementById('entrante').hidden`));
    await B.ev(`document.getElementById('contestar').click(); true`);
    ok('ana recibe video de beto', await esperar(A, `(()=>{const v=document.getElementById('remoto');return v.srcObject&&v.srcObject.getVideoTracks().length>0&&v.videoWidth>0})()`, 20000));
    ok('beto recibe video de ana', await esperar(B, `(()=>{const v=document.getElementById('remoto');return v.srcObject&&v.srcObject.getVideoTracks().length>0&&v.videoWidth>0})()`, 20000));
    ok('conexión WebRTC "connected"', await esperar(A, `App.estadoConexion && App.estadoConexion('beto')==='connected'`));
    await A.ev(`document.getElementById('silenciar').click(); true`);
    ok('silenciar apaga la pista de audio', await A.ev(`!App.pistaLocal('audio').enabled`));
    await A.ev(`document.getElementById('camara').click(); true`);
    ok('apagar cámara apaga la pista de video', await A.ev(`!App.pistaLocal('video').enabled`));
    await B.ev(`document.getElementById('colgar').click(); true`);
    ok('al colgar beto, ana cierra la llamada', await esperar(A, `document.getElementById('videos').hidden && document.getElementById('colgar').disabled`));

    // Segunda llamada: ahora cuelga ana y envía un archivo EN SEGUIDA, mientras los dos renegocian.
    // (Caso de un error real ya corregido: la oferta se ignoraba y el canal nunca se abría.)
    await A.ev(`document.getElementById('llamar').click(); true`);
    await esperar(B, `!document.getElementById('entrante').hidden`);
    await B.ev(`document.getElementById('contestar').click(); true`);
    await esperar(A, `document.getElementById('remoto').videoWidth>0`, 20000);
    await A.ev(`document.getElementById('colgar').click();
      const dt=new DataTransfer(); dt.items.add(new File([new Uint8Array(300000)],'justo_al_colgar.bin'));
      document.getElementById('archivo').files=dt.files; document.getElementById('enviar-archivo').click(); true`);
    ok('archivo enviado justo al colgar llega igual', await esperar(B, `document.getElementById('mensajes').textContent.includes('justo_al_colgar.bin')`, 30000));
  }

  if (FASE === 'archivos' || FASE === 'todo') {
    // archivo de 20 MB generado en la página con contenido aleatorio
    const sha = await A.ev(`(async()=>{
      const datos=new Uint8Array(20*1024*1024); for(let i=0;i<datos.length;i+=65536) crypto.getRandomValues(datos.subarray(i,i+65536));
      const f=new File([datos],'prueba_20MB.bin',{type:'application/octet-stream'});
      const dt=new DataTransfer(); dt.items.add(f); const inp=document.getElementById('archivo'); inp.files=dt.files;
      const h=await crypto.subtle.digest('SHA-256',datos); document.getElementById('enviar-archivo').click();
      return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('');})()`);
    const t0 = Date.now();
    ok('beto recibe el archivo de 20 MB', await esperar(B, `document.getElementById('mensajes').textContent.includes('prueba_20MB.bin')`, 120000), `${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const shaB = await B.ev(`(async()=>{const a=[...document.querySelectorAll('#mensajes a')].find(x=>x.download==='prueba_20MB.bin'); if(!a) return null;
      const b=await (await fetch(a.href)).arrayBuffer(); const h=await crypto.subtle.digest('SHA-256',b);
      return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')+' '+b.byteLength;})()`);
    ok('el archivo recibido es idéntico (SHA-256 y tamaño)', shaB === `${sha} ${20 * 1024 * 1024}`);
    // imagen pequeña: debe mostrarse dentro del chat
    await B.ev(`(async()=>{const c=document.createElement('canvas');c.width=40;c.height=40;c.getContext('2d').fillRect(0,0,40,40);
      const blob=await new Promise(r=>c.toBlob(r,'image/png')); const dt=new DataTransfer(); dt.items.add(new File([blob],'cuadro.png',{type:'image/png'}));
      document.getElementById('archivo').files=dt.files; document.getElementById('enviar-archivo').click(); return true;})()`);
    ok('ana ve la imagen recibida en el chat', await esperar(A, `!!document.querySelector('#mensajes img')`));
  }

  if (FASE === 'errores') {
    await A.ev(`document.getElementById('llamar').click(); true`);
    ok('cámara denegada: se muestra el aviso', await esperar(A, `!document.getElementById('toast').hidden && document.getElementById('toast').textContent.includes('denegado')`),
      await A.ev(`document.getElementById('toast').textContent`));
    ok('cámara denegada: no queda llamada abierta', await A.ev(`document.getElementById('videos').hidden && document.getElementById('colgar').disabled`));
    // archivo interrumpido: beto se va a mitad del envío de 40 MB
    await A.ev(`(()=>{const d=new Uint8Array(40*1024*1024); const dt=new DataTransfer(); dt.items.add(new File([d],'grande.bin'));
      document.getElementById('archivo').files=dt.files; document.getElementById('enviar-archivo').click(); return true;})()`);
    await esperar(A, `!document.getElementById('zona-progreso').hidden && document.getElementById('progreso').value > 2*1024*1024`, 20000);
    await B.ev(`location.href='about:blank'; true`);
    ok('archivo interrumpido: ana ve el error', await esperar(A, `document.getElementById('mensajes').textContent.includes('No se pudo enviar grande.bin')`, 30000),
      await A.ev(`[...document.querySelectorAll('#mensajes .sistema')].map(x=>x.textContent).slice(-2).join(' | ')`));
  }

  // ---------------- desconexión del otro extremo
  await B.ev(`location.href='about:blank'; true`);
  ok('ana ve que beto se desconectó', await esperar(A, `document.getElementById('mensajes').textContent.includes('beto se desconectó')`));
  A.cerrar(); B.cerrar();
} catch (e) {
  console.log(' FALLA ', e.message); fallos++;
} finally {
  chrome.kill();
  await dormir(1000);
  try { rmSync(perfil, { recursive: true, force: true }); } catch {}
  console.log(fallos === 0 ? '\nResultado: todo pasó.' : `\nResultado: ${fallos} falla(s).`);
  process.exit(fallos ? 1 : 0);
}
