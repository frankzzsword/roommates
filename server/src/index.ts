import { createApp } from "./app.js";
import { config } from "./config.js";
import { startScheduler } from "./services/scheduler.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`Server running on ${config.appBaseUrl}`);
  console.log(`Health check: ${config.appBaseUrl}/health`);
});

startScheduler();
