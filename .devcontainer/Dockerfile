FROM mcr.microsoft.com/devcontainers/javascript-node:20-bookworm

ARG APP_FOLDER
ARG CLAUDE_CODE_VERSION

RUN apt-get update \
    && apt-get install -y apt-transport-https ca-certificates gnupg curl wget python3-pip \
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
    && npm install --ignore-scripts -g npm@11.10.1
