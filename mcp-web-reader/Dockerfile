# --- Stage 1: Build Frontend (Angular SPA) ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY mcp-web-reader/frontend/package*.json ./
RUN npm ci

COPY mcp-web-reader/frontend/ ./
RUN npm run build

# --- Stage 2: Build Backend & Final Runner ---
FROM node:20-bookworm-slim
WORKDIR /app

# Install system dependencies for Playwright headless Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/mcp-web-reader

# Install backend dependencies
COPY mcp-web-reader/package*.json ./
RUN npm ci

# Copy backend source
COPY mcp-web-reader/ ./

# Copy built frontend assets from stage 1
COPY --from=frontend-builder /app/public ./public

# Build the TypeScript backend
RUN npm run build

# Install Playwright browser
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install chromium

EXPOSE 3000

CMD ["npm", "run", "serve:api"]
