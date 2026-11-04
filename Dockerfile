# Playwright image includes Chromium and its Linux dependencies.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    RANKING_BROWSER=chrome \
    RANKING_BROWSER_HEADLESS=true

COPY package*.json ./
RUN npm ci --omit=dev
RUN curl -fsSL -o /tmp/xdg-utils.deb \
      https://archive.ubuntu.com/ubuntu/pool/main/x/xdg-utils/xdg-utils_1.1.3-4.1ubuntu3_all.deb \
    && dpkg -i /tmp/xdg-utils.deb \
    && curl -fsSL -o /tmp/google-chrome.deb \
      https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && dpkg -i /tmp/google-chrome.deb \
    && rm /tmp/xdg-utils.deb /tmp/google-chrome.deb

COPY . .

EXPOSE 3000
CMD ["npm", "start"]