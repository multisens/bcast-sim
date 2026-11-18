# Broadcaster side simulator. Build context: this repository.
# The emission directory (canais/ and servicos/) defaults to the bundled
# example; mount another one over /app/example, or set EMISSION_DIR.

FROM node:23-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:23-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8082
ENV EMISSION_DIR=/app/example
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY example ./example
EXPOSE 8082
CMD ["node", "dist/server.js"]
