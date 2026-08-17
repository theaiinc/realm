# realm-guacd — custom Apache Guacamole proxy daemon (guacd) build.
#
# Forked from the structure of apache/guacamole-server's official
# src/guacd-docker/Dockerfile (Apache-2.0), with one deliberate change:
# VNC support is left OUT entirely. guacd's VNC backend links against
# libvncserver/libvncclient (GPL-2.0) — since this image only needs to
# speak RDP to realm-ubuntu's xrdp bridge, never installing the VNC
# build dependencies (and passing --disable-vnc explicitly) means the
# resulting guacd binary never contains GPL-licensed object code at
# all, sidestepping the GPL/dlopen-plugin question entirely rather
# than just not invoking that protocol at runtime.
#
# RDP support comes from FreeRDP (Apache-2.0) and is auto-enabled by
# guacamole-server's ./configure when libfreerdp-dev is present — there
# is no separate --enable-rdp flag. SSH (libssh2, BSD-style, not GPL)
# is left enabled since it's a useful, license-clean extra; telnet and
# kubernetes support are disabled to keep the image minimal.
#
# Pin GUACAMOLE_VERSION to a specific guacamole-server release tag and
# verify configure flags/package names against that tag's actual
# source before relying on this build — autotools flags have shifted
# across releases.

ARG GUACAMOLE_VERSION=1.5.5

# ------------------------------------------------------------------
# Build stage
# ------------------------------------------------------------------
FROM ubuntu:24.04 AS builder

ARG GUACAMOLE_VERSION
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    autoconf \
    automake \
    build-essential \
    ca-certificates \
    curl \
    libcairo2-dev \
    libjpeg-turbo8-dev \
    libpng-dev \
    libtool \
    libossp-uuid-dev \
    libpango1.0-dev \
    libssh2-1-dev \
    libssl-dev \
    libvorbis-dev \
    libwebp-dev \
    libwebsockets-dev \
    freerdp2-dev \
    libpulse-dev \
    libswscale-dev \
    libavcodec-dev \
    libavformat-dev \
    libavutil-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://dlcdn.apache.org/guacamole/${GUACAMOLE_VERSION}/source/guacamole-server-${GUACAMOLE_VERSION}.tar.gz" \
    -o /tmp/guacamole-server.tar.gz \
    && mkdir -p /usr/src/guacamole-server \
    && tar -xzf /tmp/guacamole-server.tar.gz -C /usr/src/guacamole-server --strip-components=1

WORKDIR /usr/src/guacamole-server

# --disable-vnc: excludes the VNC backend (and its GPL libvncserver
#   dependency) entirely — the actual fix, not just a runtime choice.
# --disable-telnet / --disable-kubernetes: unused protocols, kept out
#   to minimize the image.
# RDP is enabled automatically via the detected libfreerdp2-dev.
RUN autoreconf -fi \
    && ./configure --with-init-dir=/etc/init.d \
        --disable-vnc \
        --disable-telnet \
        --disable-kubernetes \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig

# ------------------------------------------------------------------
# Runtime stage — only the shared libraries guacd actually needs at
# runtime, not the -dev/build toolchain.
# ------------------------------------------------------------------
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libjpeg-turbo8 \
    libpng16-16t64 \
    libossp-uuid16 \
    libpango-1.0-0 \
    libssh2-1 \
    libssl3t64 \
    libvorbis0a \
    libvorbisenc2 \
    libwebp7 \
    libwebsockets19t64 \
    libfreerdp2-2t64 \
    libfreerdp-client2-2t64 \
    libpulse0 \
    libswscale7 \
    libavcodec60 \
    libavformat60 \
    libavutil58 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/lib/ /usr/local/lib/
COPY --from=builder /usr/local/sbin/guacd /usr/local/sbin/guacd

RUN ldconfig

EXPOSE 4822

ENTRYPOINT ["/usr/local/sbin/guacd", "-b", "0.0.0.0", "-f"]
