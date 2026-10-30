# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
# WSLOG_PUBLIC_URL: the container cannot see the host's port mapping, so printed
# links assume `-p 4000:4000`. Override it when you map another port.
ENV NODE_ENV=production \
    WSLOG_HOST=0.0.0.0 \
    WSLOG_PORT=4000 \
    WSLOG_PUBLIC_URL=http://localhost:4000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
ENTRYPOINT ["node", "dist/cli/index.js"]
