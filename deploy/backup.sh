#!/usr/bin/env bash
# Respaldo diario de la base de Seña (copia consistente con VACUUM INTO). Uso: backup.sh [contenedor] [carpeta]
set -euo pipefail
C="${1:-sena-demo}"
DEST="${2:-/var/backups/sena}"
mkdir -p "$DEST"
STAMP="$(date +%F-%H%M)"
# Se escribe en el volumen /data (docker cp no puede leer la carpeta temporal en memoria) y se borra después.
docker exec "$C" sh -c 'rm -f /data/backup.tmp.db'
docker exec "$C" node --disable-warning=ExperimentalWarning -e "new (require('node:sqlite').DatabaseSync)(process.env.DB_PATH).exec(\"VACUUM INTO '/data/backup.tmp.db'\")"
docker cp "$C:/data/backup.tmp.db" "$DEST/${C}-${STAMP}.db"
docker exec "$C" rm -f /data/backup.tmp.db
find "$DEST" -name "${C}-*.db" -mtime +14 -delete
echo "Respaldo listo: $DEST/${C}-${STAMP}.db"
