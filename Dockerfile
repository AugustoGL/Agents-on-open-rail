# Seña en un contenedor chico: solo lo necesario para correr (sin pruebas, scripts, video ni capturas).
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY config ./config
COPY contracts/SenaTicket.json ./contracts/SenaTicket.json
COPY agent.json ./agent.json
RUN mkdir -p /data && chown node:node /data
USER node
# Dentro del contenedor escucha en toda la red del contenedor; el compose lo publica solo en 127.0.0.1 del servidor.
ENV HOST=0.0.0.0 PORT=8402 DB_PATH=/data/sena.db
VOLUME /data
EXPOSE 8402
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/negocio').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.js"]
