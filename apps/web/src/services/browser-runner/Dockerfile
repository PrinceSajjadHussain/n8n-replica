FROM mcr.microsoft.com/playwright:v1.46.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

ENV PORT=7900
EXPOSE 7900
CMD ["node", "server.js"]
