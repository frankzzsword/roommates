# Roommate Punishment

Fast MVP for a shared-apartment chore system:

- `server/`: WhatsApp bot backend with Twilio webhook support and SQLite state
- `app-mobile/`: Expo mobile app that reads the same chores and history data

## What you need

- Node.js 20+
- A Twilio account
- Twilio WhatsApp Sandbox enabled
- Expo Go on your phone
- A webhook tunnel such as `ngrok` or `cloudflared`
- Optional: a Neon Postgres database for hosted persistence

## Fastest 30-minute setup

1. Install Node.js 20+ if it is not already installed.
2. In `server/`, copy `.env.example` to `.env`.
3. Fill in:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_WHATSAPP_NUMBER`
4. Start the backend:

```bash
cd server
npm install
npm run dev
```

5. Expose the backend:

```bash
ngrok http 4311
```

6. In Twilio WhatsApp Sandbox, set the inbound webhook to:

```text
https://YOUR-NGROK-DOMAIN.ngrok.app/webhooks/twilio/whatsapp
```

7. Join the sandbox from each testing phone by sending the join code to the sandbox number.
8. In `app-mobile/`, copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_BASE_URL` to your computer's LAN IP, for example `http://192.168.1.10:4311`.
9. Start the mobile app:

```bash
cd app-mobile
npm install
npm run start
```

## Working commands in WhatsApp

- `HELP`
- `TASKS`
- `STATUS`
- `DONE`
- `DONE 1`
- `SKIP`
- `SKIP 1 sick today`

## Neon

The project now includes a Neon bootstrap script that creates the Postgres schema and copies the current local SQLite dataset into Neon.

```bash
cd server
DATABASE_URL='your-neon-connection-string' npm run db:bootstrap-neon
```

Right now the running backend still reads from local SQLite. Neon is set up and populated, but the server has not yet been fully migrated from `better-sqlite3` to Postgres.

## Current constraints

- This is built for Twilio WhatsApp Sandbox first, not full Meta production approval.
- Node is being run from a local project toolchain under `.tools/`, not a system-wide installation.
- The mobile app falls back to preview data if `EXPO_PUBLIC_API_BASE_URL` is missing or unreachable.
- Neon is bootstrapped and populated, but the running backend still reads from local SQLite.
