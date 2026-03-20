import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const rootDir = process.cwd();
const databaseUrl = process.env.DATABASE_URL ?? "";
const isProduction = process.env.NODE_ENV === "production";
const allowWhatsappOverride = process.env.ALLOW_WHATSAPP_OVERRIDE === "true";
const legacyOverrideNumber = process.env.TWILIO_FORCE_TO_NUMBER ?? "";
const configuredWhatsappOverrideNumber =
  process.env.WHATSAPP_OVERRIDE_NUMBER ?? legacyOverrideNumber;
const whatsappOverrideNumber =
  configuredWhatsappOverrideNumber && !isProduction && allowWhatsappOverride
    ? configuredWhatsappOverrideNumber
    : "";

if (configuredWhatsappOverrideNumber && !whatsappOverrideNumber) {
  console.warn(
    "WHATSAPP_OVERRIDE_NUMBER is set but inactive. " +
      "Override routing only works when ALLOW_WHATSAPP_OVERRIDE=true " +
      "and NODE_ENV is not production."
  );
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3001",
  webAppUrl: process.env.WEB_APP_URL ?? "https://wgtakt.vercel.app",
  databaseUrl,
  adminLoginName: process.env.ADMIN_LOGIN_NAME ?? "Admin",
  adminLoginPassword: process.env.ADMIN_LOGIN_PASSWORD ?? "admin123",
  adminDisplayName: process.env.ADMIN_DISPLAY_NAME ?? "House admin",
  snapshotPath: path.resolve(
    rootDir,
    process.env.HOUSEHOLD_SNAPSHOT_PATH ?? "./tmp/household-snapshot.json"
  ),
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  twilioWhatsappNumber:
    process.env.TWILIO_WHATSAPP_NUMBER ?? "whatsapp:+14155238886",
  whatsappOverrideNumber,
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
