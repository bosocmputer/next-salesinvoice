# คู่มือติดตั้ง next-salesinvoice บน Ubuntu Server

เอกสารนี้ใช้สำหรับการนำ stack ทั้งระบบไปติดตั้งที่ **เครื่อง server ของลูกค้า** ที่ใช้ Ubuntu
รองรับ Ubuntu **22.04 LTS** และ **24.04 LTS** (x86_64)

> **หมายเหตุ:** เอกสารนี้เป็นคู่มือ *generic* (สมมติเครื่องเปล่า + ใช้ nginx/certbot host).
> ไซต์ที่มี SML stack + Traefik อยู่แล้วจะ **ไม่** ใช้ nginx/certbot host และจะ build image ที่อื่นแล้ว load
> (กัน disk เต็มชน Postgres) — ดูตัวอย่างจริงที่ deploy แล้ว: [`DEPLOY_KRABIYANG_THONG.md`](DEPLOY_KRABIYANG_THONG.md)

---

## 0. ภาพรวม Stack

| ส่วน | เทคโนโลยี | Port (host) | Container |
|------|----------|-------------|-----------|
| Frontend | React + Vite + Nginx | `3040` | `next-salesinvoice-frontend` |
| Backend | Go 1.24 + Gin | `8085` | `next-salesinvoice-backend` |
| Database | PostgreSQL (SML — มีอยู่แล้วฝั่งลูกค้า) | `5432` | ภายนอก |
| Reverse proxy (แนะนำ) | Nginx + Let's Encrypt | `80/443` | host |

> Backend จะเชื่อมเข้า SML PostgreSQL แบบ read/write — **ห้าม** เปิด port `8085` / `3040` ออกอินเทอร์เน็ตตรง ๆ ต้องผ่าน reverse proxy + TLS เสมอ

---

## 1. ข้อกำหนดเครื่องปลายทาง

- Ubuntu 22.04 / 24.04 LTS
- CPU ≥ 2 core, RAM ≥ 2 GB, Disk ≥ 10 GB (เผื่อ docker images + logs)
- User ที่มีสิทธิ์ `sudo`
- เชื่อมเครือข่ายไปยัง SML PostgreSQL ได้ (TCP 5432)
- เชื่อมอินเทอร์เน็ตได้สำหรับดึง docker image และ apt packages
- โดเมนชี้มาที่ public IP ของเครื่อง (ถ้าจะออกอินเทอร์เน็ต) เช่น `nsi.example.com`

ทดสอบเชื่อม DB ก่อน:
```bash
nc -vz <SML_DB_HOST> 5432
```

---

## 2. ติดตั้ง Docker Engine + Compose plugin

ใช้ official repo ของ Docker (ไม่ใช้ `docker.io` จาก ubuntu repo)

```bash
# 2.1 อัพเดต system + dependencies พื้นฐาน
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg lsb-release ufw

# 2.2 ตั้ง Docker apt repo
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 2.3 ติดตั้ง engine + compose plugin
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 2.4 ให้ user ปัจจุบันใช้ docker โดยไม่ต้อง sudo
sudo usermod -aG docker "$USER"
newgrp docker   # หรือ logout/login ใหม่

# 2.5 ทดสอบ
docker --version
docker compose version
docker run --rm hello-world
```

---

## 3. ดึง source code ลงเครื่อง

มี 2 วิธี — เลือกตามนโยบายของลูกค้า

### 3.1 ผ่าน Git (แนะนำ ถ้าเครื่องลูกค้ามี internet)

```bash
sudo mkdir -p /opt/next-salesinvoice
sudo chown "$USER":"$USER" /opt/next-salesinvoice
cd /opt
git clone https://github.com/bosocmputer/next-salesinvoice.git next-salesinvoice
cd next-salesinvoice
```

### 3.2 ผ่าน rsync / tarball (กรณี airgap)

จากเครื่อง dev:
```bash
tar --exclude=node_modules --exclude=.git --exclude=frontend/dist \
    --exclude=backend/.gocache --exclude=backend/.gopath \
    -czf nsi.tgz -C /Users/nontawatwongnuk/dev_bos next-salesinvoice
scp nsi.tgz <user>@<server>:/tmp/
```
ที่เครื่อง server:
```bash
sudo mkdir -p /opt/next-salesinvoice
sudo chown "$USER":"$USER" /opt/next-salesinvoice
tar -xzf /tmp/nsi.tgz -C /opt --strip-components=0
cd /opt/next-salesinvoice
```

---

## 4. ตั้งค่า environment

```bash
cd /opt/next-salesinvoice
cp .env.example .env
chmod 600 .env        # กันคนอื่นอ่าน secret
nano .env
```

### 4.1 ค่าที่ต้องกรอกทุก deployment

| ตัวแปร | คำอธิบาย | ตัวอย่าง |
|--------|----------|----------|
| `SESSION_SECRET` | secret สำหรับ session cookie — **ต้อง ≥ 32 ตัวอักษร** และต่างกันทุกที่ติดตั้ง | สร้างด้วย `openssl rand -base64 48` |
| `SML_DB_HOST` | hostname/IP ของ SML PostgreSQL | `192.168.1.10` |
| `SML_DB_PORT` | port (default `5432`) | `5432` |
| `SML_DB_NAME` | ชื่อ database ที่จะใช้ | `sml1_2026` |
| `SML_DB_USER` | user ของ DB | `postgres` |
| `SML_DB_PASSWORD` | password ของ DB | — |
| `SML_DB_SSLMODE` | `disable` / `require` / `verify-full` | ภายใน LAN ใช้ `disable` ได้ |
| `SML_DB_SCHEMA` | schema (default `public`) | `public` |
| `SML_DB_MAX_CONNS` | จำนวน connection สูงสุดใน pool | `3` (เหมาะกับ workload นี้) |
| `NSI_DATABASE_SETUP_SECRET` | secret สำหรับ endpoint bootstrap schema — ว่างไว้ถ้าไม่ใช้ | — |

สร้าง `SESSION_SECRET` ใหม่:
```bash
openssl rand -base64 48
```
นำผลที่ได้ใส่ในไฟล์ `.env`

---

## 5. Build & Start

```bash
cd /opt/next-salesinvoice
docker compose pull              # ดึง image base layer
docker compose up -d --build     # build + start backend + frontend
docker compose ps                # ดูว่ารันครบไหม
```

ต้องเห็นทั้ง `next-salesinvoice-backend` และ `next-salesinvoice-frontend` อยู่ในสถานะ `Up`

---

## 6. ตรวจสอบหลังติดตั้ง

```bash
# Backend health
curl -s http://127.0.0.1:8085/api/v1/health
# คาด: {"success":true,"message":"ok","data":{"status":"healthy"}}

# Database connectivity
curl -s http://127.0.0.1:8085/api/v1/system/database-status | head -c 200

# Frontend
curl -sI http://127.0.0.1:3040 | head -1
# คาด: HTTP/1.1 200 OK
```

ถ้า health ผ่านแต่ database-status ฟ้อง not-ready — ตรวจค่าใน `.env` แล้ว restart:
```bash
docker compose restart backend
docker compose logs -f backend
```

---

## 7. Reverse proxy + HTTPS (จำเป็นสำหรับ production)

Backend ออก cookie แบบ `Secure` ใน production mode → **ต้องเข้าผ่าน HTTPS** เท่านั้น มิฉะนั้น login ไม่ติด

### 7.1 ติดตั้ง nginx + certbot

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

### 7.2 สร้าง site config

```bash
sudo nano /etc/nginx/sites-available/next-salesinvoice
```

วาง config ต่อไปนี้ (เปลี่ยน `nsi.example.com` เป็นโดเมนจริง):

```nginx
server {
    listen 80;
    server_name nsi.example.com;

    # ส่งทุกอย่างไปที่ frontend container
    location / {
        proxy_pass         http://127.0.0.1:3040;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        client_max_body_size 10m;
    }

    # API ส่งตรงไป backend (frontend nginx ก็ proxy เองได้ แต่ตรงนี้จะลด hop)
    location /api/ {
        proxy_pass         http://127.0.0.1:8085;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

เปิดใช้งาน + ทดสอบ:
```bash
sudo ln -sf /etc/nginx/sites-available/next-salesinvoice /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 7.3 ขอใบรับรอง Let's Encrypt

โดเมนต้องชี้มาที่ public IP ของเครื่องก่อน

```bash
sudo certbot --nginx -d nsi.example.com --redirect --agree-tos -m ops@example.com
```

certbot จะแก้ config ให้ใช้ HTTPS อัตโนมัติ + ตั้ง auto-renew ผ่าน systemd timer

ทดสอบ renew:
```bash
sudo certbot renew --dry-run
```

---

## 8. Firewall (ufw)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp           # SSH
sudo ufw allow 80/tcp           # HTTP (สำหรับ certbot challenge)
sudo ufw allow 443/tcp          # HTTPS
sudo ufw enable
sudo ufw status
```

> **ห้าม** allow `3040` หรือ `8085` ออก public — ให้เข้าผ่าน nginx อย่างเดียว

---

## 9. ตั้งให้รันอัตโนมัติเมื่อบูตเครื่อง

Docker จะ start service ตามตอนบูตอยู่แล้ว และ compose ใช้ `restart: unless-stopped` → container จะกลับมาเอง

ตรวจว่า docker service เปิด on-boot:
```bash
sudo systemctl enable docker
sudo systemctl status docker --no-pager
```

ทดสอบรีบูต:
```bash
sudo reboot
# หลังกลับมา
docker compose -f /opt/next-salesinvoice/docker-compose.yml ps
```

---

## 10. การ Update เวอร์ชันใหม่

```bash
cd /opt/next-salesinvoice
git fetch && git pull --ff-only          # หรือใช้ rsync/tarball ใหม่
docker compose up -d --build             # build + restart เฉพาะที่เปลี่ยน
docker image prune -f                    # เก็บกวาด image เก่า
docker compose logs -f --tail=50         # ดู log ช่วงเปลี่ยน
```

> **ก่อน update production**: ลอง stage ที่ branch / docker tag ใหม่ก่อน, backup `.env` และ DB

---

## 11. Backup

- **โค้ด + env**: คอมมิตใน git + `.env` ให้สำเนาแยกที่เก็บ secret ของลูกค้า (vault/password manager)
- **Database (SML)**: ลูกค้าควรมีระบบ backup อยู่แล้ว — แอปนี้ไม่ได้ถือ data หลัก

ตัวอย่าง backup `.env`:
```bash
sudo cp /opt/next-salesinvoice/.env /root/nsi-env-backup-$(date +%F).env
sudo chmod 600 /root/nsi-env-backup-*.env
```

---

## 12. Troubleshooting

| อาการ | ตรวจ | แก้ |
|------|------|-----|
| `docker compose up` ค้างตอน build | network ออก internet ได้ไหม | ตั้ง proxy ใน `/etc/docker/daemon.json` หรือใช้ tarball image |
| Backend ขึ้น `unhealthy` | `docker compose logs backend` | ส่วนใหญ่เพราะ `.env` DB ผิด — กลับไป step 4 |
| Login แล้ว redirect กลับ login หน้าเดิม | cookie `Secure` แต่เข้าผ่าน HTTP | ต้องใช้ HTTPS (step 7) |
| Frontend ขึ้น 502 จาก nginx | container ตายหรือ port ผิด | `docker compose ps` ดู status |
| `prefers-color-scheme` ไม่ตามระบบ | browser cache | hard reload (Ctrl+Shift+R) |
| Database-status เป็น false ตลอด | firewall ที่ DB host บล็อก | เปิด `5432` จาก IP เครื่อง app |

ดู log สด ๆ:
```bash
cd /opt/next-salesinvoice
docker compose logs -f backend
docker compose logs -f frontend
```

---

## 13. ถอนการติดตั้ง

```bash
cd /opt/next-salesinvoice
docker compose down -v          # ลบ container + volume
sudo rm -rf /opt/next-salesinvoice
sudo rm /etc/nginx/sites-enabled/next-salesinvoice
sudo rm /etc/nginx/sites-available/next-salesinvoice
sudo nginx -t && sudo systemctl reload nginx
sudo certbot delete --cert-name nsi.example.com  # ถ้าต้องการลบ cert
docker image prune -af
```

---

## 14. Checklist สั้นสำหรับวันส่งมอบ

- [ ] Ubuntu LTS, user มี sudo, เครื่องมี internet
- [ ] Docker engine + compose plugin ลงสำเร็จ (`docker compose version`)
- [ ] Source code อยู่ที่ `/opt/next-salesinvoice`
- [ ] `.env` กรอกครบ + `SESSION_SECRET` สุ่มใหม่ + permission `600`
- [ ] `docker compose ps` แสดง 2 container เป็น `Up`
- [ ] `curl /api/v1/health` ตอบ `healthy`
- [ ] `curl /api/v1/system/database-status` คืน `connected: true`
- [ ] โดเมนชี้มาเครื่อง + nginx + certbot ออก cert สำเร็จ
- [ ] `ufw` allow เฉพาะ 22/80/443
- [ ] ทดสอบ login ผ่าน HTTPS จริงได้
- [ ] รีบูตเครื่องแล้ว stack กลับมาเอง

---

## 15. ติดต่อ / ส่งต่อข้อมูล

ส่งให้ผู้ดูแลฝั่งลูกค้า:
- URL: `https://nsi.example.com`
- บัญชี admin ตัวแรก (ถ้ามี seed) + วิธีรีเซ็ตรหัสผ่าน
- เบอร์/อีเมล team support
- เอกสารนี้ ([`docs/INSTALL_UBUNTU.md`](INSTALL_UBUNTU.md))
