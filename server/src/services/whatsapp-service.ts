import path from "node:path";
import WhatsappWeb from "whatsapp-web.js";
import { config, hasWhatsappOverrideNumber, normalizeWhatsappNumber } from "../config.js";

const { Client, LocalAuth } = WhatsappWeb;

type InboundWhatsappMessage = {
  from: string;
  body: string;
  rawFrom: string;
};

type InboundWhatsappHandler = (message: InboundWhatsappMessage) => Promise<string | null | void>;

let client: InstanceType<typeof Client> | null = null;
let isInitializing = false;
let isReady = false;
let hasAuthenticated = false;
let latestQr: string | null = null;
let lastError: string | null = null;
let lastConnectedAt: string | null = null;
let inboundHandler: InboundWhatsappHandler | null = null;

function toStoredWhatsappNumber(value: string) {
  const normalized = normalizeWhatsappNumber(value);

  if (normalized.endsWith("@c.us")) {
    const digits = normalized.replace(/@c\.us$/i, "").replace(/\D+/g, "");
    return `whatsapp:+${digits}`;
  }

  if (normalized.endsWith("@g.us")) {
    return normalized;
  }

  if (normalized.startsWith("whatsapp:")) {
    const raw = normalized.slice("whatsapp:".length);
    if (raw.startsWith("+")) {
      return `whatsapp:${raw}`;
    }
    return `whatsapp:+${raw.replace(/\D+/g, "")}`;
  }

  const digits = normalized.replace(/\D+/g, "");
  return `whatsapp:+${digits}`;
}

function toWebChatId(value: string) {
  const normalized = normalizeWhatsappNumber(value);
  if (normalized.endsWith("@c.us") || normalized.endsWith("@g.us")) {
    return normalized;
  }

  const withoutPrefix = normalized.startsWith("whatsapp:")
    ? normalized.slice("whatsapp:".length)
    : normalized;
  const digits = withoutPrefix.replace(/\D+/g, "");
  return `${digits}@c.us`;
}

function getInternalSendUrl() {
  return `${config.appBaseUrl.replace(/\/$/, "")}/internal/whatsapp/send`;
}

async function proxySendWhatsappMessage(to: string, body: string) {
  if (!config.whatsappInternalApiKey) {
    throw new Error(
      "WHATSAPP_INTERNAL_API_KEY (or CRON_JOB_API_KEY) is required for proxy WhatsApp sends."
    );
  }

  const response = await fetch(getInternalSendUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-whatsapp-internal-key": config.whatsappInternalApiKey
    },
    body: JSON.stringify({ to, body })
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        result?: {
          id?: string | null;
          to?: string;
        };
        error?: string;
      }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? `Internal WhatsApp proxy failed with status ${response.status}`);
  }

  return {
    id: payload?.result?.id ?? null,
    to: payload?.result?.to ?? to
  };
}

function shouldIgnoreInboundMessage(message: { from?: string | null; fromMe?: boolean; body?: string | null }) {
  if (message.fromMe) {
    return true;
  }

  const from = message.from ?? "";
  if (!from || from === "status@broadcast") {
    return true;
  }

  if (from.endsWith("@g.us")) {
    return true;
  }

  const body = (message.body ?? "").trim();
  return body.length === 0;
}

export function resolveOutboundWhatsappNumber(to: string) {
  return hasWhatsappOverrideNumber()
    ? normalizeWhatsappNumber(config.whatsappOverrideNumber)
    : normalizeWhatsappNumber(to);
}

export async function sendWhatsappMessageDirect(to: string, body: string) {
  if (!client || !isReady) {
    throw new Error("WhatsApp Web client is not ready yet. Scan the QR and wait for ready state.");
  }

  const outboundTo = resolveOutboundWhatsappNumber(to);
  const chatId = toWebChatId(outboundTo);
  const sentMessage = await client.sendMessage(chatId, body);
  return {
    id: sentMessage.id?._serialized ?? null,
    to: outboundTo
  };
}

export async function sendWhatsappMessage(to: string, body: string) {
  if (client && isReady) {
    return await sendWhatsappMessageDirect(to, body);
  }

  if (config.whatsappProxySendEnabled && config.whatsappInternalApiKey) {
    return await proxySendWhatsappMessage(to, body);
  }

  await initializeWhatsappClient();
  if (client && isReady) {
    return await sendWhatsappMessageDirect(to, body);
  }

  throw new Error("WhatsApp Web client is unavailable and proxy sends are disabled.");
}

export function getWhatsappClientStatus() {
  return {
    enabled: config.enableWhatsappWeb,
    initializing: isInitializing,
    ready: isReady,
    authenticated: hasAuthenticated,
    qr: latestQr,
    lastError,
    lastConnectedAt
  };
}

export function setWhatsappInboundHandler(handler: InboundWhatsappHandler) {
  inboundHandler = handler;
}

export async function initializeWhatsappClient() {
  if (!config.enableWhatsappWeb || client || isInitializing) {
    return;
  }

  isInitializing = true;
  lastError = null;

  const authPath = path.resolve(process.cwd(), config.whatsappSessionPath);

  const nextClient = new Client({
    authStrategy: new LocalAuth({
      clientId: config.whatsappClientId,
      dataPath: authPath
    }),
    puppeteer: {
      headless: config.whatsappHeadless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ]
    }
  });

  nextClient.on("qr", (qr: string) => {
    latestQr = qr;
    isReady = false;
    console.log("WhatsApp Web QR updated. Open /api/whatsapp/status to fetch it.");
  });

  nextClient.on("authenticated", () => {
    hasAuthenticated = true;
    lastError = null;
  });

  nextClient.on("auth_failure", (message: string) => {
    hasAuthenticated = false;
    isReady = false;
    lastError = `auth_failure: ${message}`;
    console.error("WhatsApp auth failure:", message);
  });

  nextClient.on("ready", () => {
    isReady = true;
    isInitializing = false;
    latestQr = null;
    lastError = null;
    lastConnectedAt = new Date().toISOString();
    console.log("WhatsApp Web client is ready.");
  });

  nextClient.on("disconnected", (reason: string) => {
    isReady = false;
    hasAuthenticated = false;
    lastError = `disconnected: ${reason}`;
    console.warn("WhatsApp Web client disconnected:", reason);
  });

  nextClient.on("message", async (message: { from?: string; fromMe?: boolean; body?: string }) => {
    if (shouldIgnoreInboundMessage(message)) {
      return;
    }

    if (!inboundHandler) {
      return;
    }

    const from = toStoredWhatsappNumber(message.from ?? "");
    const body = (message.body ?? "").trim();

    try {
      const reply = await inboundHandler({
        from,
        body,
        rawFrom: message.from ?? ""
      });

      if (reply) {
        await sendWhatsappMessageDirect(from, reply);
      }
    } catch (error) {
      const fallback =
        "Something went wrong on my side just now. Please try that again in a moment 🙂";
      try {
        await sendWhatsappMessageDirect(from, fallback);
      } catch {
        // Ignore secondary send failures.
      }
      console.error("Failed to process inbound WhatsApp message", error);
    }
  });

  client = nextClient;
  try {
    await nextClient.initialize();
  } catch (error) {
    isInitializing = false;
    isReady = false;
    lastError = error instanceof Error ? error.message : "Failed to initialize WhatsApp client";
    console.error("Failed to initialize WhatsApp Web client", error);
  }
}
