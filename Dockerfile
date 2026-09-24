FROM node:18-slim AS node-build

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM python:3.9-slim

# Copiar Node.js i npm directament des de la imatge oficial de Node
COPY --from=node-build /usr/local /usr/local

WORKDIR /app

# Copiar dependències de node ja instal·lades
COPY --from=node-build /app/node_modules ./node_modules
COPY package*.json ./

# Copiar tot el codi font
COPY . /app

ENV PORT=8080
EXPOSE 8080

CMD ["python3", "server.py"]
