import { buildApp } from "./app";
import { loadConfig } from "./utils/env";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp();
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
