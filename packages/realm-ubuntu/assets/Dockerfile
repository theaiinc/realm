# realm-ubuntu — Ubuntu Desktop for AI agent computer-use
#
# Based on Ubuntu 24.04 (Noble) with XFCE4 desktop environment,
# xdotool + ImageMagick for input/screenshot, and embedded
# Yggdrasil Ratatoskr daemon for orchestration.
#
# Capability presets available: agent, code, shell, python,
#   node_runtime, github_cli, web_search, llm
#
# Ratatoskr starts automatically inside the container and registers
# with Yggdrasil via env vars (YGGDRASIL_URL, API_KEY, etc.)

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
ENV TZ=UTC
ENV DISPLAY=:99
ENV SHELL=/bin/bash

# ------------------------------------------------------------------
# Base system + locale
# ------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    wget \
    gnupg \
    lsb-release \
    software-properties-common \
    locales \
    tzdata \
    sudo \
    && locale-gen en_US.UTF-8 \
    && update-locale LANG=en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------
# XFCE4 desktop + display tools
# ------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    xfce4 \
    xfce4-goodies \
    xvfb \
    x11vnc \
    xdotool \
    x11-utils \
    x11-xserver-utils \
    imagemagick \
    dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------
# Browsers
# ------------------------------------------------------------------
# Firefox ESR via Mozilla PPA
RUN add-apt-repository -y ppa:mozillateam/ppa && \
    apt-get update && apt-get install -y --no-install-recommends \
    firefox-esr \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------
# Node.js 22 LTS
# ------------------------------------------------------------------
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm@latest && \
    rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------
# Chromium (via Playwright — bundles arm64 build)
# Google Chrome has no arm64 Linux build, so use Playwright's Chromium.
# Installed here so we can alias before Ratatoskr step.
# ------------------------------------------------------------------
RUN npm install -g playwright-core && \
    npx playwright install-deps chromium 2>&1 && \
    npx playwright install chromium 2>&1 && \
    CHROME_PATH=$(ls -d /root/.cache/ms-playwright/chromium-*/chrome-linux/chrome 2>/dev/null | head -1) && \
    ln -sf "$CHROME_PATH" /usr/bin/chromium-browser && \
    ln -sf "$CHROME_PATH" /usr/bin/google-chrome

# ------------------------------------------------------------------
# Python 3 + pip + common packages
# pip for packages not available as apt on arm64
# ------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    python3-pil \
    build-essential \
    && rm -rf /var/lib/apt/lists/* && \
    pip3 install --break-system-packages \
    pyautogui \
    requests \
    beautifulsoup4

# ------------------------------------------------------------------
# Dev tools
# ------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    jq \
    ripgrep \
    fzf \
    vim \
    nano \
    htop \
    unzip \
    zip \
    tar \
    gzip \
    bzip2 \
    cmake \
    pkg-config \
    sqlite3 \
    redis-tools \
    postgresql-client \
    mysql-client \
    openssh-client \
    netcat-openbsd \
    dnsutils \
    iproute2 \
    iputils-ping \
    tmux \
    screen \
    tree \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------
# GitHub CLI
# ------------------------------------------------------------------
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | \
    gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | \
    tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------
# Yggdrasil Ratatoskr — embedded runner daemon
# Installed globally so it starts inside every realm container.
# ------------------------------------------------------------------
RUN npm install -g @theaiinc/yggdrasil-ratatoskr@^0.2.0 && \
    npm cache clean --force

# ------------------------------------------------------------------
# Workspace directories
# ------------------------------------------------------------------
RUN mkdir -p /workspace /input /output /tmp/realm

# ------------------------------------------------------------------
# Oasis Chrome Bridge extension
# ------------------------------------------------------------------
COPY assets/extensions/oasis-chrome-bridge /opt/extensions/oasis-chrome-bridge

WORKDIR /workspace

# ------------------------------------------------------------------
# Start script and entrypoint
# ------------------------------------------------------------------
COPY assets/start-realm.sh /usr/bin/start-realm.sh
RUN chmod +x /usr/bin/start-realm.sh

CMD ["/usr/bin/start-realm.sh", "1920x1080"]
