# Frontend — build estatico servido por nginx
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
RUN npm ci --ignore-scripts

COPY packages/web packages/web
ARG VITE_API_URL=/
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build -w @cronograma/web

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
