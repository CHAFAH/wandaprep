FROM node:18-alpine

WORKDIR /usr/src/app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /usr/src/app/logs

EXPOSE 8080

CMD ["node", "app.js"]
