# @theaiinc/realm-cloudflare

Runs `realm-api` on [Cloudflare Containers](https://developers.cloudflare.com/containers/), so agents and dashboards can reach Realm without a machine of your own.

```
client ──Bearer token──▶ Worker (realm-api.theaiinc.com) ──▶ RealmContainer (Durable Object) ──▶ realm-api :8542
```

## What runs here

- **Browser realms only.** A Cloudflare container has no Docker daemon, so the container and Ubuntu-desktop engines cannot start. The image sets `REALM_ENGINES=browser`, so `/api/v1/health` doesn't advertise engines it can't run. Run realm-api on your own machine (or a VM with Docker) for those.
- **One instance.** realm-api keeps realms in memory, so every request goes to the same container.
- **Realms don't survive sleep.** After `REALM_SLEEP_AFTER` (default `30m`) without requests, the container stops and its realms are gone. Recreate them after a wake-up.

## Access

Every request, `/api/v1/health` included, needs `Authorization: Bearer <REALM_API_TOKEN>`:

- **The Worker** checks it first, so anonymous traffic never starts (or bills) the container.
- **realm-api** checks it again inside the container.

Without the secret, the Worker answers `503` and realm-api refuses to start on a non-loopback interface.

## Deploy

Docker must be running locally; `wrangler deploy` builds `Dockerfile.api` for `linux/amd64` and pushes it to Cloudflare's registry.

```bash
pnpm install
cd packages/realm-cloudflare
openssl rand -base64 48 | tr -d '\n' | npx wrangler secret put REALM_API_TOKEN
npx wrangler deploy
```

Give the same token to anything that calls Realm. For the Valkyrie dashboard, set `REALM_API_TOKEN` as a secret on its Worker. Its `REALM_API_URL` var points at `https://realm-api.theaiinc.com`.

## Check it

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://realm-api.theaiinc.com/api/v1/realms   # 401
curl -s -H "Authorization: Bearer $REALM_API_TOKEN" https://realm-api.theaiinc.com/api/v1/health
```

The first call after a sleep waits for the container to boot (tens of seconds).
