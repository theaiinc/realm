# @theaiinc/realm-host

A narrow, allowlisted host-process launcher.

## Why this exists, and why it's narrow

This project's design principle (see [docs/product-design.prd](../../docs/product-design.prd)) is explicit: *"The agent never works directly on the host machine,"* with **"No Host Applications," "No Host Desktop"** listed as hard restrictions. Every other engine in this repo (`realm-container`, `realm-browser`, `realm-ubuntu`) runs inside Docker for exactly that reason.

Android Auto testing is a genuine exception: Google publishes no `linux-aarch64` build of the Android Emulator at all, and running the officially-published `linux-x64` build inside an emulated `x86_64` container on Apple Silicon Docker Desktop crashes outright (Rosetta 2's translation layer can't run the emulator's internal QEMU/TCG engine — see the plan's Phase 0 findings). The only path that actually works is Google's native `macosx-aarch64` emulator build, running as a host process with real Hypervisor.framework acceleration.

`HostEngine` is the deliberate, scoped way to allow exactly that — not a general escape hatch:

- **Hardcoded allowlist, not configuration.** `host-types.ts`'s `ALLOWED_TARGETS` is a source-code constant. Adding a new target means writing code, not passing a new string through `RealmConfig`.
- **No arbitrary `execute()`.** Every `RealmEngine` operation that would imply general host access (`execute`, `navigate`, `scroll`, `importFile`, `exportFile`, `listFiles`, `setNetworkMode`, `pause`, `resume`) throws `HOST_OPERATION_NOT_SUPPORTED` — stated plainly in code (`host-engine.ts`), not just in this doc.
- **No credential automation.** Signing into the Google account the Android Auto app needs, and enabling its Developer Settings → "Start head unit server" toggle, are one-time manual setup steps done by hand before using this engine. This codebase never enters credentials or creates accounts on a user's behalf, and that rule applies here too.
- **Gated behind an explicit opt-in in `realm-api`** (`ENABLE_HOST_ENGINE=true`) — see `packages/realm-api/src/server.ts` — so this capability isn't silently available on every `realm-api` instance by default.

## Usage

```ts
import { HostEngine } from '@theaiinc/realm-host';

const engine = new HostEngine();
const realmId = await engine.create({
  name: 'android-auto-test',
  environment: { HOST_TARGET: 'android-auto', AVD_NAME: 'Pixel_9_Pro' },
});
await engine.start(realmId); // boots the AVD, connects Desktop Head Unit
const screenshot = await engine.capture(realmId); // full-screen capture (see below)
await engine.stop(realmId);
```

`AVD_NAME` defaults to `Pixel_9_Pro` and must already exist (created via `avdmanager`) with the Android Auto app already installed and signed in — this engine only launches it, it doesn't provision it.

Android Auto's "Start head unit server" toggle (app → Developer Settings → overflow menu) is a runtime service start, not a persisted setting — it does not survive an emulator restart. `start()` automates this itself via `uiautomator` (see `targets/android-auto.ts`'s `startHeadUnitServer`), polling for each UI element rather than using fixed delays, so no manual step is needed on a fresh boot. It also automates the notification-listener access grant Android Auto otherwise blocks on. `start()` retries connecting Desktop Head Unit for ~45s after that; if it still fails, the error tells you exactly what to check.

### Device capabilities

Location, app install, and file import/export are dynamic — usable any time after `start()`, via `RealmAPI.setLocation`/`installApp`/`importFile`/`exportFile` (REST: `POST /realms/:id/location`, `/install`, `/import`, `/export`).

Camera and microphone are launch-time only — the emulator reads them once at process start, with no known `adb`-level hot-swap:
- `environment.CAMERA_BACK` / `CAMERA_FRONT` — passed straight through as `-camera-back`/`-camera-front` (see `emulator -help`; values include `emulated`, `webcam<N>`, `virtualscene`, `none`).
- `environment.MICROPHONE_HOST_AUDIO=true` — passes `-allow-host-audio`, which routes the Mac's actual selected input device into the guest's virtual mic. Without it, the emulator zeroes out mic input entirely. There's no way to inject a *specific* prerecorded file/PCM stream via this package — see Known limitations.

## Host dependencies

- **Android SDK** (`emulator`, `adb`, `desktop-head-unit`) — resolved from `$ANDROID_SDK_ROOT`/`$ANDROID_HOME`, falling back to `~/Library/Android/sdk`. Not installed by this package.
- **[cliclick](https://github.com/BlueM/cliclick)** (MIT) — `brew install cliclick`. Used for `click()`. AppleScript's `System Events click at {x,y}` was tried first but consistently failed with a permission error that didn't resolve across granting Accessibility/Input Monitoring/Screen Recording and a full reboot, while `keystroke`-based actions (`typeText`/`keyPress`, still AppleScript) worked fine under the identical grants — meaning it wasn't actually a permission problem, just that command specifically. `cliclick` posts real CGEvents directly and was verified to land the pointer exactly and click successfully under the same conditions where `click at` kept failing. Resolved from the standard Homebrew install paths directly (not bare-name `PATH` lookup — Homebrew's bin directory isn't guaranteed to be on `PATH` for every process that might run `realm-api`).

## Known limitations

- `capture()` is a full-screen `screencapture`, not a window-specific crop — macOS window-ID resolution via AppleScript/System Events proved unreliable during manual validation. Fine for a secondary view; `realm-ui`'s primary panel is the real-time Guacamole stream of the container desktop.
- `keyPress` is best-effort via AppleScript `keystroke` — named keys (Return, Tab, Escape, ...) aren't mapped to AppleScript key codes yet, only literal characters.
- **No file/PCM microphone injection.** The emulator ships a documented gRPC RPC for exactly this (`injectAudio` in `emulator_controller.proto`, launched via `-grpc <port>`), and it looked like the right tool — but it reproducibly **crashed the emulator process itself** (a Mach exception, not a clean RPC error) on two separate spike attempts with materially different request encodings (string vs. numeric enum values, multi-chunk stream vs. a single small packet). Build/host combo where this was confirmed: emulator 35.4.9-13025442, API 36 `Pixel_9_Pro` AVD, macOS/Apple Silicon with HVF acceleration. Shipping that path would trade "mic input isn't scriptable yet" for "the realm can crash outright the first time an agent tries to use it," which is worse than not having the feature. `MICROPHONE_HOST_AUDIO` (host mic passthrough, see above) is the only mic mechanism implemented. Revisit `injectAudio` if a future emulator release fixes the crash.
