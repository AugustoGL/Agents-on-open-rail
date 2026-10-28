// Carga datos de demostración en la base del MODO PRUEBA.
//   npm run seed              (agrega al final si la base está vacía; si ya tiene reservas, pide --reset)
//   npm run seed -- --reset   (borra la base de prueba y la vuelve a armar)
// No lee el archivo .env, no toca la cadena real y se niega a correr si MODE no es "mock".
import { existsSync, rmSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { sembrar } from './seed-lib.mjs';

const mode = process.env.MODE ?? 'mock';
if (mode !== 'mock') {
  console.error(`Me niego a cargar datos de demostración con MODE=${mode}. Solo funciona en MODE=mock.`);
  process.exit(1);
}
const dbPath = process.env.DB_PATH ?? 'data/sena-demo.db';
if (/(^|\/)sena\.db$/.test(dbPath)) {
  console.error(`Me niego a escribir en ${dbPath}: es la base del modo real. Usá una base de prueba (por defecto data/sena-demo.db).`);
  process.exit(1);
}
if (process.argv.includes('--reset')) {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(f)) rmSync(f);
  console.log(`Base de prueba reiniciada (${dbPath}).`);
}
const store = openDb(dbPath);
if (store.searchBookings({ limit: 1 }).length > 0) {
  console.error(`La base ${dbPath} ya tiene reservas. Para empezar de cero: npm run seed -- --reset`);
  process.exit(1);
}
const r = await sembrar({ store });
console.log(`Listo: ${r.reservas} reservas y ${r.decisiones} decisiones en ${dbPath}.`);
console.log(`Estados: ${Object.entries(r.estados).map(([k, v]) => `${k} ${v}`).join(' · ')} · pendientes de aprobar ${r.pendientes} · bloqueos ${r.bloqueos}.`);
console.log('Abrí /panel y /decisiones para verlas (npm start con MODE=mock).');
