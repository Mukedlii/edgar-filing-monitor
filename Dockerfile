FROM apify/actor-node:20

COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "NPM install succeeded"

COPY . ./
CMD npm start
