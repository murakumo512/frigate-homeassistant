# 📹 CCTV AI Object Detection & Multi-Site Smart Home

Repository ini berisi konfigurasi lengkap, arsitektur, dan docker stack deployment untuk sistem pemantauan CCTV berbasis AI dan integrasi Smart Home di lingkungan **Docker Swarm**.

Sistem ini mengintegrasikan **Frigate NVR (v0.18-0)**, **Home Assistant**, **Eclipse Mosquitto (MQTT)**, dan notifikasi cerdas **Telegram Bot** dengan pembagian grup per lokasi (*Multi-Site Routing*).

---

## 🏛️ Arsitektur & Topologi Sistem

```
                 [ IP Cameras (RTSP) ]
                           │
       ┌───────────────────┴───────────────────┐
       ▼                                       ▼
[ Site Senayan ]                        [ Site Jogja ]
- Senayan Lorong Dapur                  - Jogja Halaman 1
- Senayan Lorong Gazebo                 - Jogja Tangga 1
- Senayan Tangga
       │                                       │
       └───────────────────┬───────────────────┘
                           ▼
            [ Frigate NVR (Docker Swarm) ]
            - 4x CPU Detectors (Tuned for KVM)
            - Motion & Stationary Filtering
            - Object Masks (Anti False-Positive)
            - NFS Mount Storage (/media/frigate)
                           │
                 [ MQTT Events Topic ]
                           ▼
             [ Home Assistant Automation ]
                           │
       ┌───────────────────┴───────────────────┐
       ▼                                       ▼
  [ Event Start ]                         [ Event End ]
  Kirim Snapshot Foto                     Tunggu 15 detik,
  dengan Bounding Box                     Kirim Video MP4 Clip
       │                                  (Auto-trim >150s)
       │                                       │
       └───────────────────┬───────────────────┘
                           ▼
          [ Multi-Site Telegram Routing ]
        ├── Grup Gabungan (Semua Deteksi)
        ├── Grup Khusus Jogja
        └── Grup Khusus Senayan
```

---

## 📂 Struktur Direktori

```text
cctv-smarthome-backup/
├── README.md                      # Dokumentasi lengkap sistem & panduan deploy
├── .gitignore                     # Aturan keamanan git (mencegah leak file credential)
├── docker/
│   ├── frigate-stack.yml          # Stack compose Frigate NVR (NFS mount, tmpfs, ingress)
│   ├── frigate-stack.yml.example  # Template stack Frigate dengan variabel generic
│   ├── smarthome-stack.yml        # Stack compose Home Assistant & Mosquitto MQTT
│   └── smarthome-stack.yml.example
├── frigate/
│   ├── config.yml                 # Konfigurasi aktif Frigate (4 detector, filter, mask)
│   └── config.yml.example         # Template konfigurasi Frigate untuk publik GitHub
├── homeassistant/
│   ├── configuration.yaml         # Konfigurasi dasar Home Assistant Core
│   ├── automations.yaml           # Otomasi deteksi CCTV & routing multi-site Telegram
│   ├── automations.yaml.example   # Template otomasi dengan generic Chat ID
│   ├── secrets.yaml               # File kredensial (token bot & password)
│   └── secrets.yaml.example       # Template secrets
└── mosquitto/
    └── mosquitto.conf             # Konfigurasi MQTT listener (port 1883)
```

---

## ⚙️ Fitur Utama & Optimasi Performa

### 1. 4x CPU Detectors (Tuned for QEMU / KVM)
Pada lingkungan virtualisasi tanpa instruksi AVX hardware (misalnya VPS/VM QEMU), 1 thread CPU detector dapat menyebabkan antrean inferensi menumpuk.
- Dikonfigurasi **4 detector CPU paralel** (`cpu1`, `cpu2`, `cpu3`, `cpu4`) dengan masing-masing `num_threads: 2`.
- Menjaga antrean deteksi tetap rendah (<100ms) pada 5 kamera secara bersamaan.

### 2. Pencegahan False Positive (Angin, Pintu, Daun, dan Benda Diam)
- **Tuning Motion**:
  - `threshold: 45` : Mengabaikan kedipan pencahayaan halus atau goyangan dedaunan kecil akibat angin.
  - `contour_area: 150` : Mengabaikan objek berukuran kecil (<150 px) agar tidak membebani detector CPU.
- **Tuning Person Filter**:
  - `min_score: 0.66` & `threshold: 0.75` : Memastikan hanya objek dengan kepastian tinggi yang dianggap manusia.
  - `min_area: 8000` - `15000` : Mencegah daun jatuh, bayangan, atau botol/sangkar burung terdeteksi sebagai manusia.
  - `min_initialized: 4` : Objek harus muncul minimal 4 frame berturut-turut sebelum dikonfirmasi (mencegah trigger akibat pintu kebuka/tutup kilat).
  - `stationary.max_frames.objects.person: 75` : Objek diam (seperti tas belanja merah, jaket, atau kursi) otomatis dibersihkan dari status "person" setelah 15 detik jika tidak bergerak.
- **Zone & Motion Masks**:
  - `tangga`: Mask rak sepatu bawah tangga dan kursi tas merah.
  - `jogja_halaman_1`: Mask rak botol dan sangkar burung.
  - `jogja_tangga1`: Motion mask pada area jendela tanaman.

### 3. Smart Telegram Clip Trimming
Telegram Bot API memiliki batas pengiriman file video maksimal **50 MB**. Jika seseorang berada lama di depan kamera (misalnya 8-15 menit), file video utuh akan gagal dikirim.
- Jika durasi deteksi **≤ 150 detik**, Home Assistant mengirim klip standar Frigate (`clip.mp4?padding=10`).
- Jika durasi deteksi **> 150 detik**, Home Assistant otomatis memotong **3 menit awal** langsung dari API Frigate (`/api/<camera>/start/<ts-10>/end/<ts+170>/clip.mp4`) dengan caption informatif bahwa video penuh tersimpan aman di NVR Frigate.
- Ditambahkan `delay: 15 seconds` sebelum pengiriman klip untuk memastikan NVR selesai menulis dan meng-encode segmen MP4.

### 4. Multi-Site Group Routing
Otomasi Home Assistant membaca nama kamera:
- Kamera berawalan `jogja_` dikirim ke **Grup Gabungan** + **Grup Khusus Jogja**.
- Kamera lainnya dikirim ke **Grup Gabungan** + **Grup Khusus Senayan**.

---

## 🚀 Panduan Deployment

### Prasyarat Docker Swarm
1. Pastikan node Docker Swarm memiliki label `shinobi=true`:
   ```bash
   docker node update --label-add shinobi=true <HOSTNAME_SWARM_NODE>
   ```
2. Buat overlay network untuk reverse proxy (jika belum ada):
   ```bash
   docker network create --driver overlay --attachable proxy-net
   ```
3. Pastikan direktori mount lokal sudah tersedia di host:
   - `/opt/frigate/config`
   - `/opt/homeassistant/config`
   - `/opt/mosquitto/config`
   - `/opt/mosquitto/data`
   - `/opt/mosquitto/log`
4. Pastikan storage NFS (`192.168.200.2:/home/frigate_cctv`) dapat dijangkau oleh Swarm node.

### Deploy Stack
Jalankan perintah berikut di manager node atau import melalui Portainer Stacks:
```bash
# 1. Deploy Mosquitto MQTT & Home Assistant
docker stack deploy -c docker/smarthome-stack.yml smarthome

# 2. Deploy Frigate NVR
docker stack deploy -c docker/frigate-stack.yml frigate
```

### Reload / Update Konfigurasi Frigate
Jika mengedit `/opt/frigate/config/config.yml`, terapkan perubahan ke container dengan:
```bash
docker service update --force frigate_frigate
```

---

## 🛡️ Panduan Push ke GitHub

Direktori ini sudah disiapkan agar siap di-push ke akun GitHub Anda.

### ⚠️ PENTING: Keamanan Kredensial
- File `homeassistant/secrets.yaml` sudah secara default diabaikan oleh `.gitignore`.
- **Jika repository Anda PRIVATE**: Anda dapat menyimpan file asli `frigate/config.yml` dan `automations.yaml` karena hanya Anda yang dapat mengaksesnya.
- **Jika repository Anda PUBLIC**: Gunakan template `.example` yang sudah disediakan, atau uncomment aturan tambahan di `.gitignore` agar password RTSP kamera dan ID chat Telegram tidak terlihat oleh publik.

### Langkah-langkah Push ke GitHub:

1. Buka terminal di folder ini:
   ```bash
   cd ~/Documents/cctv-smarthome-backup
   ```

2. Inisialisasi Git:
   ```bash
   git init
   ```

3. Tambahkan file ke staging:
   ```bash
   git add .
   ```

4. Buat initial commit:
   ```bash
   git commit -m "feat: initial backup of Frigate CCTV, Home Assistant, and Docker Swarm stacks"
   ```

5. Ganti branch utama menjadi `main`:
   ```bash
   git branch -M main
   ```

6. Hubungkan dengan repository GitHub Anda (buat repository baru terlebih dahulu di github.com):
   ```bash
   git remote add origin https://github.com/<USERNAME-ANDA>/<NAMA-REPO-ANDA>.git
   ```

7. Push ke GitHub:
   ```bash
   git push -u origin main
   ```

---

## 📝 Catatan Teknis Frigate 0.18
Pada Frigate versi 0.18 ke atas:
- Format `motion.mask` dan `objects.filters.<label>.mask` **wajib** menggunakan format kamus (*dictionary*) dengan key nama unik, bukan lagi format array/list garis datar (`- coordinates`).
  ```yaml
  # Contoh format yang benar di Frigate 0.18+:
  mask:
    nama_area_mask:
      friendly_name: Area Masking
      enabled: true
      coordinates: 0.1,0.2,0.3,0.4...
  ```
- Ukuran tmpfs di Docker Compose Swarm **wajib** menggunakan integer (byte), bukan string (`1073741824` untuk 1 GB).
