# 📹 CCTV AI (Frigate 0.18) + Smart Home + Android Monitor App

Repository lengkap untuk sistem pemantauan CCTV berbasis AI (**Frigate NVR 0.18**), automasi notifikasi **Home Assistant + Mosquitto MQTT + Telegram Bot** (*Multi-Site Routing*), deployment **Docker Swarm / Standalone**, serta **Aplikasi Android Native (React Native / Expo)** bergaya EZVIZ.

---

## 📂 Struktur Folder

```text
cctv-smarthome-backup/
├── README.md                              # Dokumentasi lengkap (Deploy, Android, GitHub)
├── .gitignore                             # Proteksi kredensial & file build besar
├── docker/
│   ├── frigate-stack.yml                  # Stack Docker Swarm Frigate (NFS + tmpfs + ingress)
│   ├── frigate-stack.yml.example          # Template stack Frigate (tanpa IP internal)
│   ├── smarthome-stack.yml                # Stack Docker Swarm Home Assistant + Mosquitto
│   ├── smarthome-stack.yml.example        # Template stack Smart Home
│   └── docker-compose.standalone.yml      # Compose single-node (Docker biasa tanpa Swarm)
├── frigate/
│   ├── config.yml                         # Config aktif (4 CPU detector, mask, continuous 1 hari)
│   └── config.yml.example                 # Template config Frigate (password RTSP disanitasi)
├── homeassistant/
│   ├── configuration.yaml                 # Config dasar Home Assistant
│   ├── automations.yaml                   # Notif Telegram multi-site + auto-potong klip >150s
│   ├── automations.yaml.example           # Template automations (Chat ID disanitasi)
│   ├── secrets.yaml                       # File rahasia lokal (otomatis di-ignore git)
│   └── secrets.yaml.example               # Template secrets
├── mosquitto/
│   └── mosquitto.conf                     # Config MQTT broker (port 1883)
└── mobile-app/                            # Source code Aplikasi Android Frigate CCTV v2.3.1
    ├── App.tsx
    ├── app.json
    ├── package.json
    ├── assets/                            # Icon aplikasi
    ├── src/                               # API client & semua screen (Live, Timeline, Unduh, Sistem)
    └── native-android/                    # Modul native Kotlin (DownloadManager -> Download/Frigate)
```

---

## 🐳 1. Cara Deploy di Docker TANPA Portainer (via CLI / Terminal)

### Opsi A: Menggunakan Docker Swarm (Setup Server Produksi)

1. **Siapkan folder konfigurasi di host server** (`/opt/...`):
   ```bash
   sudo mkdir -p /opt/frigate/config /opt/homeassistant/config /opt/mosquitto/{config,data,log}

   # Salin file konfigurasi dari repo ini
   sudo cp frigate/config.yml /opt/frigate/config/config.yml
   sudo cp homeassistant/configuration.yaml /opt/homeassistant/config/
   sudo cp homeassistant/automations.yaml /opt/homeassistant/config/
   sudo cp homeassistant/secrets.yaml.example /opt/homeassistant/config/secrets.yaml
   sudo cp mosquitto/mosquitto.conf /opt/mosquitto/config/mosquitto.conf
   ```
   *(Edit `/opt/homeassistant/config/secrets.yaml` dan `/opt/frigate/config/config.yml` jika memakai template `.example`.)*

2. **Inisialisasi Swarm (jika belum aktif), beri label node, dan buat network:**
   ```bash
   # Jalankan sekali saja jika node belum menjadi Swarm manager
   docker swarm init

   # Beri label node tempat Frigate & Smart Home berjalan (cek hostname via: docker node ls)
   docker node update --label-add shinobi=true <HOSTNAME_NODE>

   # Buat overlay network eksternal untuk reverse proxy
   docker network create --driver overlay --attachable proxy-net
   ```

3. **Deploy Stack via CLI:**
   ```bash
   # Deploy Mosquitto & Home Assistant
   docker stack deploy -c docker/smarthome-stack.yml smarthome

   # Deploy Frigate NVR
   docker stack deploy -c docker/frigate-stack.yml frigate
   ```

4. **Cek status & log:**
   ```bash
   docker stack ls
   docker service ls
   docker service logs -f frigate_frigate
   ```

5. **Reload Frigate setelah mengedit `config.yml`:**
   ```bash
   docker service update --force frigate_frigate
   ```

---

### Opsi B: Menggunakan Docker Compose Biasa (Single Server / Tanpa Swarm)

Jika ingin deploy cepat di 1 server/PC/VPS biasa tanpa Docker Swarm dan tanpa NFS:
```bash
# Jalankan semua service (Mosquitto + Home Assistant + Frigate)
docker compose -f docker/docker-compose.standalone.yml up -d

# Cek status container
docker compose -f docker/docker-compose.standalone.yml ps

# Restart Frigate setelah edit frigate/config.yml
docker compose -f docker/docker-compose.standalone.yml restart frigate
```

---

## 🧭 2. Cara Deploy di Docker PAKAI Portainer

### Prasyarat (Sekali Saja)
Pastikan folder `/opt/frigate/config`, `/opt/homeassistant/config`, `/opt/mosquitto/config` beserta file konfigurasinya sudah disalin ke server, label node `shinobi=true` sudah dipasang, dan network `proxy-net` sudah ada (bisa dibuat lewat menu **Networks → Add network** di Portainer).

### Cara 1: Copy-Paste di Web Editor Portainer
1. Login ke Web UI Portainer → pilih environment Swarm kamu.
2. Buka menu **Stacks** → klik **+ Add stack**.
3. **Deploy Smart Home dulu:**
   - **Name:** `smarthome`
   - **Build method:** pilih **Web editor**
   - Copy seluruh isi file `docker/smarthome-stack.yml` lalu paste ke editor.
   - Klik **Deploy the stack**.
4. **Deploy Frigate:**
   - Klik **+ Add stack** lagi.
   - **Name:** `frigate`
   - Copy seluruh isi file `docker/frigate-stack.yml` lalu paste ke editor (sesuaikan IP NFS `addr=...` jika berbeda).
   - Klik **Deploy the stack**.

### Cara 2: Langsung Tarik dari Repository GitHub di Portainer (GitOps)
1. Buka **Stacks → + Add stack**.
2. **Name:** `frigate` (atau `smarthome`).
3. **Build method:** pilih **Repository**.
4. Masukkan **Repository URL** GitHub kamu (misal `https://github.com/<username>/cctv-smarthome-backup`).
   - Jika repo bersifat **Private**, aktifkan **Authentication** lalu masukkan username GitHub + **Personal Access Token (PAT)**.
5. **Compose path:** isi `docker/frigate-stack.yml` (atau `docker/smarthome-stack.yml`).
6. *(Opsional)* Aktifkan **GitOps updates** agar setiap kali kamu `git push`, Portainer otomatis menarik perubahan stack.
7. Klik **Deploy the stack**.

### Update / Restart Service di Portainer
Setelah mengubah `/opt/frigate/config/config.yml` di server:
- Masuk ke **Services → `frigate_frigate` → klik tombol "Update the service" (Force update)** agar container restart bersih tanpa membuat duplikat.

---

## 📱 3. Aplikasi Android (`mobile-app/` — v2.3.1)

Aplikasi native Android (React Native / Expo) untuk monitoring Frigate dengan fitur:
- **Login Native + Auto-Relogin & Biometrik** (`expo-secure-store` + Sidik Jari / Face Unlock).
- **Tab Live:** Filter grup kamera (`Semua`, `YK`, `Senayan`), grid 1/2 kolom anti kedap-kedip, live stream **MSE WebSocket** + **Pinch-to-Zoom (1x–5x)** & double-tap zoom ala EZVIZ.
- **Timeline 24 Jam per Kamera:** Penggaris 24 jam scrollable (zoom `1x/3x/6x`), strip lompat cepat `00:00–23:00`, **Potong & Download MP4** langsung dari timeline ke `Download/Frigate/`.
- **Tab Kejadian & Tab Unduh:** Putar klip MP4 (bisa di-zoom), download klip kejadian / rentang waktu custom, dan kelola Export server.
- **Tab Sistem:** Pantau 4x CPU Detector (`cpu1`–`cpu4`), kapasitas NFS, dan FPS per kamera.

### Build Ulang APK dari Source
```bash
cd mobile-app
npm install
CI=1 npx expo prebuild --platform android

# Pasang modul native DownloadManager & register di MainApplication.kt
cp native-android/FrigateDownloaderModule.kt android/app/src/main/java/id/labjaringanukdw/frigate/
cp native-android/MainApplication.kt android/app/src/main/java/id/labjaringanukdw/frigate/

# Build APK Release
cd android
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
./gradlew assembleRelease
# Hasil APK: android/app/build/outputs/apk/release/app-release.apk
```

---

## 🚀 4. Cara Push Backup Ini ke GitHub

### ⚠️ Cek Keamanan Sebelum Push
- **Kalau repo GitHub kamu `Private`:** Aman langsung push semua file (kecuali `secrets.yaml` yang otomatis di-ignore).
- **Kalau repo GitHub kamu `Public`:** Buka file `.gitignore`, lalu **hapus tanda `#`** di 3 baris paling bawah (`frigate/config.yml`, `homeassistant/automations.yaml`, `docker/frigate-stack.yml`) supaya password RTSP kamera & Chat ID Telegram tidak terlihat publik (yang ter-upload cukup file `.example`-nya saja).

### Langkah Push ke GitHub
1. Buat repository baru di [github.com/new](https://github.com/new) (misal nama: `cctv-smarthome-frigate`), **jangan** centang "Add a README file" biar tidak konflik.
2. Buka Terminal di Mac, lalu jalankan:
   ```bash
   cd ~/Documents/cctv-smarthome-backup

   # Cek file apa saja yang akan di-upload (pastikan tidak ada password bocor jika repo Public)
   git status

   # Tambahkan semua file
   git add .

   # Buat commit
   git commit -m "feat: backup lengkap Frigate 0.18, Home Assistant, Docker Swarm & Android App v2.3.1"

   # Pastikan branch utama bernama main
   git branch -M main

   # Hubungkan ke repo GitHub kamu (ganti USERNAME & NAMA-REPO)
   git remote add origin https://github.com/<USERNAME>/<NAMA-REPO>.git

   # Push ke GitHub
   git push -u origin main
   ```
   *(Jika nanti ada update lagi di kemudian hari, cukup ulangi `git add .` → `git commit -m "pesan update"` → `git push`.)*

### Upload File APK (`FrigateCCTV-v2.3.1.apk`) ke GitHub Releases
Karena file APK berukuran ~68 MB (terlalu besar untuk git biasa), upload lewat fitur **Releases**:
1. Buka halaman repo GitHub kamu → klik **Releases** (di sidebar kanan) → **Create a new release**.
2. Isi **Tag version:** `v2.3.1`, **Release title:** `Frigate CCTV Android v2.3.1`.
3. Drag & drop file `~/Documents/frigate-android-app/FrigateCCTV-v2.3.1.apk` ke kotak **Attach binaries**.
4. Klik **Publish release** → selesai! Siapa pun yang punya akses bisa langsung download APK dari link Release tersebut.
