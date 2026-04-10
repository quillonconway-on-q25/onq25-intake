FROM node:18-alpine

WORKDIR /app

COPY Foundation-Consulting/package*.json ./
RUN npm install

COPY Foundation-Consulting .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]