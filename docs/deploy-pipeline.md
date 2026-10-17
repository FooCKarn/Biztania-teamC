# ตั้งค่าใช้งาน Engagement จริง: ล็อกอิน · อัปโหลด · ประมวลผลบน server

ทำครั้งเดียว ใช้บริการฟรีทั้งหมด (Cloudflare Workers + D1, Render free web service)
ฐานข้อมูล D1 `auditpal-files` (APAC) สร้างไว้แล้วและใส่ id ใน `wrangler.jsonc` แล้ว

## 1) ตั้ง secret ของ Worker (รันที่ root ของ repo)

```bash
npx wrangler secret put FILES_KEY        # กุญแจเข้ารหัสไฟล์ ใช้ค่าจาก: openssl rand -base64 32
npx wrangler secret put PIPELINE_SECRET  # รหัสลับระหว่าง Worker กับเครื่องประมวลผล: openssl rand -hex 32
npx wrangler secret put SETUP_TOKEN      # รหัสใช้ครั้งเดียวสำหรับสร้างบัญชีผู้ดูแลคนแรก
```

- **เก็บ `FILES_KEY` ไว้ในที่ปลอดภัย (เช่น password manager)** ถ้าหายหรือเปลี่ยน ไฟล์ที่อัปโหลดไว้ทั้งหมดจะถอดรหัสไม่ได้
- ห้าม commit ค่าใดๆ ข้างบนลง repo

## 2) สร้างเครื่องประมวลผลบน Render (ฟรี, Singapore)

1. เข้า https://dashboard.render.com → **New → Blueprint** → เลือก repo `Biztania-teamC` (Render อ่าน `render.yaml` ที่ root)
2. ใส่ค่า 2 ตัวที่ Render ถาม:
   - `PIPELINE_SECRET` = ค่าเดียวกับข้อ 1
   - `WORKER_URL` = URL ของ Worker เช่น `https://auditpal.foo30749.workers.dev` (ไม่มี `/` ท้าย)
3. รอ build เสร็จ แล้วจด URL ของ service เช่น `https://auditpal-pipeline.onrender.com` เปิด `/healthz` ต้องได้ `ok`

## 3) บอก Worker ว่าเครื่องประมวลผลอยู่ไหน

แก้ `PIPELINE_URL` ใน `wrangler.jsonc` เป็น URL จากข้อ 2 แล้ว deploy (`npx wrangler deploy` หรือ push ให้ Workers Builds deploy)

## 4) เริ่มใช้งาน

1. เปิดเว็บ จะเห็นหน้า **ตั้งค่าบัญชีผู้ดูแลระบบคนแรก** ใส่ `SETUP_TOKEN` + ชื่อ ชื่อย่อ อีเมล รหัสผ่าน
2. เมนู **ผู้ใช้** → เพิ่มคนในทีม ระบบแสดงรหัสผ่านชั่วคราวครั้งเดียว ส่งให้เจ้าตัวโดยตรง (เข้าครั้งแรกต้องเปลี่ยน)
3. **สร้าง Engagement** → เพิ่มทีมพร้อมบทบาท → อัปโหลดเอกสาร → **ประมวลผลเอกสารทั้งหมด** → **เปิดผลการตรวจ**
4. ทดลองด้วยชุดตัวอย่าง: อัปโหลดทุกไฟล์ใน `pipeline/samples/tg_company/` และ `invoices/` (ยกเว้น `expected.json`) จะได้ 12 จุดควรตรวจ + รอจับคู่ 1

## ค่าที่ปรับได้ (`wrangler.jsonc` → `vars`)

| ค่า | ค่าเริ่มต้น | ความหมาย |
| --- | --- | --- |
| `PIPELINE_URL` | `https://auditpal-pipeline.onrender.com` (ตรวจให้ตรงกับ URL จริงบน Render) | URL ของเครื่องประมวลผล ว่าง = อัปโหลดได้แต่ประมวลผลไม่ได้ |
| `RETENTION_DAYS` | 90 | ลบไฟล์ดิบและภาพหน้าเอกสารกี่วันหลังปิดงาน |
| `ALLOW_REAL_DATA` | false | false = ทุก Engagement เป็นข้อมูลสมมติ เปิดเป็น true ได้หลังเปลี่ยนผู้ให้บริการ AI และ region ตามสัญญาข้อมูลเท่านั้น |
| `PASSWORD_ITERATIONS` | 100000 | รอบ PBKDF2 ลดได้ (ขั้นต่ำ 10000) ถ้า Workers Free ตัดคำขอล็อกอินเพราะ CPU เกิน 10 ms |

## ข้อควรรู้ของแผนฟรี

- Render free: หลับเมื่อไม่มีงาน 15 นาที กดประมวลผลครั้งแรกรอเครื่องตื่นราว 1 นาที (หน้าเว็บรอให้เอง), RAM 512 MB ประมวลผลทีละงาน
- Render และ D1 อยู่สิงคโปร์/APAC ยังไม่ใช่ region ในไทยตามที่ตัดสินไว้ ต้องย้ายก่อน pilot กับข้อมูลจริง
- Workers Free จำกัด CPU 10 ms ต่อคำขอ การ hash รหัสผ่านและเข้ารหัสไฟล์ใหญ่อาจเกิน ถ้าเจอ error ให้ใช้ Workers Paid ($5/เดือน, แนะนำสำหรับ pilot) หรือลด `PASSWORD_ITERATIONS`
- D1 free: 500 MB ต่อฐานข้อมูล พอสำหรับทดลองหลาย Engagement ถ้าไฟล์จริงเยอะให้ย้ายที่เก็บไฟล์ไป R2 (ต้องเปิด R2 ใน dashboard ก่อน)

## รันทั้งระบบในเครื่อง

```bash
# root ของ repo: ใส่ secret สำหรับเครื่องตัวเองใน .dev.vars (ไฟล์นี้ถูก .gitignore)
printf 'FILES_KEY=%s\nPIPELINE_SECRET=dev-secret-change-me\nSETUP_TOKEN=dev-setup\n' "$(openssl rand -base64 32)" > .dev.vars
worker/node_modules/.bin/wrangler dev --port 8787 --var PIPELINE_URL:http://localhost:8099

# อีกหน้าต่าง
cd pipeline && PIPELINE_SECRET=dev-secret-change-me WORKER_URL=http://localhost:8787 PORT=8099 python -m auditconcierge.server
```

เปิด http://localhost:8787 แล้วใช้ `dev-setup` เป็นรหัสตั้งค่า
