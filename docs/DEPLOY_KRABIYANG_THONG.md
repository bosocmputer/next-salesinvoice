# บันทึกการ Deploy — krabiyang-thong (ลูกค้า)

> สถานะ ณ deploy จริง. อัปเดตล่าสุด: **2026-06-22 Asia/Bangkok**
> ไฟล์นี้คือสภาพจริงของไซต์นี้ ไม่ใช่คู่มือทั่วไป (คู่มือ generic ดู [`INSTALL_UBUNTU.md`](INSTALL_UBUNTU.md))

## สถานะปัจจุบัน

| รายการ | ค่า |
|--------|-----|
| สถานะ | **LIVE** |
| เข้าใช้งาน (public) | `http://kbyt.iszai.com:6217/login` |
| เข้าใช้งาน (Zerotier) | `http://10.121.19.150:6217` (network id `60970003ceafb8fe`) |
| Frontend host port | `6217` → container :80 |
| Backend | ไม่ expose host port (คุยภายใน docker network) |
| Database | SML PostgreSQL `data2` ผ่าน container `sml_postgresql:5432` ภายใน network |
| Docker network | `sml_service_network` (external — ของลูกค้า) |
| โฟลเดอร์บนเครื่อง | `/mnt/data/krabiyang-thong/smlservice/next-salesinvoice/` |
| Compose ที่ใช้รัน | `docker-compose.customer.yml` (image-only, ไม่ build บน prod) |
| Cookie Secure | `COOKIE_SECURE=false` (เข้าผ่าน http) |
| Branch | `deploy/krabiyang-thong` |

## เครื่อง server ลูกค้า

- Ubuntu 24.04 amd64, 4 CPU / 15GB RAM, disk เหลือ ~12GB (ใช้ ~88%) — **ระวัง disk**
- Docker 28 + Compose v5 ลงไว้แล้ว; container ทั้งหมดรันใต้ **root** (`sudo docker`)
- มี SML stack เดิมรันอยู่ 13 containers (sml_postgresql, smlcloudservice, traefik_proxy, pgadmin4, kbyt* ...) — **ห้ามแตะ**
- Reverse proxy เดิม = Traefik v2.5 (port 8092); service แอปลูกค้าอื่น ๆ expose host port ตรง ๆ ในช่วง 6211-6218

## สถาปัตยกรรมที่เลือก (ทำไม)

- **ใช้ image build จากที่อื่น → load บนลูกค้า** ไม่ build บน prod เพราะ disk เหลือน้อย ถ้า build แล้ว disk เต็มจะชน Postgres ของ SML
- **join `sml_service_network` + ต่อ `sml_postgresql:5432` ภายใน** ตาม pattern service อื่นของลูกค้า ไม่ต่อผ่าน host port 6743
- **ไม่ลง nginx/certbot, ไม่แตะ Traefik** — ลูกค้ามี reverse proxy อยู่แล้ว
- **`COOKIE_SECURE=false`** เพราะเข้าผ่าน http (Zerotier/public ยังไม่มี TLS) ถ้าเป็น production HTTPS ปกติ Secure cookie จะทำให้ login ไม่ติด

## ขั้นตอน update เวอร์ชันใหม่ (build ที่อื่น → load)

เครื่อง dev (Mac) ไม่มี docker daemon และเป็น arm64 — **ห้าม build ที่ Mac** ใช้ dev server `192.168.2.109` (amd64) เป็นเครื่อง build

```bash
# 1) เครื่อง dev: แก้ code/compose, go test ./..., commit branch deploy/krabiyang-thong

# 2) build บน 192.168.2.109 (amd64)
rsync -az --exclude='.git' --exclude='node_modules' --exclude='frontend/dist' \
  --exclude='backend/.gocache' --exclude='backend/.gopath' --exclude='.env' \
  ./ bosscatdog@192.168.2.109:/home/bosscatdog/next-salesinvoice/
ssh bosscatdog@192.168.2.109 'cd ~/next-salesinvoice && docker compose -f docker-compose.yml build && \
  docker save next-salesinvoice-backend:latest next-salesinvoice-frontend:latest | gzip > /tmp/nsi-images.tar.gz'

# 3) ส่งผ่าน Mac เป็นตัวกลาง -> ลูกค้า
scp bosscatdog@192.168.2.109:/tmp/nsi-images.tar.gz /tmp/
scp /tmp/nsi-images.tar.gz ubuntu@10.121.19.150:/tmp/
scp docker-compose.customer.yml ubuntu@10.121.19.150:/mnt/data/krabiyang-thong/smlservice/next-salesinvoice/

# 4) บนลูกค้า: PRE-FLIGHT disk check (>=3GB) แล้วค่อย load
ssh ubuntu@10.121.19.150
  AVAIL=$(df --output=avail -BG / | tail -1 | tr -dc 0-9); [ "$AVAIL" -ge 3 ] || { echo "disk<3GB abort"; exit 1; }
  sudo docker load < /tmp/nsi-images.tar.gz && rm -f /tmp/nsi-images.tar.gz
  cd /mnt/data/krabiyang-thong/smlservice/next-salesinvoice
  sudo docker compose -f docker-compose.customer.yml up -d   # ไม่มี --build
  sudo docker ps   # ยืนยัน 13 เดิม Up ครบ + nsi-backend/nsi-frontend
```

## Verification

```bash
# backend health (ภายใน network)
sudo docker exec nsi-frontend wget -qO- http://backend:8080/api/v1/health
# db status -> connected:true, database:data2, appSchemaReady:true
sudo docker exec nsi-frontend wget -qO- http://backend:8080/api/v1/system/database-status
# frontend
curl -sI http://kbyt.iszai.com:6217/login | head -1   # 200
# login จริง: code SML จริง (เช่น 001) + password จริง
```

## App schema (ตาราง nsi_*) + performance index

- ตาราง app 8 ตัว (`nsi_app_users`, `nsi_audit_logs`, `nsi_reflow_*`, `nsi_document_*`, `nsi_app_settings`, `nsi_schema_migrations`) สร้างแล้วใน `data2` ผ่าน bootstrap
- performance index บนตาราง SML (`ic_trans`, `ic_trans_detail`, `ar_customer`) = **7/7 valid**
  - ใช้ `CREATE INDEX CONCURRENTLY` (ไม่ล็อก SML); สร้างจริงรวม ~40 วิ
  - หมายเหตุ: ตอน bootstrap แรก index บางตัวอาจค้างเป็น **invalid** เพราะ lock timeout 2s ของแอป —
    ถ้าเจอ ให้ `drop index concurrently if exists <name>` แล้วสร้างใหม่ตรงบน psql (ไม่ติด lock_timeout ของแอป)

## Rollback (ไม่กระทบ SML เดิม)

```bash
cd /mnt/data/krabiyang-thong/smlservice/next-salesinvoice
sudo docker compose -f docker-compose.customer.yml down          # ลบเฉพาะ nsi-* (ไม่ใส่ -v)
sudo docker rmi next-salesinvoice-backend:latest next-salesinvoice-frontend:latest   # คืน disk
# index app (ถ้าต้องการลบ): drop index concurrently if exists nsi_<...>;  (ปลอดภัย SML ไม่พึ่งพา)
```

## ส่งต่อ / เปิดค้าง (นอกขอบเขต deploy)

- **HTTPS/TLS เป็นของทีม IT ลูกค้า** — ตอนนี้ public (`kbyt.iszai.com:6217`) เป็น **http ไม่มี TLS**
  → password/cookie ส่งแบบ plain ผ่านเน็ต ควรทำ HTTPS ก่อนใช้งานเต็มรูปแบบ
  → เมื่อมี HTTPS แล้ว: ตั้ง `COOKIE_SECURE=true` ใน compose แล้ว `up -d` ใหม่ (มี Traefik อยู่แล้ว ไม่ต้องแก้แอป)
- ยืนยันกับลูกค้าว่า host port `6217` จองให้ระบบนี้ถาวร (อยู่ในช่วง 6211-6218 ที่เปิดไว้)

## ห้ามทำเด็ดขาดบนเครื่องลูกค้า

`docker system prune` · `docker image prune -a` · `down -v` · แตะ compose/volume/network ของ service อื่น · build บน prod (กิน disk เสี่ยงชน Postgres)
