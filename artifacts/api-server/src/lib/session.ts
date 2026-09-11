import session, { type SessionOptions } from "express-session";
import type { RequestHandler } from "express";
import { PrismaSessionStore, SESSION_TTL_MS } from "./session-store";

const isProduction = process.env["NODE_ENV"] === "production";

export const sessionStore = new PrismaSessionStore();

function resolveSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (secret) return secret;

  if (isProduction) {
    throw new Error(
      "SESSION_SECRET environment variable is required in production.",
    );
  }

  // Development only: a fixed value keeps sessions alive across restarts.
  return "peppol-ready-development-secret";
}

const options: SessionOptions = {
  name: "peppol_ready_sid",
  secret: resolveSecret(),
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: SESSION_TTL_MS,
    path: "/",
  },
};

export const sessionMiddleware: RequestHandler = session(options);
