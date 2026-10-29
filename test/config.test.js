// Configuración: lo que no debe pasar en un servidor (contraseñas de ejemplo) y los valores por defecto seguros.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const conEnv = (vars, fn) => {
  const antes = { ...process.env };
  Object.assign(process.env, vars);
  try { return fn(); } finally { for (const k of Object.keys(vars)) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; } }
};

test('Seña no arranca con la contraseña de ejemplo del panel', () => {
  assert.throws(() => conEnv({ OWNER_DASHBOARD_PASSWORD: 'pone-una-clave-larga-que-solo-sepas-vos' }, loadConfig), /still has the example value/);
});

test('una contraseña propia del panel se acepta y sin contraseña el panel queda deshabilitado', () => {
  assert.equal(conEnv({ OWNER_DASHBOARD_PASSWORD: 'una-clave-mia-bien-larga-91' }, loadConfig).dashboardPassword, 'una-clave-mia-bien-larga-91');
  assert.equal(conEnv({ OWNER_DASHBOARD_PASSWORD: '' }, loadConfig).dashboardPassword, undefined);
});

test('HOST: por defecto toda la red; se puede dejar solo local detrás de un proxy', () => {
  assert.equal(conEnv({ HOST: '' }, loadConfig).host, '0.0.0.0');
  assert.equal(conEnv({ HOST: '127.0.0.1' }, loadConfig).host, '127.0.0.1');
});
