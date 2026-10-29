#!/usr/bin/env bash
# Respaldo de la base de Seña (copia consistente con VACUUM INTO).
#   Uso: backup.sh [contenedor] [carpeta] [prefijo]   (por defecto: sena-demo  /var/backups/sena  <contenedor>)
# - Los respaldos quedan con permisos 600 (solo su dueño los lee).
# - El archivo temporal dentro del contenedor se borra siempre, aunque algo falle.
# - Antes de anunciar "listo" se comprueba que la copia se abre, que está íntegra y que es idéntica a la original (sha256).
# - Se guardan 14 días (RETENCION_DIAS=n para cambiarlo).
set -euo pipefail
umask 077
C="${1:-sena-demo}"
DEST="${2:-/var/backups/sena}"
PREFIJO="${3:-$C}"
RETENCION_DIAS="${RETENCION_DIAS:-14}"
TMP="/data/backup.tmp.db"
mkdir -p "$DEST"
chmod 700 "$DEST"
STAMP="$(date +%F-%H%M%S)"
OUT="$DEST/${PREFIJO}-${STAMP}.db"

limpiar() { docker exec "$C" rm -f "$TMP" >/dev/null 2>&1 || true; }
trap limpiar EXIT

docker exec "$C" rm -f "$TMP"
# 1) Copia consistente dentro del contenedor y comprobación de integridad ahí mismo.
docker exec "$C" node --disable-warning=ExperimentalWarning -e "
  const { DatabaseSync } = require('node:sqlite');
  new DatabaseSync(process.env.DB_PATH).exec(\"VACUUM INTO '$TMP'\");
  const r = new DatabaseSync('$TMP', { readOnly: true }).prepare('PRAGMA integrity_check').get().integrity_check;
  if (r !== 'ok') { console.error('Integridad: ' + r); process.exit(1); }"
SUM_ORIGEN="$(docker exec "$C" sha256sum "$TMP" | cut -d' ' -f1)"
# 2) Sacarla del contenedor (a un nombre provisorio) y comparar.
docker cp "$C:$TMP" "$OUT.parcial"
SUM_COPIA="$(sha256sum "$OUT.parcial" | cut -d' ' -f1)"
if [ "$SUM_ORIGEN" != "$SUM_COPIA" ]; then rm -f "$OUT.parcial"; echo "ERROR: la copia no coincide con el original; no se guardó." >&2; exit 1; fi
chmod 600 "$OUT.parcial"
mv "$OUT.parcial" "$OUT"
# 3) Retención.
find "$DEST" -maxdepth 1 -name "${PREFIJO}-*.db" -mtime +"$RETENCION_DIAS" -delete
echo "Respaldo listo y verificado: $OUT ($(du -h "$OUT" | cut -f1), sha256 ${SUM_COPIA:0:12}…)"
