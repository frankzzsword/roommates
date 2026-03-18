import twilio from "twilio";
import {
  config,
  hasTwilioCredentials,
  hasWhatsappOverrideNumber,
  normalizeWhatsappNumber
} from "../config.js";

let client: twilio.Twilio | null = null;

function getClient() {
  if (!hasTwilioCredentials()) {
    return null;
  }

  if (!client) {
    client = twilio(config.twilioAccountSid, config.twilioAuthToken);
  }

  return client;
}

export function resolveOutboundWhatsappNumber(to: string) {
  return hasWhatsappOverrideNumber()
    ? normalizeWhatsappNumber(config.whatsappOverrideNumber)
    : normalizeWhatsappNumber(to);
}

export async function sendWhatsappMessage(to: string, body: string) {
  const twilioClient = getClient();
  if (!twilioClient) {
    throw new Error("Twilio credentials are not configured.");
  }

  const outboundTo = resolveOutboundWhatsappNumber(to);

  return twilioClient.messages.create({
    from: config.twilioWhatsappNumber,
    to: outboundTo,
    body
  });
}

export function buildTwimlMessage(body: string) {
  const response = new twilio.twiml.MessagingResponse();
  response.message(body);
  return response.toString();
}
