# Social Hub — one container running the web app and the worker side by side
# (they share the SQLite database and the video folder on one Railway volume).

# ── whisper.cpp: free captions on the server ─────────────────────────────
FROM debian:bookworm-slim AS whisper
ARG WHISPER_VERSION=v1.7.4
ARG WHISPER_MODEL=base.en
RUN apt-get update && apt-get install -y --no-install-recommends git cmake build-essential ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp /src \
 && cmake -S /src -B /src/build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DGGML_NATIVE=OFF \
 && cmake --build /src/build -j "$(nproc)" --config Release --target whisper-cli \
 && mkdir -p /opt/whisper && cp /src/build/bin/whisper-cli /opt/whisper/whisper-cli \
 && bash /src/models/download-ggml-model.sh "$WHISPER_MODEL" /opt/whisper \
 && rm -rf /src

# ── app build ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── runtime ───────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
COPY --from=whisper /opt/whisper /opt/whisper
COPY --from=build /app /app
ENV NODE_ENV=production \
    PORT=3100 \
    DATA_DIR=/data \
    DB_FILE=/data/hub.db \
    MEDIA_DIR=/data/media \
    BACKUP_DIR=/data/backups \
    WHISPER_CPP_BIN=/opt/whisper/whisper-cli \
    NEXT_TELEMETRY_DISABLED=1
EXPOSE 3100
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "deploy/railway/start.sh"]
