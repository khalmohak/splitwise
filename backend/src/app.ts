import express from "express";
import morgan from "morgan";

import authRoutes from "./routes/auth";
import categoryRoutes from "./routes/categories";
import groupRoutes from "./routes/groups";
import userRoutes from "./routes/users";
import { localhostCors } from "./middleware/cors";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { env } from "./config/env";

const app = express();

app.use(localhostCors);
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRoutes);
app.use("/categories", categoryRoutes);
app.use("/groups", groupRoutes);
app.use("/users", userRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
