# Gunakan image Node.js versi 22 (dibutuhkan oleh Supabase untuk fitur WebSocket native)
FROM node:22-alpine

# Set direktori kerja di dalam container
WORKDIR /app

# Salin file package.json dan package-lock.json (jika ada)
COPY package*.json ./

# Install semua dependensi
RUN npm install

# Salin seluruh kode backend
COPY . .

# Ekspos port yang digunakan aplikasi
EXPOSE 3002

# Jalankan backend menggunakan tsx (sama seperti lokal)
CMD ["npx", "tsx", "src/index.ts"]
