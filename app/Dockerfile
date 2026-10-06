# Build/promote on linux/amd64; pin the tested base digest in the university release pipeline.
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/certs && curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /app/certs/rds.pem
ENV NODE_EXTRA_CA_CERTS=/app/certs/rds.pem
COPY package.json package-lock.json ./
RUN npm ci
FROM base AS build
COPY . .
ARG NEXT_PUBLIC_ZERO_CACHE_URL
ENV NEXT_PUBLIC_ZERO_CACHE_URL=$NEXT_PUBLIC_ZERO_CACHE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
FROM build AS runtime
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000 4848
RUN chown -R node:node /app
USER node
CMD ["npm", "start", "--", "--hostname", "0.0.0.0"]
