# Roommate Chores Bot Backend

Node.js + TypeScript + Express backend for a WhatsApp chores bot. It uses SQLite/Postgres for state and `whatsapp-web.js` for inbound/outbound WhatsApp messages.

## Features

- Native WhatsApp Web client transport via `whatsapp-web.js`
- Commands: `HELP`, `TASKS`, `STATUS`, `DONE`, `SKIP`
- Mobile app endpoints: `GET /api/assignments`, `GET /api/roommates`, `GET /api/events`
- SQLite schema with chores, assignments, roommates, and event log
- Seeded sample data for quick local testing
- Recurring reminder scheduler stub with optional outbound sending

## Quick Start

1. Install dependencies:

```bash
cd server
npm install
```

2. Create an env file:

```bash
cp .env.example .env
```

3. Start the server:

```bash
npm run dev
```

The app creates and seeds the SQLite database on first boot.

## WhatsApp Web Setup

1. Start the server.
2. Open `GET /api/whatsapp/status` and copy the `qr` value.
3. Scan that QR from WhatsApp on the account that should run automation.
4. Wait for `ready: true` in the same status endpoint.

Useful endpoints:

- `GET /api/whatsapp/status`
- `POST /api/whatsapp/reconnect`

## Command Examples

- `HELP`
- `TASKS`
- `STATUS`
- `DONE`
- `DONE 3`
- `SKIP`
- `SKIP 3 sick today`

`DONE` and `SKIP` without an ID operate on the sender's oldest pending assignment.

## Neon Bootstrap

You can initialize a hosted Neon Postgres database from the current local SQLite data:

```bash
DATABASE_URL='your-neon-connection-string' npm run db:bootstrap-neon
```

This creates the schema in Neon and copies house settings, roommates, chores, assignments, penalties, and event history.

## Seed Users

The seeded roommates are mapped to example WhatsApp numbers:

- `Alex` -> `whatsapp:+491701111111`
- `Sam` -> `whatsapp:+491702222222`
- `Jamie` -> `whatsapp:+491703333333`

Update those numbers in the database or seed script to match real participants.

## Notes

- Outbound reminders are disabled unless `ENABLE_OUTBOUND_REMINDERS=true`.
- When running separate web/scheduler processes, keep `WHATSAPP_PROXY_SEND=true` so scheduler sends through the web process's WhatsApp client.
- The scheduler is intentionally minimal for a first pass. It is ready for replacement with BullMQ, cron, or Supabase jobs later.
