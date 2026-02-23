# syntax=docker/dockerfile:1

FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend-react
COPY frontend-react/package*.json ./
RUN npm ci
COPY frontend-react/ ./
RUN npm run build

FROM node:20-alpine AS backend-deps
WORKDIR /app/Backend
COPY Backend/package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 g++ && ln -sf /usr/bin/python3 /usr/bin/python

COPY --from=backend-deps /app/Backend/node_modules ./Backend/node_modules
COPY Backend ./Backend
COPY Frontend ./Frontend
COPY --from=frontend-builder /app/frontend-react/dist ./frontend-react/dist

EXPOSE 5000
CMD ["node", "Backend/server.js"]
