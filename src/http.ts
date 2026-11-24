import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type Config } from "./config.js";
import { buildServer } from "./server.js";
import { handleSetup } from "./setup.js";

let cached: Config | undefined;

function sameSecret(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** The secret may arrive as `Authorization: Bearer`, as /mcp/<token>, /setup/<token>, or ?token=. */
function presentedToken(req: IncomingMessage): string {
  const header = req.headers.authorization;
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  const url = new URL(req.url ?? "/", "http://localhost");
  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return fromQuery;
  const match = /\/(?:mcp|setup)\/([^/?]+)/.exec(url.pathname);
  return match ? decodeURIComponent(match[1]) : "";
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const preParsed = (req as IncomingMessage & { body?: unknown }).body;
  if (preParsed !== undefined) return preParsed;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

/**
 * Stateless MCP endpoint: every POST gets its own server and transport, so it
 * runs on serverless hosts with no shared memory between requests.
 */
export async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  let config: Config;
  try {
    config = cached ??= loadConfig();
  } catch (err) {
    console.error("mail-mcp config error:", err instanceof Error ? err.message : err);
    return json(res, 500, { error: "server is not configured; check the deployment logs" });
  }

  if (!sameSecret(presentedToken(req), config.authToken)) {
    return json(res, 401, { error: "unauthorized" });
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/setup") || url.searchParams.has("setup")) {
    return handleSetup(req, res, config, url, () => readBody(req));
  }

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return json(res, 405, {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  }

  let body: unknown;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
  }

  const server = buildServer(config);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error("mail-mcp request failed:", err instanceof Error ? err.message : err);
    if (!res.headersSent) {
      json(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
}
