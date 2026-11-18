# Broadcaster side simulator. Build context: this repository.
# The services directory defaults to the bundled example; mount another one
# over /app/example/servicos, or set SERVICES_DIR.

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
ENV SERVICES_DIR=/app/example/servicos
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY example ./example
EXPOSE 8082
CMD ["node", "dist/server.js"]
