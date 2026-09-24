FROM python:3.9-slim

# Instal·lar Node.js per al microservei autònom de WhatsApp Web
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_18.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instal·lar mòduls de Node primer (aprofita memòria cau de capes Docker)
COPY package*.json ./
RUN npm install --omit=dev

COPY . /app

ENV PORT=8080
EXPOSE 8080

CMD ["python3", "server.py"]
