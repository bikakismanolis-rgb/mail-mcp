import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { detectProvider, loadConfig, parseAccounts, parseSimpleAccount } from "../src/config.js";
import { buildServer } from "../src/server.js";

const TOKEN = "test-token-0123456789-abcdefghij";
const ACCOUNTS = [
  { id: "g1", provider: "gmail", email: "one@gmail.com", password: "x" },
  { id: "g2", provider: "gmail", email: "two@gmail.com", password: "x" },
  { id: "y", provider: "yahoo", email: "me@yahoo.com", password: "x" },
  { id: "hot", provider: "outlook", email: "me@hotmail.com", oauth: { clientId: "c", refreshToken: "r" } },
];

let http: Server;
let base: string;

before(async () => {
  process.env.MCP_AUTH_TOKEN = TOKEN;
  process.env.MAIL_ACCOUNTS = JSON.stringify(ACCOUNTS);
  const { handleMcp } = await import("../src/http.js");
  http = createServer((req, res) => void handleMcp(req, res));
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

after(() => http.close());

async function connect(url: string) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

test("rejects a missing or wrong token", async () => {
  for (const path of ["/mcp", "/mcp/wrong", "/api/mcp?token=nope"]) {
    const res = await fetch(base + path, { method: "POST", body: "{}" });
    assert.equal(res.status, 401, path);
  }
});

test("accepts the token in the path, the query and the header", async () => {
  const init = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
  };
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const attempts: [string, Record<string, string>][] = [
    [`/mcp/${TOKEN}`, {}],
    [`/api/mcp?token=${TOKEN}`, {}],
    ["/mcp", { authorization: `Bearer ${TOKEN}` }],
  ];
  for (const [path, extra] of attempts) {
    const res = await fetch(base + path, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(init) });
    assert.equal(res.status, 200, path);
    const body = (await res.json()) as { result: { serverInfo: { name: string } } };
    assert.equal(body.result.serverInfo.name, "mail-mcp");
  }
});

test("a real MCP client can list tools and accounts; passwords never leak", async () => {
  const client = await connect(`${base}/mcp/${TOKEN}`);
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "create_draft", "fetch", "list_accounts", "list_folders",
    "mark_emails", "move_emails", "move_matching", "read_email", "search", "search_emails", "sender_stats",
  ]);
  const res = await client.callTool({ name: "list_accounts", arguments: {} });
  const text = (res.content as { text: string }[])[0].text;
  const data = JSON.parse(text);
  assert.equal(data.sendEnabled, false);
  assert.equal(data.accounts.length, 4);
  assert.ok(!text.includes("password") && !text.includes("refreshToken"));
  await client.close();
});

test("unknown account is a tool error, not a crash", async () => {
  const client = await connect(`${base}/mcp/${TOKEN}`);
  const res = await client.callTool({ name: "list_folders", arguments: { account: "nope" } });
  assert.equal(res.isError, true);
  await client.close();
});

test("send_email only exists when sending is switched on", async () => {
  const accounts = parseAccounts(JSON.stringify(ACCOUNTS));
  const has = (allowSend: boolean) =>
    "send_email" in (buildServer({ accounts, authToken: TOKEN, allowSend }) as unknown as { _registeredTools: object })._registeredTools;
  assert.equal(has(false), false);
  assert.equal(has(true), true);
});

test("account config: presets, validation, duplicates", () => {
  const [g, , y, hot] = parseAccounts(JSON.stringify(ACCOUNTS));
  assert.equal(g.imap.host, "imap.gmail.com");
  assert.equal(y.smtp.host, "smtp.mail.yahoo.com");
  assert.equal(hot.smtp.secure, false);
  assert.match(hot.oauth!.tokenUrl, /consumers/);
  assert.throws(() => parseAccounts("not json"), /not valid JSON/);
  assert.throws(() => parseAccounts(JSON.stringify([{ id: "a", provider: "gmail", email: "a@b.co" }])), /exactly one/);
  assert.throws(() => parseAccounts(JSON.stringify([{ id: "a", provider: "custom", email: "a@b.co", password: "x" }])), /custom/);
});

test("simple one-line accounts: provider detection, ids, password spaces", () => {
  assert.equal(detectProvider("a@googlemail.com"), "gmail");
  assert.equal(detectProvider("a@yahoo.gr"), "yahoo");
  assert.equal(detectProvider("a@hotmail.co.uk"), "outlook");
  assert.equal(detectProvider("a@live.com"), "outlook");
  assert.equal(detectProvider("a@icloud.com"), "icloud");
  assert.equal(detectProvider("a@firma.gr"), undefined);

  const g = parseSimpleAccount("MAIL_ACCOUNT_1", "  me@gmail.com abcd efgh ijkl mnop ");
  assert.deepEqual([g.id, g.provider, g.password], ["gmail1", "gmail", "abcdefghijklmnop"]);
  const y = parseSimpleAccount("MAIL_ACCOUNT_WORK", "me@yahoo.com secret");
  assert.deepEqual([y.id, y.imap.host], ["work", "imap.mail.yahoo.com"]);
  const h = parseSimpleAccount("MAIL_ACCOUNT_HOT", "me@hotmail.com token:abc", "client-1");
  assert.deepEqual([h.oauth?.clientId, h.oauth?.refreshToken, h.password], ["client-1", "abc", undefined]);

  assert.throws(() => parseSimpleAccount("MAIL_ACCOUNT_1", "me@hotmail.com pw"), /setup page/);
  assert.throws(() => parseSimpleAccount("MAIL_ACCOUNT_1", "me@hotmail.com token:abc"), /OUTLOOK_CLIENT_ID/);
  assert.throws(() => parseSimpleAccount("MAIL_ACCOUNT_1", "me@firma.gr pw"), /unknown mail provider/);
  assert.throws(() => parseSimpleAccount("MAIL_ACCOUNT_1", "me@gmail.com"), /must look like/);
});

test("loadConfig merges both forms, allows zero mailboxes, rejects clashes", () => {
  const TOKEN_ENV = { MCP_AUTH_TOKEN: TOKEN };
  assert.equal(loadConfig(TOKEN_ENV).accounts.length, 0);
  const merged = loadConfig({
    ...TOKEN_ENV,
    MAIL_ACCOUNTS: JSON.stringify([ACCOUNTS[2]]),
    MAIL_ACCOUNT_2: "b@gmail.com pw",
    MAIL_ACCOUNT_1: "a@gmail.com pw",
    MAIL_ACCOUNT_EMPTY: " ",
  });
  assert.deepEqual(merged.accounts.map((a) => a.id), ["y", "gmail1", "gmail2"]);
  assert.throws(
    () => loadConfig({ ...TOKEN_ENV, MAIL_ACCOUNTS: JSON.stringify([ACCOUNTS[0]]), MAIL_ACCOUNT_G1: "a@gmail.com pw" }),
    /share the id/,
  );
  assert.throws(() => loadConfig({ MCP_AUTH_TOKEN: "short" }), /at least 24/);
});

test("setup page: needs the token, serves locked-down HTML, reports status", async () => {
  assert.equal((await fetch(`${base}/setup/wrong`)).status, 401);
  const page = await fetch(`${base}/setup/${TOKEN}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.equal(page.headers.get("cache-control"), "no-store");
  const html = await page.text();
  assert.ok(html.includes("MAIL_ACCOUNT_") && !html.includes(TOKEN));

  // Vercel delivers the same request as /api/mcp?token=..&setup=1
  assert.equal((await fetch(`${base}/api/mcp?token=${TOKEN}&setup=1`)).status, 200);
  assert.equal((await fetch(`${base}/setup/${TOKEN}?action=nope`)).status, 404);

  // No OUTLOOK_CLIENT_ID in this test server.
  const start = await fetch(`${base}/setup/${TOKEN}?action=outlook-start`, { method: "POST", body: "{}" });
  assert.equal(start.status, 400);
  assert.match(((await start.json()) as { error: string }).error, /OUTLOOK_CLIENT_ID/);
});
