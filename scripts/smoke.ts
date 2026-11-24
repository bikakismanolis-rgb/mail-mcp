/**
 * Live check against a deployed server. Prints counts and errors only, never
 * message content.
 *
 *   MCP_URL=https://<host>/mcp/<token> npx tsx scripts/smoke.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL;
if (!url) {
  console.error("set MCP_URL");
  process.exit(1);
}

const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

async function call(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { text: string }[])[0]?.text ?? "";
  if (res.isError) throw new Error(text);
  return JSON.parse(text);
}

const { accounts, sendEnabled } = await call("list_accounts", {});
console.log(`accounts: ${accounts.length}, sendEnabled: ${sendEnabled}`);

let failed = false;
for (const a of accounts as { id: string; provider: string }[]) {
  try {
    const folders = await call("list_folders", { account: a.id });
    const inbox = await call("search_emails", { account: a.id, limit: 3 });
    let read = "skipped (inbox empty)";
    if (inbox.messages.length) {
      const m = await call("read_email", { account: a.id, uid: inbox.messages[0].uid, max_chars: 500 });
      read = `ok (${m.text.length} chars, ${m.attachments.length} attachments)`;
    }
    console.log(`${a.id} [${a.provider}]: folders=${folders.length} inbox_total=${inbox.total} read=${read}`);
  } catch (err) {
    failed = true;
    console.log(`${a.id} [${a.provider}]: FAILED: ${err instanceof Error ? err.message : err}`);
  }
}

await client.close();
process.exit(failed ? 1 : 0);
