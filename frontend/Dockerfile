FROM node:20-alpine

WORKDIR /app

# Salin file package.json
COPY package*.json ./

# Install dependensi
RUN npm install

# Salin seluruh kode frontend
COPY . .

# Build aplikasi Next.js
# (Variabel NEXT_PUBLIC_API_URL akan disuntikkan oleh SumoPod saat proses build)
RUN npm run build

# Ekspos port default Next.js
EXPOSE 3000

# Jalankan server production Next.js
CMD ["npm", "run", "start"]
