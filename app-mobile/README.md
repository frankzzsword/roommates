# Roommate Chores Mobile

Expo Router scaffold for a roommate chores app. It opens with preview data by default and switches to live backend data when the API base URL is configured.

## What is included

- Dashboard
- Chores list
- History log
- Settings
- Shared mock data under `src/data/mock.ts`

## Run

1. Install Node.js 20 or newer.
2. From this directory, run `npm install`.
3. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_BASE_URL` to your computer's LAN IP, for example `http://192.168.1.10:3001`.
4. Start Expo with `npm run start`.
5. Open the app in Expo Go or an iOS/Android simulator.

## Expected integration points

- Read chores, roommates, and history from the backend when `EXPO_PUBLIC_API_BASE_URL` is set
- Add auth if you decide only the main renter can manage assignments
- Connect reminder and history actions to the WhatsApp webhook service
