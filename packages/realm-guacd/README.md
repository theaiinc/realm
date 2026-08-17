# @theaiinc/realm-guacd

Custom-built `guacd` (Apache Guacamole's proxy daemon) for Realm's RDP streaming pipeline.

## Why a custom build instead of `guacamole/guacd` from Docker Hub

The official `guacamole/guacd` image is a general-purpose build that links in every protocol backend it can — including VNC support via `libvncserver`/`libvncclient`, which is **GPL-2.0**. This repo only reuses permissively-licensed (MIT/Apache-2.0/BSD) components, and only ever needs guacd to speak **RDP** (to `realm-ubuntu`'s `xrdp` bridge, see `packages/realm-ubuntu/assets/xrdp.ini`).

Simply not sending `protocol: 'rdp'`... sorry, not sending `protocol: 'vnc'` at runtime doesn't resolve the underlying licensing question of what's compiled into the binary you distribute — dynamically-loaded plugin boundaries are a genuinely unsettled area of GPL interpretation. Rather than rely on that, this Dockerfile builds `guacd` from source **without ever installing the VNC build dependencies**, and passes `--disable-vnc` explicitly. The resulting binary never contains `libvncserver`/`libvncclient` object code at all — a clean fix, not a runtime workaround.

RDP support comes from **FreeRDP** (Apache-2.0), auto-enabled by `guacamole-server`'s `./configure` when `libfreerdp2-dev` is present. SSH (`libssh2`, BSD-style) is left enabled as a low-cost, license-clean extra. Telnet and Kubernetes exec support are disabled to keep the image minimal — neither is used by this repo.

## Rebuilding against a newer `guacamole-server` release

Package names and `./configure` flags have shifted across `guacamole-server` releases. Before bumping `GUACAMOLE_VERSION` in the `Dockerfile`:

1. Check that release's `src/guacd-docker/Dockerfile` in [apache/guacamole-server](https://github.com/apache/guacamole-server) for its current build/runtime dependency lists.
2. Confirm `--disable-vnc` is still the correct flag (and that no VNC-related package sneaks into the dependency list).
3. Rebuild and verify `guacd -v` reports RDP support and no VNC support.

## Usage

```bash
pnpm build:docker
docker run -d --name realm-guacd -p 4822:4822 realm-guacd
```

`realm-client`'s `guacamole-lite`-based WebSocket proxy connects to this daemon on port `4822` and forwards RDP connections to `realm-ubuntu` containers over `host.docker.internal:<published rdpPort>`.
