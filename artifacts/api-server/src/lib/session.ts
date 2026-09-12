import session, { type SessionOptions } from "express-session";
import type { RequestHandler } from "express";
import { SESSION_SECRET } from "./session-secret";
import { PrismaSessionStore, SESSION_TTL_MS } from "./session-store";

const isProduction = process.env["NODE_ENV"] === "production";

export const SESSION_COOKIE_NAME = "peppol_ready_sid";

export const sessionStore = new PrismaSessionStore();

const options: SessionOptions = {
  name: SESSION_COOKIE_NAME,
  secret: SESSION_SECRET,
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
