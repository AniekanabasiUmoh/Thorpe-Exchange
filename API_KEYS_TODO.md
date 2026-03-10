# API Keys & Configuration Todo List

This file tracks all the external API keys, secrets, and configuration URLs you need to gather before launching Thorpe Exchange to production. 

Once you have gathered these, you should place them in your production `.env` file (or host configuration, e.g., Vercel/Render/Heroku environment variables).

## 🏦 Breet (Crypto to Fiat)
- [ ] **BREET_API_KEY**: Used to authenticate with the Breet API to generate dynamic deposit addresses.
  - *Where to get:* Breet Developer Dashboard.
- [ ] **BREET_WEBHOOK_SECRET**: A secret used to verify that incoming webhook events are legitimately from Breet.
  - *Where to get:* Provided by Breet when you register your webhook endpoint URL.

## 💬 Telegram Bot
- [ ] **TELEGRAM_WEBHOOK_SECRET**: A custom secret string you create to secure your Telegram webhook endpoint from unauthorized pings.
  - *Where to get:* Generate a random secure string yourself.
- [ ] **TELEGRAM_ADMIN_ID**: Your personal Telegram User ID, used to authorize `/admin` commands and receive support escalation alerts.
  - *Where to get:* Message `@userinfobot` on Telegram to get your numeric ID.

## 🟢 WhatsApp (Twilio)
- [ ] **TWILIO_ACCOUNT_SID**: Your Twilio account identifier.
  - *Where to get:* Twilio Console Dashboard.
- [ ] **TWILIO_AUTH_TOKEN**: Your Twilio authentication token.
  - *Where to get:* Twilio Console Dashboard.
- [ ] **TWILIO_WHATSAPP_NUMBER**: Your approved Twilio WhatsApp sender number.
  - *Where to get:* Twilio Console -> WhatsApp Senders (e.g., `+1234567890`- do not include 'whatsapp:' prefix here, the code handles it).
- [ ] **TWILIO_BUTTON_TEMPLATE_SID**: (Optional but Recommended) The SID of your approved Twilio Content Template for interactive buttons.
  - *Where to get:* Twilio Console -> Content Template Builder. Starts with `HX...`
- [ ] **TWILIO_LIST_TEMPLATE_SID**: (Optional but Recommended) The SID of your approved Twilio Content Template for interactive lists.
  - *Where to get:* Twilio Console -> Content Template Builder. Starts with `HX...`

## 🛡️ Admin Dashboard & Security
- [ ] **ADMIN_API_KEY**: A highly secure secret key used by the Next.js frontend to authenticate with the Fastify backend's admin routes.
  - *Where to get:* Generate a random secure string yourself. **MUST be at least 32 characters long in production.**
- [ ] **ADMIN_DASHBOARD_URL**: The URL where your Next.js admin dashboard is deployed. Used for CORS configuration.
  - *Where to get:* The URL of your deployed dashboard (e.g., `https://admin.thorpe-exchange.com`).

---
*Tip: Once you have gathered all of these, you can delete this file.*
