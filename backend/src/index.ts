import app from "./app";
import { env } from "./config/env";
import { AppDataSource } from "./data-source";
import { deleteExpiredRevokedTokens } from "./repositories/revoked-token.repository";

const bootstrap = async (): Promise<void> => {
  await AppDataSource.initialize();
  await deleteExpiredRevokedTokens();
  console.log("Database connection established.");

  app.listen(env.port, () => {
    console.log(`Server listening on port ${env.port}.`);
  });
};

bootstrap().catch((error: unknown) => {
  console.error("Failed to start server.", error);
  process.exit(1);
});
