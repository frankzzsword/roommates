import { createApp } from "./app.js";
import { config } from "./config.js";
import { initializeDatabase } from "./db/init.js";
import { primeHouseholdSnapshotCacheAsync } from "./services/household-service.js";
import { processInboundMessage } from "./services/message-service.js";
import { initializeWhatsappClient, setWhatsappInboundHandler } from "./services/whatsapp-service.js";

async function main() {
  await initializeDatabase();
  const app = createApp();

  app.listen(config.port, () => {
    console.log(`Server running on ${config.appBaseUrl}`);
    console.log(`Health check: ${config.appBaseUrl}/health`);
  });

  primeHouseholdSnapshotCacheAsync();

  setWhatsappInboundHandler(async ({ from, body }) => {
    const result = await processInboundMessage({ from, body });
    return result.message;
  });

  if (config.enableWhatsappWeb) {
    initializeWhatsappClient().catch((error) => {
      console.error("Failed to initialize WhatsApp Web client", error);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
