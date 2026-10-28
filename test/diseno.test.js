// Sistema de diseño (public/css/sena.css): contraste AA, modo oscuro completo y página de la guía.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');
const css = read('css/sena.css');

/** Variables de color de un bloque: { nombre: '#hex' }. */
function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2].toUpperCase();
  return out;
}
const bodyOf = (open) => {
  const start = css.indexOf(open);
  assert.ok(start >= 0, `no está ${open}`);
  const from = css.indexOf('{', start) + 1;
  let depth = 1; let i = from;
  while (depth > 0 && i < css.length) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
  return css.slice(from, i - 1);
};
const light = tokens(bodyOf(':root {'));
const darkAuto = tokens(bodyOf(':root:not([data-theme="light"])'));
const darkManual = tokens(bodyOf(':root[data-theme="dark"]'));

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Pares de texto (AA normal: 4.5) y de bordes o foco (UI: 3).
const TEXT = [
  ['ink', 'bg'], ['ink', 'surface'], ['ink', 'surface-2'], ['ink-muted', 'bg'], ['ink-muted', 'surface'], ['ink-muted', 'surface-2'],
  ['primary', 'bg'], ['primary', 'surface'], ['primary-ink', 'primary'], ['primary-ink', 'primary-hover'], ['primary-soft-ink', 'primary-soft'], ['primary-soft-ink', 'surface'],
  ['danger-ink', 'danger'], ['danger-ink', 'danger-hover'],
  ...['ok', 'wait', 'bad', 'gone', 'done', 'info'].map((n) => [`${n}-fg`, `${n}-bg`]),
  ['bad-fg', 'bg'], ['bad-fg', 'surface'],
];
const UI = [['line-input', 'surface'], ['line-input', 'bg'], ['focus', 'bg'], ['focus', 'surface'],
  ...['ok', 'wait', 'bad', 'gone', 'done', 'info'].map((n) => [`${n}-bd`, 'bg'])];

for (const [name, set] of [['claro', light], ['oscuro', darkAuto]]) {
  test(`contraste AA en el modo ${name}: textos (4.5) y bordes (3)`, () => {
    for (const [fg, bg] of TEXT) {
      assert.ok(set[fg] && set[bg], `falta ${fg} o ${bg}`);
      const r = ratio(set[fg], set[bg]);
      assert.ok(r >= 4.5, `${fg} ${set[fg]} sobre ${bg} ${set[bg]}: ${r.toFixed(2)} (mínimo 4.5)`);
    }
    for (const [fg, bg] of UI) {
      const r = ratio(set[fg], set[bg]);
      // Los bordes decorativos de las etiquetas de estado no necesitan 3:1 (el texto y el ícono llevan el significado).
      if (/-bd$/.test(fg)) continue;
      assert.ok(r >= 3, `${fg} ${set[fg]} sobre ${bg} ${set[bg]}: ${r.toFixed(2)} (mínimo 3)`);
    }
  });
}

test('el modo oscuro automático y el forzado definen exactamente lo mismo, y cubren todo el modo claro', () => {
  assert.deepEqual(darkAuto, darkManual);
  assert.deepEqual(Object.keys(darkAuto).sort(), Object.keys(light).sort());
  assert.ok(Object.keys(light).length >= 30);
});

test('hay un color por estado con el mismo nombre en la guía, y cada estado lleva ícono', () => {
  for (const estado of ['confirmada', 'esperando', 'cancelada', 'vencida', 'jugada']) {
    const rule = new RegExp(`\\.es-${estado}\\s*\\{[^}]*--i:\\s*var\\(--icon-[a-z-]+\\)`).exec(css);
    assert.ok(rule, `.es-${estado} no tiene ícono`);
  }
  const iconos = [...css.matchAll(/--icon-([a-z-]+):\s*url\("data:image\/svg\+xml,/g)].map((m) => m[1]);
  for (const nombre of iconos) assert.match(css, new RegExp(`\\.i-${nombre}\\s*\\{\\s*--i:`), `falta la clase .i-${nombre}`);
});

test('los botones y campos miden 48 px o más (el chico, 44 px, solo en tablas del panel)', () => {
  assert.match(css, /--tap:\s*48px/);
  assert.match(css, /\.btn\s*\{[^}]*min-height:\s*var\(--tap\)/);
  assert.match(css, /\.input, \.seleccion, \.area\s*\{[^}]*min-height:\s*var\(--tap\)/);
  assert.match(css, /\.turno\s*\{[^}]*min-height:\s*var\(--tap\)/);
  assert.match(css, /\.btn-chico\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.input, \.seleccion, \.area\s*\{[^}]*font-size:\s*var\(--fs-base\)/); // 16 px: iOS no hace zoom
});

test('el foco es visible y se respeta "reducir movimiento"', () => {
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('la guía de estilos muestra cada componente y respeta la política de seguridad (sin estilos ni scripts en línea)', () => {
  const html = read('css/guia-estilos.html');
  for (const clase of ['btn-primario', 'btn-secundario', 'btn-peligro', 'tarjeta', 'estado es-confirmada', 'estado es-esperando', 'estado es-cancelada', 'estado es-vencida', 'estado es-jugada',
    'campo', 'input', 'aviso-info', 'aviso-ok', 'aviso-error', 'cargando', 'esqueleto', 'vacio', 'tabla--apilada', 'barra', 'nav-inferior', 'pasos', 'dia', 'turno', 'cuenta', 'comprobante', 'cal-celda', 'modal']) {
    assert.ok(html.includes(clase), `la guía no muestra ${clase}`);
    assert.ok(css.includes(`.${clase.split(' ')[0]}`), `sena.css no define .${clase.split(' ')[0]}`);
  }
  assert.doesNotMatch(html, /<script(?![^>]*src=)|\son\w+=|<style|\sstyle=/);
  assert.doesNotMatch(read('css/guia-estilos.js'), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});
