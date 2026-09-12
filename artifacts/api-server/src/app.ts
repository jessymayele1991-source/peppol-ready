import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import type { Request } from "express";
import { logger } from "./lib/logger";
import { LOG_PROXY_CHAIN, TRUST_PROXY_HOPS } from "./lib/proxy-config";
import { sessionMiddleware } from "./lib/session";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler";

const app: Express = express();

/**
 * In production the web artifact and this API are served from one origin, so
 * the session cookie needs no CORS at all. In development they run on separate
 * ports, so the dev origin is allowed explicitly with credentials — a wildcard
 * origin cannot carry cookies.
 */
const devOrigin = process.env["WEB_ORIGIN"];

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        const base = {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
        if (!LOG_PROXY_CHAIN) return base;

        const raw = req.raw as Request;
        return {
          ...base,
          proxyChain: {
            xForwardedFor: raw.headers["x-forwarded-for"] ?? null,
            xForwardedProto: raw.headers["x-forwarded-proto"] ?? null,
            socketAddress: raw.socket?.remoteAddress ?? null,
            ip: raw.ip,
            ips: raw.ips,
            trustProxyHops: TRUST_PROXY_HOPS,
          },
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
if (devOrigin) {
  app.use(cors({ origin: devOrigin, credentials: true }));
}

// Sessions are signed cookies, so express-session needs a trustworthy
// protocol behind the platform proxy, and the per-address sign-in limit needs
// the real client address. See lib/proxy-config.ts before changing the count.
app.set("trust proxy", TRUST_PROXY_HOPS);

app.use(cookieParser());
// JSON only. A urlencoded parser would let a cross-site HTML form post
// credentials to /auth/login and sign the visitor into another account: forms
// need no CORS preflight and login needs no existing cookie, so SameSite does
// not help. application/json from another origin always triggers a preflight.
app.use(express.json());
app.use(sessionMiddleware);

app.use("/api", router);
app.use("/api", notFoundHandler);
app.use(errorHandler);

export default app;
