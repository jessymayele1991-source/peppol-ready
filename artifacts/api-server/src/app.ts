import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
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
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
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
// protocol behind the platform proxy.
app.set("trust proxy", 1);

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
