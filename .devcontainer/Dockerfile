FROM --platform=linux/arm64 mcr.microsoft.com/devcontainers/javascript-node:20-bookworm

ARG APP_FOLDER
ARG CLAUDE_CODE_VERSION
ARG OTELCOL_VERSION
ARG ARCH

COPY .devcontainer/requirements.txt /tmp/requirements.txt

RUN apt-get update \
    && apt-get install -y apt-transport-https ca-certificates gnupg curl wget python3-pip \
    #
    # Install OpenTelemetry Collector (base), pinned
    && wget -q "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/otelcol_${OTELCOL_VERSION}_linux_${ARCH}.deb" \
    && dpkg -i otelcol_${OTELCOL_VERSION}_linux_${ARCH}.deb \
    #
    # Install Python dependencies
    && pip3 install --break-system-packages -r /tmp/requirements.txt \
    #
    # Create config directory
    && mkdir -p /home/node/.claude \
    && chown -R node:node /home/node/.claude

USER node

# Add ~/.local/bin to PATH for Claude Code
ENV PATH="/home/node/.local/bin:${PATH}"

WORKDIR ${APP_FOLDER}

    # Install Claude Code
RUN curl -fsSL https://claude.ai/install.sh | bash -s ${CLAUDE_CODE_VERSION} \
    #
    # Install uv to be able to run MCP servers with uvx
    && curl -LsSf https://astral.sh/uv/install.sh | sh \
    #
    # update npm to be able to run MCP servers with npx
    # !!!--ignore-scripts due to Shai Hulud attack!!!
    && npm install --ignore-scripts -g npm@11.4.2
