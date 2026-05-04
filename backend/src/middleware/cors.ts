import cors, { type CorsOptions } from "cors";

const allowedMethods = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"];
const allowedHeaders = ["Content-Type", "Authorization"];

const isLocalhostOrigin = (origin: string): boolean => {
  try {
    const { hostname, protocol } = new URL(origin);

    return (
      (protocol === "http:" || protocol === "https:") &&
      (hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1")
    );
  } catch {
    return false;
  }
};

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || isLocalhostOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
  credentials: true,
  methods: allowedMethods,
  allowedHeaders,
  maxAge: 86400,
  optionsSuccessStatus: 204,
};

export const localhostCors = cors(corsOptions);
