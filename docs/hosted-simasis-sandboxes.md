# Hosted Simasis Sandboxes on Realm Cloudflare

Status: design for review only. No Cloudflare resources, paid services, secrets, or deployments are created by this proposal.

## Decision

Hosted Simasis will execute Terminal sessions and agent commands in a dedicated Realm sandbox for each Simasis user, rather than in the shared dev-agent container. This design is hosted-only: Simasis Desktop continues running locally and is not changed by this work. The first implementation target is Cloudflare account `32351d590fd6134e6c2328cc976952f7`, using the existing `@theaiinc/realm-cloudflare` Worker and Container/Durable Object pattern.

A sandbox is addressed by an opaque Realm/user identifier, never by an account-wide shared workspace. It contains only that user's project files. Hosted workspace files are synchronized into the sandbox before use and changed files are synchronized back through an explicit, audited operation. A future mounted/object-backed implementation may replace synchronization, but must preserve the same boundary.

The existing Cloudflare package currently runs browser-only `realm-api` in one named container instance, keeps state in memory, and loses realms when the container sleeps. Interactive coding requires a new per-user lifecycle and durable metadata; it must not rely on the current global in-memory instance.

## API proposal

All endpoints use the existing Bearer authentication at the Worker and `realm-api`. The Simasis gateway remains responsible for mapping its authenticated user to an opaque Realm ID; clients cannot choose another user's ID.

### PTY session

One active terminal is allowed per user. A proposed API, matching the Terminal panel's open/input/output/resize/close model, is:

- `POST /api/v1/realms/:id/terminal` with `{ cwd?, cols?, rows?, command? }` -> `201 { sessionId, cols, rows }`
- `POST /api/v1/realms/:id/terminal/:sessionId/input` with raw bytes or `{ data }` -> `202`
- `GET /api/v1/realms/:id/terminal/:sessionId/output?offset=N` -> `{ data, nextOffset, closed, exitCode? }`
- `POST /api/v1/realms/:id/terminal/:sessionId/resize` with `{ cols, rows }` -> `202`
- `DELETE /api/v1/realms/:id/terminal/:sessionId` -> `202`

Output is append-only and offset-addressable so reconnects do not duplicate bytes. The server owns the PTY, process group, working-directory validation, shutdown timers, and audit events. No inbound connection reaches the sandbox; the gateway polls or streams through the authenticated Realm API.

### Agent one-shot execution

- `POST /api/v1/realms/:id/exec` with `{ command, cwd?, timeoutSec?, env? }` -> `{ executionId }`
- `GET /api/v1/realms/:id/exec/:executionId?offset=N` -> state, exit code, output, and next offset
- `DELETE /api/v1/realms/:id/exec/:executionId` -> cancellation

The existing long-running job shape should be reused where possible. Agent execution is non-interactive, has the same path and environment restrictions as PTY sessions, and cannot access host processes, sockets, credentials, or other Realm IDs.

## Isolation and limits

Each user gets one isolated sandbox boundary with no privileged mode, no host filesystem mounts, no Docker socket, and no access to the shared hosted server. Only the user's project snapshot is placed under the sandbox workspace; temporary files are discarded on shutdown unless explicitly included in the sync-back result.

Initial policy defaults:

| Control | Proposed default | Enforcement |
|---|---:|---|
| CPU | 1 vCPU burst, configurable ceiling | Cloudflare container/resource setting |
| Memory | 2 GiB | container limit; terminate on breach |
| Disk | Per-plan configured workspace plus bounded temporary space; 10 GiB for unknown/free plans | quota before sync and during writes |
| Processes | 128 total, 32 per session/process tree | PID/cgroup/container policy |
| Idle shutdown | 15 minutes without terminal/exec activity | Realm lifecycle timer |
| Maximum PTY session | 2 hours | forced TERM then KILL |
| Maximum one-shot exec | Per-plan configured limit; 6 hours for unknown/free plans | execution timeout |
| Daily compute | Per-plan quota from configuration; 60 CPU-minutes for unknown/free plans | Simasis/Realm quota ledger |
| Concurrent terminals | 1 per user | durable per-user session lock |
| Concurrent execs | 1 while PTY is active; otherwise 1 | per-user scheduler |

Rejected requests return a stable limit error and create an audit event. Quota values are configuration, not a bypassable client field. Cloudflare/container limits and actual pricing must be confirmed before implementation; the design does not assume that a particular Cloudflare plan supports these exact controls.

## Network policy

Default deny applies to all egress. The sandbox has no inbound exposure. An allowlist must be enforced at the egress layer, not merely documented in the application:

- package registries required by the approved toolchain;
- the user's explicitly authorized Git host/repository endpoints;
- approved documentation sites required by the product.

DNS, IP ranges, redirects, ports, and proxy CONNECT targets must be checked against the allowlist. Requests to other destinations fail closed and are audited. Git credentials are never injected as ordinary environment variables or files.

The initial allowlist must be narrow and versioned. Adding a host requires product/security review and must not be user-controlled.

## Arcana credential broker

Secrets never enter the sandbox. Hosted Realm configuration contains references such as `arcana://github/simasis-user-token`, never secret values. This replaces the hosted `SANDBOX_SECRETS` path that depends on Docker's global secret store and the Mac Arcana CLI.

Required Arcana interface (to be agreed with the Arcana project) is documented separately in `docs/arcana-broker-contract.md`. Steps 2–3 define and test only Realm-side interfaces against a deterministic fake broker; they do not depend on a live Arcana service:

```text
POST /v1/egress/authorize
{
  "reference": "arcana://github/simasis-user-token",
  "sandboxId": "...",
  "userId": "...",
  "host": "github.com",
  "method": "GET",
  "path": "/org/repo.git",
  "requestId": "..."
}
-> { "decision": "allow", "lease": "...", "expiresAt": "..." }

POST /v1/egress/proxy
{
  "lease": "...",
  "sandboxId": "...",
  "host": "github.com",
  "request": "opaque request metadata"
}
-> proxied response; credential is added only inside the broker
```

The actual transport may be a private service binding or mutually authenticated proxy. The sandbox sees only the response, never the credential, lease secret, or broker storage. Arcana must enforce the reference-to-secret mapping, user/sandbox binding, exact named-host policy, method/path policy, expiry, replay protection, and rate limits. Every allow, deny, use, and failure must be logged with user, sandbox, reference (not value), host, request ID, and outcome. Realm must fail closed if Arcana is unavailable.

Realm needs from Arcana:

1. The production endpoint and authentication/service-binding model.
2. The exact authorization and proxy protocol, including streaming Git/package traffic.
3. Host/path/method policy semantics and redirect handling.
4. Lease TTL, rotation, revocation, rate limits, and failure behavior.
5. Audit event schema and retention/export contract.
6. A test broker or deterministic fake for Realm integration tests.

## Audit and file lifecycle

Realm records command metadata, not secret values: user ID, sandbox ID, session/execution ID, command (with sensitive arguments redacted where configured), cwd, timestamps, requested limits, exit state, network policy decisions, file sync direction, byte counts, and quota consumption. PTY input/output retention is configurable and defaults to metadata plus bounded output retention.

Creation, wake, command start, resize, cancellation, timeout, process-limit kill, network allow/deny, Arcana authorization/use, sync-in, sync-out, and destruction are audit events. Audit records must be append-only to a store outside the sandbox.

Sync-in and sync-back are explicit gateway operations. Paths are relative, normalized, and rejected if absolute or escaping the project root. Symlinks are checked to prevent escape. Sync-back has size/count limits and excludes credentials, `.git` internals where policy requires, and sandbox runtime state.

## Cost and approval gate

Nothing billable is created and nothing deploys until Steve explicitly approves this design and the implementation plan. In particular, this PR creates no Worker, Durable Object, Container, R2 bucket, service binding, Arcana deployment, proxy, or external network resource.

Potentially paid resources requiring an estimate and approval are:

- Cloudflare Workers requests and CPU time;
- Durable Objects storage, requests, and duration;
- Cloudflare Containers runtime, vCPU, memory, and execution duration;
- persistent object storage for project snapshots, logs, and audit records;
- egress/proxy traffic and any paid network gateway;
- Arcana broker compute, secret storage, requests, logging, and retention;
- observability, retention, and alerting services;
- Simasis-hosted gateway compute and any synchronization bandwidth.

A cost model must use measured session duration, CPU/memory allocation, storage size, sync frequency, log volume, and daily quota before production approval.

## Delivery sequence

1. Approve this design and reconcile the Arcana contract. Simasis Desktop remains local and is explicitly outside this hosted delivery sequence.
2. Add core PTY/exec interfaces, policy types, audit events, and tests without deployment.
3. Implement a local/fake Cloudflare adapter and folder-backed PTY tests.
4. Implement per-user Cloudflare lifecycle, egress enforcement, quotas, and durable metadata.
5. Integrate Simasis file synchronization and Arcana proxy calls.
6. Run security, abuse, quota, reconnect, timeout, and leakage tests.
7. Steve approves paid resources and deployment separately; only then create infrastructure and deploy.