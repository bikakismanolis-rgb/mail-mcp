import type { IncomingMessage, ServerResponse } from "node:http";
import { OUTLOOK_AUTH_BASE, OUTLOOK_SCOPE, detectProvider, type Config } from "./config.js";
import { explainError, listFolders } from "./mail.js";
import { SETUP_PAGE } from "./setup-page.js";

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function form(data: Record<string, string>) {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data),
  };
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);
}

/** Logs in to every mailbox and reports which ones work. */
async function status(config: Config) {
  const accounts = await Promise.all(
    config.accounts.map(async (a) => {
      const base = { id: a.id, email: a.email, provider: a.provider };
      try {
        const folders = await timeout(listFolders(a), 25_000);
        return { ...base, ok: true, folders: folders.length };
      } catch (err) {
        return { ...base, ok: false, error: explainError(err) };
      }
    }),
  );
  return { accounts, sendEnabled: config.allowSend, outlookReady: Boolean(config.outlookClientId) };
}

/** Step 1 of Microsoft's device-code sign-in: get a short code for the user to type. */
async function outlookStart(config: Config) {
  if (!config.outlookClientId) throw new Error("OUTLOOK_CLIENT_ID is not set on this server");
  const res = await fetch(
    `${OUTLOOK_AUTH_BASE}/devicecode`,
    form({ client_id: config.outlookClientId, scope: OUTLOOK_SCOPE }),
  );
  const body = (await res.json()) as Record<string, unknown>;
  if (!body.device_code) throw new Error(String(body.error_description ?? "Microsoft refused the request"));
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    interval: body.interval ?? 5,
  };
}

/** Step 2: ask Microsoft whether the user finished signing in yet. */
async function outlookPoll(config: Config, deviceCode: string, email: string) {
  if (!config.outlookClientId) throw new Error("OUTLOOK_CLIENT_ID is not set on this server");
  if (detectProvider(email) !== "outlook") throw new Error("that is not an Outlook/Hotmail address");
  const res = await fetch(
    `${OUTLOOK_AUTH_BASE}/token`,
    form({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: config.outlookClientId,
      device_code: deviceCode,
    }),
  );
  const body = (await res.json()) as Record<string, unknown>;
  if (body.refresh_token) {
    return { done: true, value: `${email} token:${body.refresh_token}` };
  }
  if (body.error === "authorization_pending" || body.error === "slow_down") return { done: false };
  throw new Error(String(body.error_description ?? body.error ?? "sign-in failed"));
}

export async function handleSetup(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  url: URL,
  body: () => Promise<unknown>,
) {
  const action = url.searchParams.get("action");
  try {
    if (!action && req.method === "GET") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex, nofollow",
        "x-frame-options": "DENY",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
      });
      return void res.end(SETUP_PAGE);
    }
    if (action === "status" && req.method === "GET") return json(res, 200, await status(config));
    if (action === "outlook-start" && req.method === "POST") {
      return json(res, 200, await outlookStart(config));
    }
    if (action === "outlook-poll" && req.method === "POST") {
      const input = ((await body()) ?? {}) as { deviceCode?: unknown; email?: unknown };
      if (typeof input.deviceCode !== "string" || typeof input.email !== "string") {
        return json(res, 400, { error: "deviceCode and email are required" });
      }
      return json(res, 200, await outlookPoll(config, input.deviceCode, input.email.trim()));
    }
    return json(res, 404, { error: "not found" });
  } catch (err) {
    return json(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
}
