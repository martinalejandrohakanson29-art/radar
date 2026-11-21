FROM node:22-alpine
RUN apk add --no-cache curl tzdata
WORKDIR /app
COPY radar.mjs server.mjs config.json ./
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 TZ=America/Argentina/Buenos_Aires
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server.mjs"]
