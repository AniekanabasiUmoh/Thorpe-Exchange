# Thorpe Exchange (Illusion Services)

A Telegram & WhatsApp bot for offramping USDT to NGN instantly via Breet API.

## Features
- **Multi-channel**: Operates on both Telegram (`grammy`) and WhatsApp (`twilio`).
- **Resilient Webhooks**: Idempotent webhook processing and failure dead letter queues.
- **Queued Notifications**: `bullmq` and Redis ensure users get important notifications even if third-party APIs momentarily rate-limit or drop.
- **Admin Dashboard**: Next.js-based interface for monitoring metrics, system health, and failed webhooks.

## Architecture Highlights
- **Fastify**: High-performance HTTP server for APIs and Webhooks.
- **PostgreSQL / Supabase**: Primary datastore for users, transactions, and audit logs.
- **Redis**: Caching, Session state, and BullMQ worker queues.
- **Zod**: Runtime type validation for environment variables and API payloads.

---

## 🚀 Setup & Local Development

### 1. Prerequisites
- Node.js 20+
- PostgreSQL (or Supabase)
- Redis instance (e.g., Upstash or local Redis)

### 2. Environment Variables
Copy `.env.example` to `.env` and fill in the required keys. Do **NOT** commit `.env` to version control.
```env
# Essential
DATABASE_URL=postgres://...
REDIS_URL=redis://...
PORT=3000
NODE_ENV=development

# Authentication (Make sure to generate a 32+ char key for Prod)
ADMIN_API_KEY=your_super_secret_key_here
```

### 3. Database Migration
All structured definitions are tracked in `src/db/migrations/`. 
Apply the schema before starting the bot:
```bash
npm run db:migrate
```

### 4. Running the App
To start the bot engine, webhook listener, and BullMQ notification workers:
```bash
npm install
npm run dev
```

---

## 📱 Twilio WhatsApp Configuration

By default, Twilio WhatsApp sends standard text messages via typical API execution. To enable a premium UX with **Interactive Messages (Buttons and Lists)**, you must configure Twilio's **Content API**.

1. Go to Twilio Console -> Content Template Builder.
2. Create a **List Template** and a **Button Template**.
   - These templates should be generic and map variable `{{1}}` to the message text body, and subset variables to the available buttons/options.
3. Retrieve the Content SIDs (string starting with `HX...`).
4. Add them to your `.env`:
```env
TWILIO_BUTTON_TEMPLATE_SID=HX...
TWILIO_LIST_TEMPLATE_SID=HX...
```
The Node.js engine will automatically detect these SIDs presence and switch out of standard text injection and back into fully interactive WhatsApp UI elements.

---

## 🛡️ Admin & Operational Commands

### Telegram Admin Panel
If you provide your Telegram User ID in `TELEGRAM_ADMIN_ID`, you securely gain access to:
- `/admin metrics` - Daily volume and active session counts.
- `/admin health` - Live connectivity checks to the primary DB and Redis queues.
- `/admin failed <n>` - Read-out of recent dead-lettered Webhook failures.
- `/admin block <uuid>` & `/admin unblock <uuid>` - Immediate session revocation.

*(Note: User support escalations are sent as direct messages securely to your Telegram DM).*

### Web Admin Dashboard
The visual React dashboard is located in `admin-dashboard/`.
```bash
cd admin-dashboard
npm install
npm run dev
```
Please set `ADMIN_API_KEY` in `admin-dashboard/.env.local` to identically match the backend layer. It continuously polls the internal Fastify server over `/health` and `/api/admin/*` to furnish robust infrastructure telemetry.
