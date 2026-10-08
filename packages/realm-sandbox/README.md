# @theaiinc/realm-sandbox

Docker Sandbox engine for Realm: a realm runs in a [Docker Agentic Platform](https://agentic-platform.docker.com) sandbox, in Docker's cloud or on the local machine, driven through the `sbx` CLI.

Docker provides the isolation Realm promises: each sandbox is its own microVM, egress goes through a policy proxy, and credentials (Anthropic, GitHub, …) are injected by that proxy, so they never enter the sandbox. A *kit* decides what runs inside: an agent (`claude`, `codex`, `shell`) or your own kit directory, OCI artifact or git URL.

The engine is headless: `execute`, file import/export/list, lifecycle and network policy. `capture`, `click`, `type`, `keyPress`, `scroll` and `navigate` throw `SANDBOX_OPERATION_NOT_SUPPORTED`.

## Setup

```sh
brew trust docker/tap && brew install docker/tap/sbx
sbx login
sbx --cloud secret set anthropic   # whatever credentials your kit declares
```

realm-api registers the engine only when asked, because it needs a signed-in `sbx` and cloud sandboxes bill per second:

```sh
ENABLE_DOCKER_SANDBOX_ENGINE=true pnpm realm:api
```

## Creating a realm

Engine settings travel in the realm's `environment` (the same convention as realm-host's `HOST_TARGET`). Every other key becomes an environment variable inside the sandbox.

| Key | Meaning |
|---|---|
| `SANDBOX_KIT` | Agent name or kit reference. **Required.** |
| `SANDBOX_KIT_ARGS` | `name=value` pairs separated by `;` |
| `SANDBOX_CLOUD` | `false` for a local sandbox (default: cloud) |
| `SANDBOX_CPUS`, `SANDBOX_MEMORY` | Size, e.g. `1` and `2g` (cloud default: 2 CPUs, 4 GiB) |
| `SANDBOX_TTL` | Cloud time-to-live, e.g. `45m`; the sandbox stops when it lapses |
| `SANDBOX_ALLOW_NETWORK` | Extra egress hosts, comma separated |

```sh
curl -X POST localhost:8542/api/v1/realms -H 'content-type: application/json' -d '{
  "name": "build-bot",
  "engine": "docker-sandbox",
  "environment": { "SANDBOX_KIT": "claude", "SANDBOX_CPUS": "1", "SANDBOX_MEMORY": "2g", "SANDBOX_TTL": "45m" }
}'
```

| Realm | sbx |
|---|---|
| `start` (first) | `sbx [--cloud] run <kit> --detached --name <realm>-<id> …` |
| `stop` / `pause` | `sbx [--cloud] stop` (state is kept; a stopped sandbox isn't billed) |
| `start` (again) / `resume` | `sbx [--cloud] run --name … --detached` |
| `destroy` | `sbx [--cloud] rm --force` |
| `execute` | `sbx [--cloud] exec <sandbox> <command> …` |
| `importFile` / `exportFile` | `sbx [--cloud] cp` |
| `setNetworkMode(restricted, hosts)` | `sbx [--cloud] policy allow network --sandbox …` |

Network modes: `restricted` (default) is the kit's allowlist plus `SANDBOX_ALLOW_NETWORK`; `full` adds `--allow-network '*'` at creation; `disabled` is refused, because every sandbox reaches its agent's API through Docker's proxy.

## Notes

- Local sandboxes need `sbx policy init <allow-all|balanced|deny-all>` once per machine.
- In a cloud sandbox, a kit credential marked `required` fails Docker's kit build (the bake sandbox has no secrets); declare it optional and let the workload report a missing credential.
- `--static-mcp` (MCP servers fixed at creation) only accepts Docker's hosted catalog; custom MCP servers are attached from the web UI.

## Test

```sh
pnpm --filter @theaiinc/realm-sandbox test
```

The unit tests drive the engine against a fake `sbx`. Against the real CLI, the engine was run end to end on a local sandbox (create, start, exec with realm environment, list files, destroy).
