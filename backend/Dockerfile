# Build from the repository root: docker build -f backend/Dockerfile -t autoguardian-backend .
FROM node:22-bookworm-slim AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 ALLOW_DEV_EMAIL_AUTH=false
WORKDIR /app/backend
COPY --from=build --chown=node:node /app/backend/package.json ./
COPY --from=build --chown=node:node /app/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/dist ./dist
COPY --chown=node:node backend/scripts/check-telecom-setup.cjs ./scripts/
COPY --chown=node:node backend/scripts/check-telecom-http.cjs ./scripts/
COPY --chown=node:node supabase/verify-*.sql /app/supabase/
USER node
EXPOSE 3000
# Supply secrets through the host's environment. No .env is copied into the image.
CMD ["node", "dist/main.js"]
