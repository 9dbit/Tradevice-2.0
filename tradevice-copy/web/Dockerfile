FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
CMD ["sh", "-c", "npm run start -- -p ${PORT:-3000}"]
