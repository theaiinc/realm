FROM mcr.microsoft.com/playwright:v1.51.1-noble
RUN apt-get update && apt-get install -y --no-install-recommends python3 git ca-certificates && corepack enable && rm -rf /var/lib/apt/lists/*
WORKDIR /runner
COPY runner.ts .
RUN npx --yes esbuild runner.ts --bundle --platform=node --outfile=runner.js
ENTRYPOINT ["node", "runner.js"]