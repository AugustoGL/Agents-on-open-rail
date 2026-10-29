# Desplegar Seña en el VPS (sin tirar el otro proyecto)

Servidor: Ubuntu 24.04 con Docker, 2 CPU y 2 GB de RAM, compartido con **kronos-app.com.ar**. La regla de este documento es una sola: **no tocar nada de Kronos hasta saber cómo está armado**.

Cómo se protege Kronos:

| Riesgo | Qué hace Seña |
|---|---|
| Se come la memoria | El contenedor tiene **tope de 300 MB** y sin swap extra. Si se pasa, se reinicia **solo Seña**. Uso real medido: ~60 MB. |
| Se come el procesador | Tope de **0,5 CPU**. |
| Choca de puertos | Escucha solo en `127.0.0.1:8402` (no abre nada a internet). |
| Pisa el Node o los paquetes | No instala nada en el sistema: todo vive dentro del contenedor. |
| Se mezclan las claves | La instancia de **demo no tiene ninguna clave de billetera** (usa una simulada). Solo lleva la clave del panel. La instancia **real** no va en este servidor (ver sección 10). |
| Se cae y nadie lo ve | Reinicio automático, chequeo de salud y respaldo diario. |

Todo lo de `deploy/` y el `Dockerfile` está **probado**: se construyó la imagen, se levantó con estos mismos límites, respondió todas las páginas, quedó "healthy" y el respaldo salió íntegro.

---

## 1. Diagnóstico (solo lectura, no cambia nada)

Conectate: `ssh -p5082 root@149.50.153.224` y corré esto. Pegame la salida **sin contraseñas ni claves**:

```bash
free -h; df -h /; nproc
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
docker network ls
ss -ltnp | grep -E ':(80|443|8402|8403)\b'
systemctl list-units --type=service --state=running | grep -Ei 'nginx|caddy|apache|traefik|docker'
ls /etc/nginx/sites-enabled 2>/dev/null; ls /etc/caddy 2>/dev/null
```

Con eso sé **quién atiende los puertos 80 y 443** (nginx en el servidor, Caddy, Traefik o un contenedor) y adapto el paso 5. **No sigas con el paso 5 sin eso.**

## 2. Dirección y HTTPS (sin comprar dominio)

**Hace falta HTTPS.** Con `http://149.50.153.224:8402` la clave del panel viajaría en texto plano, el navegador marca "no seguro" y MiniPay y los botones de Telegram exigen HTTPS. Opciones, de mejor a peor:

| | Dirección que ve el jurado | Cuesta | Notas |
|---|---|---|---|
| **A. HTTPS directo sobre la IP** | `https://149.50.153.224` | $0 y sin registrarte en nada | Let's Encrypt emite certificados para IPs desde enero de 2026 ([anuncio](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)). Duran **6 días** y se renuevan solos: si la renovación falla, a los 6 días el sitio muestra un error de certificado. Si cambia la IP del servidor, deja de funcionar. |
| **B. Nombre gratis de DuckDNS** | `https://sena.duckdns.org` | $0, registro gratis | Certificado normal de 90 días y URL prolija. Es la más cómoda si no te molesta crear una cuenta. |
| C. sslip.io / nip.io | `https://149-50-153-224.sslip.io` | $0 | **No la recomiendo**: comparte el límite de certificados con todos los demás usuarios y suele fallar ([ejemplo](https://openvidu.discourse.group/t/deployment-without-domain/5474)). |
| D. Solo `http://IP:puerto` | | | **No**: sin HTTPS no sirve para pagar. |

### Opción A paso a paso (nginx del servidor)

Necesitás **Certbot 5.4 o más** (`certbot --version`; si es menor: `snap install certbot --classic`). El plugin `nginx` de Certbot todavía no soporta IPs, así que se usa el modo `webroot` y nginx se configura a mano ([guía de Certbot](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)).

1. Bloque **nuevo** en el puerto 80, solo para validar (archivo nuevo, no editás los de Kronos):

```nginx
# /etc/nginx/sites-available/sena
server {
    listen 80;
    server_name 149.50.153.224;
    location /.well-known/acme-challenge/ { root /var/www/sena-acme; }
    location / { return 301 https://$host$request_uri; }
}
```

```bash
mkdir -p /var/www/sena-acme
ln -s /etc/nginx/sites-available/sena /etc/nginx/sites-enabled/sena
nginx -t && systemctl reload nginx
```

2. Pedí el certificado **primero de prueba** (`--staging`, no cuenta contra el límite) y después el real:

```bash
certbot certonly --staging --preferred-profile shortlived --webroot --webroot-path /var/www/sena-acme --ip-address 149.50.153.224
# si salió bien, repetí sin --staging:
certbot certonly --preferred-profile shortlived --webroot --webroot-path /var/www/sena-acme --ip-address 149.50.153.224
```

3. Agregá el bloque HTTPS al mismo archivo, probá y recargá:

```nginx
server {
    listen 443 ssl;
    server_name 149.50.153.224;
    ssl_certificate     /etc/letsencrypt/live/149.50.153.224/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/149.50.153.224/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:8402;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

4. **Renovación (importante, cada 6 días):** que nginx recargue el certificado nuevo.
```bash
certbot reconfigure --cert-name 149.50.153.224 --deploy-hook "systemctl reload nginx"
certbot renew --dry-run        # tiene que terminar sin errores
systemctl list-timers | grep -i certbot    # el temporizador de renovación tiene que estar activo
```

5. En `demo.env`: `PUBLIC_BASE_URL=https://149.50.153.224`.

Si en el diagnóstico (paso 1) el proxy resulta ser **Caddy o un contenedor**, esta parte cambia: pasame la salida y la adapto.

## 3. Traer el código y configurar

```bash
mkdir -p /opt/sena && cd /opt/sena
git clone https://github.com/AugustoGL/Agents-on-open-rail.git .
cd deploy
cp demo.env.example demo.env && chmod 600 demo.env
nano demo.env      # completá PUBLIC_BASE_URL (la dirección del paso 2) y OWNER_DASHBOARD_PASSWORD
```

## 4. Levantarlo (solo local)

```bash
cd /opt/sena/deploy
nice -n 19 docker compose up -d --build     # "nice": la construcción no le saca CPU a Kronos
docker compose ps                           # tiene que decir "healthy" en ~30 s
curl -s http://127.0.0.1:8402/api/negocio | head -c 120
docker stats --no-stream                    # fijate que Kronos siga igual
```

Si algo sale mal acá, **Kronos no se enteró**: `docker compose down` y listo.

## 5. Publicarlo por HTTPS (depende del diagnóstico)

**Antes de tocar cualquier configuración existente, hacé una copia** (por ejemplo `cp -a /etc/nginx /root/nginx-copia`) **y probá la sintaxis antes de recargar.** Un error de sintaxis recargado a ciegas puede tumbar *todos* los sitios del servidor.

### A. Si Kronos usa nginx en el servidor

> Si elegiste la **IP**, ya lo hiciste en el paso 2. Lo que sigue es para un **nombre** (DuckDNS u otro dominio).

Archivo **nuevo** `/etc/nginx/sites-available/sena` (no editás los de Kronos):

```nginx
server {
    listen 80;
    server_name sena.kronos-app.com.ar;          # tu subdominio
    location / {
        proxy_pass http://127.0.0.1:8402;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/sena /etc/nginx/sites-enabled/sena
nginx -t && systemctl reload nginx          # solo recarga si dice "syntax is ok"
certbot --nginx -d sena.kronos-app.com.ar   # saca el certificado y activa HTTPS
```

### B. Si usa Caddy en el servidor

Agregá un bloque nuevo al final del `Caddyfile` y probá con `caddy validate` antes de `systemctl reload caddy`:

```
sena.kronos-app.com.ar {
    reverse_proxy 127.0.0.1:8402
}
```

### C. Si el proxy es un contenedor (nginx, Traefik, Nginx Proxy Manager)

Ese contenedor **no ve** el `127.0.0.1` del servidor. Lo más limpio es conectar Seña a *su* red de Docker y apuntar al nombre del contenedor (`sena-demo:8402`). Mandame la salida del paso 1 y te preparo el cambio exacto, sin tocar nada de Kronos más allá de agregar un host nuevo.

## 6. Verificar

- `https://sena.tu-dominio` carga con el candado, dice **TEST MODE** y se puede reservar y pagar "as a test".
- `/panel` pide la clave, `/decisiones` anda.
- `docker stats --no-stream`: Seña ~60 MB; el resto, como antes.

## 7. Respaldo diario

```bash
chmod +x /opt/sena/deploy/backup.sh
( crontab -l 2>/dev/null; echo '30 3 * * * /opt/sena/deploy/backup.sh sena-demo /var/backups/sena >> /var/log/sena-backup.log 2>&1' ) | crontab -
/opt/sena/deploy/backup.sh sena-demo /var/backups/sena     # probá una vez a mano
```

Guarda 14 días en `/var/backups/sena`. **Bajate una copia a tu PC de vez en cuando** (`scp -P 5082 root@149.50.153.224:/var/backups/sena/*.db .`): si se rompe el servidor, los respaldos que están en él se pierden también.

## 8. Actualizar a una versión nueva

```bash
cd /opt/sena && git pull && cd deploy && nice -n 19 docker compose up -d --build
```

La base no se toca (vive en el volumen `sena-demo-data`).

## 9. Volver atrás (sacar Seña del todo)

```bash
cd /opt/sena/deploy && docker compose down          # apaga Seña (los datos quedan)
docker compose down -v                              # además borra la base (¡sin vuelta!)
# y borrar el bloque/archivo de proxy que agregaste + reload
```

---

## 10. La instancia real (mainnet): NO va en este servidor

Tenés razón: **la clave privada del agente real no debe vivir en un servidor que comparte otro proyecto.** Quien entre a Kronos (o al servidor, que hoy se administra como `root` por SSH) podría leerla y mover la plata del agente.

**Qué va dónde:**

| Instancia | Claves que lleva | ¿En este VPS? |
|---|---|---|
| **Demo** (`MODE=mock`) | Ninguna de billetera. Solo la clave del panel. | **Sí** |
| NFT en testnet (Sepolia) | Una clave de testnet (fondos sin valor) | Sí, si querés; nunca la misma que la real |
| **Real** (`MODE=live`) | **Clave del agente con plata de verdad** | **No** |

**Dónde poner la real:** en una máquina que no comparta nada con Kronos. Opciones: la VM gratuita de Oracle Cloud (sin el riesgo de compartirla, pero con la advertencia de recuperación por inactividad), Fly.io (~US$2,34 al mes) o, para pocos días, tu propia PC con un túnel. La guía de arriba sirve igual: el mismo `Dockerfile` y el mismo `docker-compose.yml`, descomentando `sena-real`.

**Reglas para la billetera real, esté donde esté:**
- Una billetera **solo para el agente**, con **saldo chico**: el código ya devuelve con topes y retira al dueño todas las noches, así que lo máximo que se puede perder es lo que esté comprometido ese día.
- `OWNER_PAYOUT_ADDRESS` apunta a **tu billetera personal** (nunca a la del agente), así lo que se acumula sale a diario.
- Archivo `real.env` con permisos `600`, fuera de git y sin pegarlo en chats ni capturas.
- Si algún día se filtra: sacá el saldo, generá una clave nueva y volvé a registrar la identidad.

**Del servidor que ya tenés** conviene, aparte de Seña: entrar por **clave SSH** en lugar de contraseña de `root`, y desactivar el ingreso por contraseña. Hoy cualquiera que adivine la contraseña tiene todo.

---

## 11. Qué puede salir mal (y cómo se nota)

| Síntoma | Qué pasa | Qué hacer |
|---|---|---|
| `docker compose ps` dice `unhealthy` o reinicia sin parar | Falta una variable o el puerto está ocupado | `docker logs sena-demo --tail 50` |
| Kronos se pone lento | No debería: Seña tiene techo. Verificalo con `docker stats` y `free -h` | Bajá el límite (`cpus: 0.25`) o apagá Seña con `docker compose stop` |
| El navegador avisa "no seguro" | Falta el certificado (paso 5) | Revisá DNS y `certbot` |
| Se ve el sitio pero el pago no firma | Falta `TRUST_PROXY=true` o `PUBLIC_BASE_URL` no coincide con la URL real | Corregí `demo.env` y `docker compose up -d` |
