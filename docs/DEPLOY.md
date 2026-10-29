# Correr Seña con Docker en un servidor

Sirve para un VPS propio, incluso **compartido con otro proyecto**: el contenedor tiene límites duros de memoria y CPU, escucha solo en `127.0.0.1` y no instala nada en el sistema. Todo lo de `deploy/` y el `Dockerfile` está probado: imagen construida, contenedor levantado con estos límites, `healthy`, y ciclo de respaldo y restauración completo.

## 1. Qué se publica y qué no

| Instancia | Claves de billetera | ¿Servidor compartido? |
|---|---|---|
| **Demo** (`MODE=mock`) | Ninguna (usa una billetera simulada). Solo la clave del panel. | Sí |
| NFT en testnet | Una clave de testnet (sin valor), distinta de la real | Sí |
| **Real** (`MODE=live`) | **La clave del agente, con plata** | **No**: usá una máquina aparte, con saldo chico |

## 2. Levantarlo

```bash
git clone https://github.com/AugustoGL/Agents-on-open-rail.git /opt/sena && cd /opt/sena/deploy
cp demo.env.example demo.env && chmod 600 demo.env
nano demo.env        # PUBLIC_BASE_URL (la URL https final) y OWNER_DASHBOARD_PASSWORD (propia y larga)
nice -n 19 docker compose up -d --build
docker compose ps    # tiene que decir "healthy" en ~30 s
curl -s http://127.0.0.1:8402/api/negocio | head -c 120
```

Seña **no arranca** si `OWNER_DASHBOARD_PASSWORD` sigue con el valor del ejemplo. Variables útiles: `PORT`, `HOST` (`127.0.0.1` detrás de un proxy), `TRUST_PROXY=true`, `PUBLIC_BASE_URL`, `DB_PATH` (ya apunta al volumen `/data`).

Límites (en `deploy/docker-compose.yml`): 300 MB de memoria sin swap extra, 0,5 CPU, 200 procesos, sistema de archivos de solo lectura, sin capacidades extra. Uso medido: ~60 MB. Si se pasa, se reinicia **solo** su contenedor.

## 3. HTTPS (obligatorio: las billeteras y los pagos lo exigen)

Seña escucha en `127.0.0.1:8402`; el servidor web que ya tengas lo publica. **Antes de tocar una configuración existente, copiala, y probá la sintaxis antes de recargar** (un error recargado a ciegas puede tumbar todos los sitios del servidor).

```nginx
server {
    listen 443 ssl;
    server_name sena.example.com;                     # tu dirección
    ssl_certificate     /etc/letsencrypt/live/sena.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sena.example.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:8402;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Con Caddy: `sena.example.com { reverse_proxy 127.0.0.1:8402 }`. Si el proxy corre en un contenedor, conectá Seña a su red de Docker y apuntá al nombre del contenedor (`sena-demo:8402`).

Sin dominio propio: Let's Encrypt también emite certificados para **direcciones IP** (de 6 días, con renovación automática; hace falta Certbot 5.4 o más, el modo `webroot` y un `--deploy-hook` que recargue el servidor web) y hay nombres gratuitos como DuckDNS. Detalles: [Let's Encrypt](https://letsencrypt.org/2026/03/11/shorter-certs-certbot).

## 4. Respaldo y restauración

```bash
deploy/backup.sh sena-demo /var/backups/sena          # copia consistente; verifica que abre, está íntegra y es idéntica
deploy/restore.sh /var/backups/sena/sena-demo-<fecha>.db sena-demo
```

- Los respaldos quedan con permisos `600` (carpeta `700`) y se guardan 14 días (`RETENCION_DIAS`).
- `restore.sh` rechaza archivos que no sean un respaldo válido **sin tocar nada**, y antes de reemplazar guarda la base actual como `antes-de-restaurar-*.db` (esas no se borran solas).
- Programalo con `cron` (`30 3 * * *`) y **bajá copias a otra máquina**: un respaldo guardado en el mismo servidor se pierde si el servidor se rompe.

## 5. Actualizar y volver atrás

```bash
cd /opt/sena && git pull && cd deploy && nice -n 19 docker compose up -d --build    # la base no se toca
docker compose down        # apaga Seña (los datos quedan);  down -v  borra también la base
```

## 6. La instancia real (mainnet)

El mismo `Dockerfile` y `docker-compose.yml` sirven: descomentá `sena-real` en una **máquina aparte**, con su `real.env` (`MODE=live`, `AGENT_PRIVATE_KEY`, `X402_API_KEY`, `OWNER_PAYOUT_ADDRESS`, `ATTRIBUTION_TAG`…) con permisos `600`.

- Una billetera **solo para el agente**, con saldo chico: el código devuelve con topes y retira al dueño todas las noches.
- `OWNER_PAYOUT_ADDRESS` = la billetera personal del dueño, nunca la del agente.
- Nunca pongas claves en chats, capturas ni commits. Si algo se filtra: sacá el saldo, generá una clave nueva y volvé a registrar la identidad.
- Entrá al servidor con **clave SSH** y desactivá el ingreso por contraseña.
