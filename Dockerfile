# One image for every service: mcp-server now, other packages later.
FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/knowledge-base/package.json packages/knowledge-base/
COPY packages/finance/package.json packages/finance/
COPY packages/briefing/package.json packages/briefing/
COPY packages/bot/package.json packages/bot/
COPY packages/dashboard/package.json packages/dashboard/

FROM base AS build
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY packages packages
RUN pnpm build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
# Nothing here runs npm, npx or corepack, and the copies in the base image carry
# advisories of their own. A package that has a fix in Debian but not yet in the
# base image is upgraded here, so the build is not exactly the base image's.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
 && apt-get update \
 && apt-get install -y --no-install-recommends --only-upgrade perl-base \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app ./
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/mcp-server/dist packages/mcp-server/dist
COPY --from=build /app/packages/knowledge-base/dist packages/knowledge-base/dist
COPY --from=build /app/packages/finance/dist packages/finance/dist
COPY --from=build /app/packages/briefing/dist packages/briefing/dist
COPY --from=build /app/packages/bot/dist packages/bot/dist
COPY --from=build /app/packages/dashboard/dist packages/dashboard/dist
COPY packages/core/migrations packages/core/migrations
USER node
CMD ["node", "packages/mcp-server/dist/http-main.js"]
