FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
RUN npm ci
COPY apps/backend/tsconfig*.json ./apps/backend/
COPY apps/backend/src ./apps/backend/src
RUN npm run build --workspace=@pikaai/backend

FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
RUN npm ci --omit=dev --workspace=@pikaai/backend --include-workspace-root=false && npm cache clean --force

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=dependencies --chown=node:node /app/apps/backend ./apps/backend
COPY --from=build --chown=node:node /app/apps/backend/dist ./apps/backend/dist
USER node
WORKDIR /app/apps/backend
EXPOSE 3001
CMD ["node", "dist/server.js"]
