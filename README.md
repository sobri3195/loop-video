# React Video Auto Clipper

Aplikasi ini memotong video secara otomatis menjadi beberapa bagian berdurasi 30 detik menggunakan `ffmpeg.wasm` langsung di browser.

## Fitur Utama
- Upload video lokal (mp4/webm).
- Deteksi durasi otomatis.
- Auto-clipping setiap 30 detik.
- Preview dan download hasil potongan.
- Berjalan sepenuhnya di client-side (keamanan data terjamin).

## Cara Kerja Auto-Clipping
1. **FFmpeg.wasm**: Aplikasi menggunakan library `@ffmpeg/ffmpeg` untuk menjalankan perintah FFmpeg di dalam browser menggunakan WebAssembly.
2. **Durasi Video**: Saat video diunggah, metadata dibaca untuk mendapatkan total durasi.
3. **Looping Perintah**: Aplikasi menghitung jumlah potongan yang dibutuhkan (Total Durasi / 30).
4. **Fast Clipping**: Menggunakan flag `-c copy`, FFmpeg hanya menyalin stream video tanpa melakukan re-encoding. Hal ini membuat proses pemotongan sangat cepat karena tidak membebani CPU secara berlebihan.
5. **Output Blob**: Hasil setiap potongan disimpan di memori browser sebagai Blob URL yang kemudian bisa ditampilkan di elemen `<video>` dan diunduh.

## Cara Deploy ke Netlify
Aplikasi ini membutuhkan fitur browser `SharedArrayBuffer` yang memerlukan **Cross-Origin Isolation**. 

### Langkah-langkah:
1. Pastikan file `netlify.toml` sudah ada di root project dengan konfigurasi header berikut:
   ```toml
   [[headers]]
     for = "/*"
     [headers.values]
       Cross-Origin-Embedder-Policy = "require-corp"
       Cross-Origin-Opener-Policy = "same-origin"
   ```
2. Hubungkan repository ke Netlify.
3. Gunakan command build: `npm run build`.
4. Gunakan direktori publish: `dist`.

## Pengembangan Lokal
1. Install dependencies:
   ```bash
   npm install
   ```
2. Jalankan server development:
   ```bash
   npm run dev
   ```
