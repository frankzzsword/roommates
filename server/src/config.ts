import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const rootDir = process.cwd();
const databaseUrl = process.env.DATABASE_URL ?? "";

export const config = {
  port: Number(process.env.PORT ?? 3001),
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3001",
  databaseUrl,
  snapshotPath: path.resolve(
    rootDir,
    process.env.HOUSEHOLD_SNAPSHOT_PATH ?? "./tmp/household-snapshot.json"
  ),
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  twilioWhatsappNumber:
    process.env.TWILIO_WHATSAPP_NUMBER ?? "whatsapp:+14155238886",
  whatsappOverrideNumber: process.env.WHATSAPP_OVERRIDE_NUMBER ?? "",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiSubtaskModel: process.env.OPENAI_SUBTASK_MODEL ?? "gpt-5.4-mini",
  enableOutboundReminders:
    process.env.ENABLE_OUTBOUND_REMINDERS === "true",
  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? "Europe/Berlin"
};

export function hasDatabaseUrl() {
  return Boolean(config.databaseUrl);
}

export function hasTwilioCredentials() {
  return Boolean(config.twilioAccountSid && config.twilioAuthToken);
}

export function hasOpenAiCredentials() {
  return Boolean(config.openAiApiKey);
}

export function normalizeWhatsappNumber(value: string) {
  return value.replace(/\s+/g, "").trim();
}

export function hasWhatsappOverrideNumber() {
  return Boolean(config.whatsappOverrideNumber);
}

export function isTrustedProxyWhatsappNumber(value: string) {
  if (!config.whatsappOverrideNumber) {
    return false;
  }

  return normalizeWhatsappNumber(value) === normalizeWhatsappNumber(config.whatsappOverrideNumber);
}
