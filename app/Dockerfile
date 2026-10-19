# Self-hosting image: the app with one SQLite file as database.
# Build from the repository root, because the app uses the shared brand assets:
#   docker build -f app/Dockerfile -t mietkartei .

FROM node:26-slim AS build
WORKDIR /src/app
COPY app/package.json app/package-lock.json ./
# better-sqlite3 ships prebuilt binaries, but some npm versions still try to compile it with
# node-gyp, which the slim image cannot. No other install script is needed for the node build.
RUN npm ci --ignore-scripts
COPY assets/brand /src/assets/brand
COPY app ./
RUN DEPLOY_TARGET=node npm run build && npm prune --omit=dev

FROM node:26-slim
ENV NODE_ENV=production \
	PORT=3000 \
	DATABASE_PATH=/data/mietkartei.db
WORKDIR /app
COPY --from=build /src/app/package.json /src/app/server.js ./
COPY --from=build /src/app/node_modules ./node_modules
COPY --from=build /src/app/build ./build
COPY --from=build /src/app/drizzle ./drizzle
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
	CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
