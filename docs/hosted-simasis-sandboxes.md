# Hosted Simasis Sandboxes on Realm Cloudflare

Status: design for review only. No Cloudflare resources, paid services, secrets, or deployments are created by this proposal.

## Decision

Hosted Simasis will execute Terminal sessions and agent commands in a dedicated Realm sandbox for each Simasis user, rather than in the shared dev-agent container. The first implementation target is Cloudflare account `32351d590fd6134e6c2328cc976952f7`, using the existing `@theaiinc/realm-cloudflare` Worker and Container/Durable Object pattern.

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
| Disk | 10 GiB workspace plus bounded temporary space | quota before sync and during writes |
| Processes | 128 total, 32 per session/process tree | PID/cgroup/container policy |
| Idle shutdown | 15 minutes without terminal/exec activity | Realm lifecycle timer |
| Maximum PTY session | 2 hours | forced TERM then KILL |
| Maximum one-shot exec | 6 hours, lower default for agent calls | execution timeout |
| Daily compute | 60 CPU-minutes per user initially | Simasis/Realm quota ledger |
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

Secrets never enter the sandbox. Hosted Realm configuration contains only opaque references such as `arcana://github/simasis-app`, never credential values. This replaces the hosted `SANDBOX_SECRETS` path that depends on Docker's global secret store and the Mac Arcana CLI.

Credentialed traffic uses HTTPS routing, not a JSON proxy endpoint and not TLS interception. Inside the sandbox, tool configuration routes approved hosts to the broker:

```text
git config --global url."https://broker.example/github.com/".insteadOf https://github.com/
npm config set registry https://broker.example/npm/
```

The exact broker hostname and tool configuration will be supplied by Arcana. The broker authenticates the sandbox-bound short-lived lease, checks the per-secret policy, and forwards the request to the named upstream host while adding the credential only at the broker. The sandbox receives ordinary upstream responses and never receives the credential, a standing token, or a CA for TLS interception. Realm must reject direct access to credentialed hosts unless it passes through the broker route.

For GitHub, Arcana issues a short-lived GitHub App installation token derived for the requested repository and sandbox/user, rather than a standing user token. The token is never placed in an environment variable, file, command line, or Realm configuration. A lease is short-lived, bound to one sandbox, user, upstream host, repository/policy, and request scope; it is presented to the broker through the configured route and expires or is revoked without leaving a reusable secret in the workspace.

The broker must stream request and response bodies without buffering whole Git packfiles, clones, pushes, npm packages, or large tarballs. It must preserve status, headers, and backpressure while stripping credential-bearing headers before responses return to the sandbox. Redirects are followed only when the destination remains on the explicitly allowlisted host and policy; redirects to another host are refused unless that host is independently allowlisted and authorized by a new lease. DNS rebinding, proxy CONNECT, alternate ports, and direct-IP bypasses fail closed.

Required Arcana interface (to be agreed with the Arcana project):

```text
POST /v1/egress/leases
{
  "reference": "arcana://github/simasis-app",
  "sandboxId": "...",
  "userId": "...",
  "host": "github.com",
  "repository": "org/repo",
  "scope": "contents:read",
  "requestId": "..."
}
-> { "decision": "allow", "lease": "...", "expiresAt": "...", "route": "..." }
```

The broker's route accepts the lease and streams the HTTP request to the named host. Arcana checks reference-to-secret mapping, user/sandbox binding, exact host and repository policy, method/path scope, expiry, replay protection, rate limits, and redirect destinations. Every allow, deny, use, redirect refusal, and failure is logged with user, sandbox, reference (not value), host, repository, request ID, byte counts, and outcome. Realm fails closed if Arcana is unavailable or the lease is invalid.

Realm needs from Arcana:

1. The production endpoint and authentication/service-binding model for the HTTPS route.
2. The lease format, presentation mechanism, TTL, renewal, revocation, replay protection, and failure behavior.
3. GitHub App installation-token derivation and repository/scope policy semantics.
4. Streaming guarantees, maximum body sizes, timeout behavior, and backpressure handling.
5. Redirect, DNS, port, and direct-IP enforcement semantics.
6. Audit event schema, retention/export contract, and correlation IDs.
7. A test broker or deterministic fake for Realm integration and leakage tests.

## Audit and file lifecycle

Realm records command metadata, not secret values: user ID, sandbox ID, session/execution ID, command (with sensitive arguments redacted where configured), cwd, timestamps, requested limits, exit state, network policy decisions, file sync direction, byte counts, and quota consumption. PTY input/output retention is configurable and defaults to metadata plus bounded output retention.

Creation, wake, command start, resize, cancellation, timeout, process-limit kill, network allow/deny, Arcana authorization/use, sync-in, sync-out, and destruction are audit events. Audit records must be append-only to a store outside the sandbox.

Sync-in and sync-back are explicit gateway operations. Paths are relative, normalized, and rejected if absolute or escaping the project root. Symlinks are checked to prevent escape. Sync-back has size/count limits and excludes credentials, `.git` internals where policy requires, and sandbox runtime state.

## Cost and approval gate

Nothing billable is created and nothing deploys until Steve explicitly approves this design and the implementation plan. In particular, this PR creates no Worker, Durable Object, Container, R2 bucket, service binding, Arcana deployment, proxy, or external network resource.

Pricing references (verify at approval time):

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) — requests and CPU time.
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) — requests, duration, and storage.
- [Containers pricing](https://developers.cloudflare.com/containers/pricing/) — vCPU, memory, and runtime.
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/) — snapshot storage and operations.
- [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/) — CPU and request ceilings.

Illustrative Cloudflare-only estimate, using the published list prices linked above and intentionally rounded upward for planning:

- **Default active user:** 2 hours/day of terminal availability, mostly idle, one 0.25 vCPU / 512 MiB sandbox, 30 days, 1 GiB of snapshots, 100 terminal reconnects, and 10 GiB of combined sync traffic: approximately **$2–$5/user/month**. The range depends mainly on whether an idle Container remains allocated; the 15-minute idle shutdown is therefore a material cost control.
- **Quota ceiling:** 60 CPU-minutes/day, 30 days, with the same 0.25 vCPU / 512 MiB limits and 1 GiB of snapshots: approximately **$1–$3/user/month** for compute and Durable Object coordination, before network egress and Arcana costs. This is a CPU-use ceiling, not permission to keep a container resident all day.
- **Snapshot storage:** 1 GiB retained in R2 is approximately **$0.015/month**, plus request and egress charges; 10 GiB is approximately **$0.15/month** before those variable charges. Snapshot size and retention should be capped per user.

These are planning estimates, not a quote: Cloudflare billing dimensions, regional availability, container minimums, R2 operation counts, egress, Arcana broker compute, observability, and Simasis synchronization bandwidth must