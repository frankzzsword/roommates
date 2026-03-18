# Roommate Chores Bot Backend

Node.js + TypeScript + Express backend for a WhatsApp chores bot. It uses SQLite for local state, Twilio webhooks for inbound WhatsApp messages, and includes seeded data so it can run before real credentials are wired in.

## Features

- WhatsApp webhook endpoint for Twilio inbound messages
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

## Twilio Setup

Point the Twilio WhatsApp sandbox or WhatsApp sender webhook to:

`POST /webhooks/twilio/whatsapp`

For local testing with Twilio, expose the server with a tunnel like ngrok:

```bash
ngrok http 3001
```

Then set the webhook URL in Twilio to:

`https://your-ngrok-domain.ngrok.app/webhooks/twilio/whatsapp`

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
- If Twilio credentials are absent, webhook replies still work via TwiML response messages.
- The scheduler is intentionally minimal for a first pass. It is ready for replacement with BullMQ, cron, or Supabase jobs later.
