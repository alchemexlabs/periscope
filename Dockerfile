FROM oven/bun:1.0 as base

WORKDIR /app

# Set environment variables to disable Bun welcome page
ENV BUN_DISABLE_WELCOME=true

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install --production

# Copy source files
COPY src ./src
COPY public ./public
COPY tsconfig.json ./
COPY start.js ./

# Copy private key (in production, this would be handled via secrets)
COPY private_key.pem ./

# Expose the port the server listens on
EXPOSE 8087

# Start the server using our custom entry point
CMD ["bun", "run", "start.js"]
