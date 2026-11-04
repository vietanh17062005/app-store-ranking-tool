# Match the browser image to the Playwright version in package-lock.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    RANKING_BROWSER=chromium \
    RANKING_BROWSER_HEADLESS=true

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "src/server.js"]