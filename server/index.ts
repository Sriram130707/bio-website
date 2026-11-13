import "dotenv/config";
import { createApp } from "./app.js";
import { GeminiAnalysisProvider } from "./analysis-service.js";
import { config } from "./config.js";

const app = createApp(new GeminiAnalysisProvider(undefined, config.model, fetch, config.fallbackModels));
const server = app.listen(config.port, () => {
  console.log(`Plant Stress Insight API listening on port ${config.port}`);
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
