# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install all dependencies (including devDependencies)
RUN npm ci

# Copy source files
COPY . .

# Build Vite client and Express server
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built files and migrations from builder
COPY --from=builder /app/dist ./dist

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=5000

# Expose port
EXPOSE 5000

# Liveness/readiness: /api/ready returns 200 only when PostgreSQL answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Start server
CMD ["node", "dist/index.cjs"]
