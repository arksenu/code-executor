FROM node:20-alpine as builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY openapi ./openapi
COPY --from=builder /app/web ./web
CMD ["node", "dist/index.js"]
