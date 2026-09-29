FROM node:22-alpine AS builder
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app /app
ENV NODE_ENV=production
EXPOSE 4000
CMD ["sh", "-c", "npm run db:migrate && npm run db:seed && npm run start"]
