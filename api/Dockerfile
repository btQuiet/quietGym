FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js security.js password.js ./
COPY scripts/ ./scripts/
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
