FROM node:20-slim

# Install Python3 & yt-dlp dependencies for scraper
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir yt-dlp instaloader requests

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 7860

CMD ["node", "server.js"]
