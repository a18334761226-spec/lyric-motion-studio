# Lyric Motion Studio — 一键容器
# 内置 Node 24、ffmpeg、Chromium 与中文字体：不需要在宿主机装任何依赖
FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    CHROME_PATH=/usr/bin/chromium \
    HOST=0.0.0.0 \
    PORT=5099 \
    NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      chromium \
      fonts-noto-cjk \
      fonts-noto-core \
      ca-certificates \
      tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

EXPOSE 5099
VOLUME ["/app/data"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist-server/server.js"]
