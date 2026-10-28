// Manejo mínimo de Chrome por el protocolo de DevTools (sin dependencias). Lo usan las capturas de pantalla.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function launchChrome({ chromeBin = process.env.CHROME_BIN ?? 'google-chrome' } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'sena-chrome-'));
  const proc = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    proc.on('error', (e) => reject(new Error(`No pude abrir ${chromeBin}: ${e.message}. Indicá otro con CHROME_BIN=/ruta/al/navegador`)));
    proc.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) resolve(m[1]); });
    setTimeout(() => reject(new Error('Chrome no arrancó a tiempo')), 15000);
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result); }
    else listeners.forEach((fn) => fn(msg));
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Una pestaña nueva con el tamaño y el modo (claro u oscuro) pedidos. */
  async function newPage({ width, height, mobile = false, dark = false, scale = 1 }) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const cmd = (method, params) => send(method, params, sessionId);
    await Promise.all([cmd('Page.enable'), cmd('Runtime.enable'), cmd('Log.enable')]);
    await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
    await cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    const problems = [];
    listeners.push((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') problems.push(`excepción: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon/.test(msg.params.entry.url ?? '')) problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
      if (msg.method === 'Page.javascriptDialogOpening') cmd('Page.handleJavaScriptDialog', { accept: true });
    });
    const evaluate = async (expression) => {
      const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`En la página: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    };
    const waitFor = async (expression, what, timeout = 8000) => {
      const t0 = Date.now();
      for (;;) {
        try { if (await evaluate(expression)) return; } catch { /* todavía carga */ }
        if (Date.now() - t0 > timeout) throw new Error(`Se esperaba: ${what}`);
        await sleep(100);
      }
    };
    return {
      cmd, evaluate, waitFor, problems, sleep,
      /** Escucha eventos del protocolo de esta pestaña (por ejemplo Fetch.requestPaused). */
      on(fn) { listeners.push((msg) => { if (msg.sessionId === sessionId) fn(msg); }); },
      async goto(url) { await cmd('Page.navigate', { url }); await sleep(150); await waitFor("document.readyState === 'complete'", `cargar ${url}`); await sleep(250); },
      /** Captura de la página entera (hasta maxHeight px para que no salgan imágenes gigantes). */
      async screenshot(file, { full = true, maxHeight = 6000 } = {}) {
        const { writeFileSync } = await import('node:fs');
        let clip;
        if (full) {
          const h = Math.min(await evaluate('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)'), maxHeight);
          clip = { x: 0, y: 0, width, height: h, scale: 1 };
        }
        const { data } = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, ...(clip ? { clip } : {}) });
        writeFileSync(file, Buffer.from(data, 'base64'));
      },
      async horizontalOverflow() {
        return evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
      },
      async close() { await send('Target.closeTarget', { targetId }).catch(() => {}); },
    };
  }
  async function close() {
    const exited = new Promise((resolve) => { proc.once('exit', resolve); setTimeout(resolve, 5000); });
    try { await send('Browser.close'); } catch { proc.kill(); }
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  return { newPage, close };
}

/**
 * Billetera simulada que firma de verdad: la página llama a window.ethereum (como lo haría MetaMask) y la firma la hace
 * Node con la clave de prueba que se le pase (una cuenta de viem). No sale a la red ni mueve nada.
 */
export async function instalarBilleteraFirmante(page, account, { chainId = '0xa4ec' } = {}) {
  await page.cmd('Runtime.addBinding', { name: '__firmaNode' });
  page.on(async (msg) => {
    if (msg.method !== 'Runtime.bindingCalled' || msg.params.name !== '__firmaNode') return;
    const { id, message } = JSON.parse(msg.params.payload);
    const firma = await account.signMessage({ message });
    await page.evaluate(`window.__firmaListo(${id}, ${JSON.stringify(firma)})`);
  });
  await page.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const esperando = new Map(); let n = 0;
    window.__firmaListo = (id, firma) => { esperando.get(id)?.(firma); esperando.delete(id); };
    window.ethereum = {
      isMetaMask: true,
      request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [${JSON.stringify(account.address.toLowerCase())}];
        if (method === 'eth_chainId') return '${chainId}';
        if (method === 'personal_sign') {
          const bytes = Uint8Array.from(params[0].slice(2).match(/../g).map((b) => parseInt(b, 16)));
          return new Promise((resolve) => { const id = ++n; esperando.set(id, resolve); window.__firmaNode(JSON.stringify({ id, message: new TextDecoder().decode(bytes) })); });
        }
        throw new Error('Método no simulado: ' + method);
      },
      on() {}, removeListener() {},
    };
  })();` });
}
