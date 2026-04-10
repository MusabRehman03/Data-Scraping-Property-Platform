FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Install runtime dependencies only
COPY package*.json ./
RUN npm ci

# Copy prebuilt output and runtime config assets
COPY dist ./dist
COPY src/config ./src/config

# Ensure runtime output folders exist
RUN mkdir -p /app/logs /app/downloads

ENV NODE_ENV=production

# Main orchestrator entry
CMD ["npm", "start"]
