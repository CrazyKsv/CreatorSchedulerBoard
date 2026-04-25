# Production frontend image: Vite build → nginx static serve.
#
# Build arg VITE_API_URL is inlined into the bundle at build time by Vite
# (see frontend/src/api/client.js). For the minikube Helm deploy, the
# ingress serves the API on the same host under /api/v1, so the default
# relative value below works unchanged.

# --- Stage 1: build the static assets with Vite --------------------------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# --- Stage 2: serve with nginx ------------------------------------------
FROM nginx:1.27-alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
