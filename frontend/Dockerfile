# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS builder

WORKDIR /app

ARG VITE_ENABLE_DEV_LOGIN_DEFAULTS=false
ARG VITE_DEV_LOGIN_EMAIL=
ARG VITE_DEV_LOGIN_PASSWORD=
ARG VITE_DEFAULT_LANG=de
ARG VITE_RELEASE_CHANNEL=production
ARG VITE_BUILD_NUMBER=
ARG VITE_BUILD_TIMESTAMP=

ENV VITE_ENABLE_DEV_LOGIN_DEFAULTS=${VITE_ENABLE_DEV_LOGIN_DEFAULTS}
ENV VITE_DEV_LOGIN_EMAIL=${VITE_DEV_LOGIN_EMAIL}
ENV VITE_DEV_LOGIN_PASSWORD=${VITE_DEV_LOGIN_PASSWORD}
ENV VITE_DEFAULT_LANG=${VITE_DEFAULT_LANG}
ENV VITE_RELEASE_CHANNEL=${VITE_RELEASE_CHANNEL}
ENV VITE_BUILD_NUMBER=${VITE_BUILD_NUMBER}
ENV VITE_BUILD_TIMESTAMP=${VITE_BUILD_TIMESTAMP}

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm npm ci --legacy-peer-deps

COPY . .

RUN npm run build

FROM nginx:1.30-alpine AS runtime

ARG ALPINE_SECURITY_REFRESH=local

RUN echo "security-refresh=${ALPINE_SECURITY_REFRESH}" >/dev/null \
  && apk upgrade --no-cache

ENV GMED_BACKEND_UPSTREAM=http://backend:3000

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

