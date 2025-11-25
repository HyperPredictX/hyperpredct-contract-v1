FROM ubuntu:25.10

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_MAJOR=24 \
    NODE_OPTIONS=--openssl-legacy-provider

RUN apt-get update -y && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git bash build-essential \
      make g++ && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update -y && apt-get install -y nodejs && \
    corepack enable && corepack prepare yarn@1.22.22 --activate && \
    node --version && yarn --version && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile || yarn install

COPY . .

RUN npm install -g npm@latest
RUN yarn run compile

ENV PATH=/app/node_modules/.bin:$PATH

CMD bash