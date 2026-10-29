#!/usr/bin/env bash
# Restaura un respaldo en el contenedor de Seña.  ¡Reemplaza la base actual!
#   Uso: restore.sh <archivo.db> [contenedor]       (por defecto: sena-demo)
# Antes de pisar nada guarda una copia de la base actual como  <contenedor>-antes-de-restaurar-<fecha>.db  junto al respaldo.
set -euo pipefail
umask 077
ARCH="${1:?Uso: restore.sh <archivo.db> [contenedor]}"
C="${2:-sena-demo}"
[ -f "$ARCH" ] || { echo "No existe $ARCH" >&2; exit 1; }
# Que el archivo se abra y esté íntegro ANTES de tocar nada (se prueba dentro del contenedor, que tiene Node con SQLite).
docker cp "$ARCH" "$C:/data/restore.tmp.db"
trap 'docker exec "$C" rm -f /data/restore.tmp.db >/dev/null 2>&1 || true' EXIT
if ! SALIDA="$(docker exec "$C" node --disable-warning=ExperimentalWarning -e "
  const { DatabaseSync } = require('node:sqlite');
  try {
    const d = new DatabaseSync('/data/restore.tmp.db', { readOnly: true });
    const r = d.prepare('PRAGMA integrity_check').get().integrity_check;
    const n = d.prepare(\"SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='bookings'\").get().n;
    if (r !== 'ok' || n !== 1) throw new Error('integridad: ' + r + ', tabla bookings: ' + n);
  } catch (e) { console.error('El archivo no es un respaldo válido de Seña (' + e.message + '). No se tocó nada.'); process.exit(1); }" 2>&1)"; then
  echo "$SALIDA" | grep -v ExperimentalWarning | grep -v 'trace-warnings' >&2
  exit 1
fi
# Copia de seguridad de lo que hay hoy (con otro prefijo, para que la retención diaria no la borre).
DIR="$(dirname "$(realpath "$ARCH")")"
"$(dirname "$0")/backup.sh" "$C" "$DIR" "antes-de-restaurar-$C"
DB="$(docker exec "$C" printenv DB_PATH)"
# Parar, reemplazar (sin los archivos -wal/-shm viejos) y arrancar.
docker stop "$C" >/dev/null
docker run --rm --volumes-from "$C" --entrypoint sh "$(docker inspect -f '{{.Config.Image}}' "$C")" -c "cp /data/restore.tmp.db '$DB' && rm -f '$DB-wal' '$DB-shm' /data/restore.tmp.db"
docker start "$C" >/dev/null
echo "Restaurado desde $ARCH. La base anterior quedó guardada en $DIR (antes-de-restaurar-$C-*.db)"
