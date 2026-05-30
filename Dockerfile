FROM node:22-slim AS runtime

ARG APP_VERSION=0.2.0
ARG GIT_SHA=

ENV APP_VERSION="${APP_VERSION}" \
    GIT_SHA="${GIT_SHA}" \
    NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

COPY package.json package-lock.json ./
RUN HUSKY=0 npm ci --include=dev

COPY --chown=node:node . .
RUN npm run build

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:5000/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["npm", "run", "start"]
