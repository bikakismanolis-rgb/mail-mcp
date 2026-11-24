import { ImapFlow } from "imapflow";
import type { FetchMessageObject, SearchObject } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser } from "mailparser";
import type { Account } from "./config.js";
import { getAccessToken } from "./oauth.js";

const MAX_SOURCE_BYTES = 4_000_000;
const LOCAL_SCAN_LIMIT = 1500;

/** Turns library errors into something a person can act on. Never includes secrets. */
export function explainError(err: unknown): string {
  const e = err as { authenticationFailed?: boolean; responseText?: string; code?: string; message?: string };
  if (e?.authenticationFailed) {
    return "the mail server rejected the login: check the address and the app password (or reconnect the account)";
  }
  if (e?.code === "ENOTFOUND" || e?.code === "ECONNREFUSED" || e?.code === "ETIMEDOUT") {
    return `could not reach the mail server (${e.code})`;
  }
  const detail = e?.responseText ? `: ${e.responseText}` : "";
  return `${e?.message ?? String(err)}${detail}`;
}

async function credentials(account: Account) {
  return account.oauth
    ? { user: account.email, accessToken: await getAccessToken(account) }
    : { user: account.email, pass: account.password! };
}

/** Opens a connection, runs `fn`, and always closes the connection again. */
async function withImap<T>(account: Account, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    auth: await credentials(account),
    logger: false,
    socketTimeout: 45_000,
  });
  // Without a listener a dropped socket would crash the process.
  client.on("error", () => {});
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

async function withMailbox<T>(
  account: Account,
  folder: string,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      return await fn(client);
    } finally {
      lock.release();
    }
  });
}

export type FolderInfo = { path: string; name: string; specialUse?: string };

export async function listFolders(account: Account): Promise<FolderInfo[]> {
  return withImap(account, async (client) => {
    const boxes = await client.list();
    return boxes
      .filter((b) => !b.flags?.has("\\Noselect"))
      .map((b) => ({ path: b.path, name: b.name, specialUse: b.specialUse || undefined }));
  });
}

async function findSpecialFolder(client: ImapFlow, use: string, fallbacks: string[]) {
  const boxes = await client.list();
  const hit =
    boxes.find((b) => b.specialUse === use) ??
    boxes.find((b) => fallbacks.includes(b.path.toLowerCase()));
  if (!hit) throw new Error(`could not find the ${use.replace("\\", "")} folder for this account`);
  return hit.path;
}

export type Summary = {
  uid: number;
  date?: string;
  from?: string;
  to?: string;
  subject?: string;
  unread: boolean;
  flagged: boolean;
  hasAttachments?: boolean;
  messageId?: string;
};

function addr(list?: { name?: string; address?: string }[]) {
  if (!list?.length) return undefined;
  return list
    .map((a) => (a.name ? `${a.name} <${a.address ?? ""}>` : (a.address ?? "")))
    .join(", ");
}

function hasAttachment(node: FetchMessageObject["bodyStructure"]): boolean {
  if (!node) return false;
  if (node.disposition === "attachment") return true;
  return (node.childNodes ?? []).some(hasAttachment);
}

function summarize(m: FetchMessageObject): Summary {
  return {
    uid: m.uid,
    date: (m.envelope?.date ?? m.internalDate)
      ? new Date((m.envelope?.date ?? m.internalDate) as Date | string).toISOString()
      : undefined,
    from: addr(m.envelope?.from),
    to: addr(m.envelope?.to),
    subject: m.envelope?.subject,
    unread: !m.flags?.has("\\Seen"),
    flagged: Boolean(m.flags?.has("\\Flagged")),
    hasAttachments: hasAttachment(m.bodyStructure),
    messageId: m.envelope?.messageId,
  };
}

export type SearchParams = {
  folder: string;
  query?: string;
  from?: string;
  to?: string;
  subject?: string;
  since?: string;
  before?: string;
  unreadOnly?: boolean;
  flaggedOnly?: boolean;
  limit: number;
};

function toDate(value: string, field: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`${field} is not a valid date: ${value}`);
  return d;
}

export async function searchEmails(account: Account, p: SearchParams) {
  const criteria: SearchObject = {};
  if (p.query) criteria.text = p.query;
  if (p.from) criteria.from = p.from;
  if (p.to) criteria.to = p.to;
  if (p.subject) criteria.subject = p.subject;
  if (p.since) criteria.since = toDate(p.since, "since");
  if (p.before) criteria.before = toDate(p.before, "before");
  if (p.unreadOnly) criteria.seen = false;
  if (p.flaggedOnly) criteria.flagged = true;
  if (Object.keys(criteria).length === 0) criteria.all = true;

  return withMailbox(account, p.folder, async (client) => {
    const found = await client.search(criteria, { uid: true });
    const uids = (found || []).sort((a, b) => a - b);
    const page = uids.slice(-p.limit);
    if (page.length === 0) return { total: 0, messages: [] as Summary[] };
    const rows = await client.fetchAll(
      page,
      { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true },
      { uid: true },
    );
    const messages = rows.map(summarize).sort((a, b) => b.uid - a.uid);
    return { total: uids.length, messages };
  });
}

export type SenderStats = {
  address: string;
  name?: string;
  total: number;
  unread: number;
  /** True when not a single message from this sender has been opened. */
  neverOpened: boolean;
  latest?: string;
  latestSubject?: string;
  /** Value of the List-Unsubscribe header of the newest message, if any. */
  unsubscribe?: string;
};

/**
 * Groups messages by sender and counts how many are still unread. With
 * `newslettersOnly` it looks only at mail carrying a List-Unsubscribe header,
 * which is how bulk senders mark themselves.
 */
export async function senderStats(
  account: Account,
  p: { folder: string; since?: string; newslettersOnly: boolean; maxMessages: number },
) {
  const criteria: SearchObject = {};
  if (p.newslettersOnly) criteria.header = { "list-unsubscribe": true };
  if (p.since) criteria.since = toDate(p.since, "since");
  if (Object.keys(criteria).length === 0) criteria.all = true;

  return withMailbox(account, p.folder, async (client) => {
    let found = (await client.search(criteria, { uid: true })) || [];
    // Some servers (Yahoo) answer a header-existence search with nothing. Then
    // scan everything and keep the messages that carry the header ourselves.
    let filterLocally = false;
    if (p.newslettersOnly && found.length === 0) {
      const { header: _header, ...rest } = criteria;
      found = (await client.search(Object.keys(rest).length ? rest : { all: true }, { uid: true })) || [];
      filterLocally = true;
    }
    const uids = found.sort((a, b) => a - b);
    // The local scan downloads whole header blocks (those servers also ignore
    // requests for a single header field), so it looks at fewer messages.
    const page = uids.slice(-(filterLocally ? Math.min(p.maxMessages, LOCAL_SCAN_LIMIT) : p.maxMessages));
    const senders = new Map<string, SenderStats & { latestUid: number }>();
    let counted = 0;
    if (page.length) {
      const rows = await client.fetchAll(
        page,
        {
          uid: true,
          envelope: true,
          flags: true,
          internalDate: true,
          headers: filterLocally ? true : ["list-unsubscribe"],
        },
        { uid: true },
      );
      for (const m of rows) {
        const header = (m.headers?.toString() ?? "").replace(/\r?\n\s+/g, " ");
        const unsubscribe = /^list-unsubscribe:\s*(.+)$/im.exec(header)?.[1]?.trim();
        if (filterLocally && !unsubscribe) continue;
        counted += 1;
        const from = m.envelope?.from?.[0];
        const address = (from?.address ?? "unknown").toLowerCase();
        const s =
          senders.get(address) ??
          ({ address, total: 0, unread: 0, neverOpened: true, latestUid: 0 } as SenderStats & { latestUid: number });
        s.total += 1;
        if (!m.flags?.has("\\Seen")) s.unread += 1;
        if (m.uid > s.latestUid) {
          s.latestUid = m.uid;
          s.name = from?.name || s.name;
          const when = m.envelope?.date ?? m.internalDate;
          s.latest = when ? new Date(when as Date | string).toISOString().slice(0, 10) : undefined;
          s.latestSubject = m.envelope?.subject;
          s.unsubscribe = unsubscribe ? unsubscribe.slice(0, 300) : undefined;
        }
        senders.set(address, s);
      }
    }
    const list = [...senders.values()]
      .map(({ latestUid: _latestUid, ...s }) => ({ ...s, neverOpened: s.unread === s.total }))
      .sort((a, b) => b.total - a.total);
    return {
      /** Messages scanned, and how many of those were counted (bulk mail when filtering). */
      matched: filterLocally ? counted : uids.length,
      analysed: page.length,
      truncated: uids.length > page.length,
      senders: list,
    };
  });
}

export type FullEmail = Summary & {
  cc?: string;
  replyTo?: string;
  text: string;
  truncated: boolean;
  attachments: { filename?: string; contentType: string; size: number }[];
};

export async function readEmail(
  account: Account,
  folder: string,
  uid: number,
  maxChars: number,
): Promise<FullEmail> {
  return withMailbox(account, folder, async (client) => {
    const msg = await client.fetchOne(
      String(uid),
      {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        source: { start: 0, maxLength: MAX_SOURCE_BYTES },
      },
      { uid: true },
    );
    if (!msg || !msg.source) throw new Error(`no message with uid ${uid} in ${folder}`);
    const parsed = await simpleParser(msg.source);
    const body = (parsed.text ?? "").trim();
    const one = (v: typeof parsed.cc) => (Array.isArray(v) ? v.map((x) => x.text).join(", ") : v?.text);
    return {
      ...summarize(msg),
      cc: one(parsed.cc),
      replyTo: parsed.replyTo?.text,
      text: body.slice(0, maxChars),
      truncated: body.length > maxChars || msg.source.length >= MAX_SOURCE_BYTES,
      attachments: parsed.attachments.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
      })),
      hasAttachments: parsed.attachments.length > 0,
    };
  });
}

export async function markEmails(
  account: Account,
  folder: string,
  uids: number[],
  change: { read?: boolean; flagged?: boolean },
) {
  return withMailbox(account, folder, async (client) => {
    const set = async (flag: string, on: boolean | undefined) => {
      if (on === undefined) return;
      if (on) await client.messageFlagsAdd(uids, [flag], { uid: true });
      else await client.messageFlagsRemove(uids, [flag], { uid: true });
    };
    await set("\\Seen", change.read);
    await set("\\Flagged", change.flagged);
    return { updated: uids.length };
  });
}

export async function moveEmails(
  account: Account,
  folder: string,
  uids: number[],
  destination: string,
) {
  return withMailbox(account, folder, async (client) => {
    let target = destination;
    const special: Record<string, [string, string[]]> = {
      trash: ["\\Trash", ["trash", "deleted", "deleted items", "bin"]],
      archive: ["\\Archive", ["archive", "[gmail]/all mail"]],
      spam: ["\\Junk", ["spam", "junk", "bulk", "bulk mail"]],
    };
    const key = destination.toLowerCase();
    if (special[key]) {
      // Gmail has no \Archive folder; "All Mail" plays that part.
      const [use, names] = special[key];
      const boxes = await client.list();
      const hit =
        boxes.find((b) => b.specialUse === use) ??
        (key === "archive" ? boxes.find((b) => b.specialUse === "\\All") : undefined) ??
        boxes.find((b) => names.includes(b.path.toLowerCase()));
      if (!hit) throw new Error(`this account has no ${key} folder; pass an exact folder path instead`);
      target = hit.path;
    }
    const res = await client.messageMove(uids, target, { uid: true });
    if (!res) throw new Error(`move to "${target}" failed`);
    return { moved: uids.length, destination: target };
  });
}

export type Outgoing = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body: string;
  /** When set, the message is threaded as a reply to this one. */
  replyTo?: { folder: string; uid: number };
};

async function compose(account: Account, out: Outgoing) {
  let subject = out.subject ?? "";
  let inReplyTo: string | undefined;
  let references: string[] | undefined;

  if (out.replyTo) {
    const { folder, uid } = out.replyTo;
    const original = await withMailbox(account, folder, (client) =>
      client.fetchOne(String(uid), { uid: true, envelope: true, headers: ["references"] }, { uid: true }),
    );
    if (!original) throw new Error(`no message with uid ${uid} in ${folder} to reply to`);
    inReplyTo = original.envelope?.messageId;
    const prior = (original.headers?.toString() ?? "")
      .replace(/^references:/i, "")
      .split(/\s+/)
      .filter((s) => s.startsWith("<"));
    references = [...prior, ...(inReplyTo ? [inReplyTo] : [])];
    if (!subject) {
      const s = original.envelope?.subject ?? "";
      subject = /^re:/i.test(s) ? s : `Re: ${s}`;
    }
  }

  return {
    from: account.name ? { name: account.name, address: account.email } : account.email,
    to: out.to,
    cc: out.cc,
    bcc: out.bcc,
    subject,
    text: out.body,
    inReplyTo,
    references,
  };
}

export async function createDraft(account: Account, out: Outgoing) {
  const mail = await compose(account, out);
  const raw = await new MailComposer({ ...mail, keepBcc: true } as never).compile().build();
  return withImap(account, async (client) => {
    const drafts = await findSpecialFolder(client, "\\Drafts", ["drafts", "draft", "[gmail]/drafts"]);
    const res = await client.append(drafts, raw, ["\\Draft", "\\Seen"]);
    if (!res) throw new Error("the server refused the draft");
    return { folder: drafts, uid: res.uid, subject: mail.subject };
  });
}

export async function sendEmail(account: Account, out: Outgoing) {
  const mail = await compose(account, out);
  const auth = account.oauth
    ? { type: "OAuth2" as const, user: account.email, accessToken: await getAccessToken(account) }
    : { user: account.email, pass: account.password! };
  const transport = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth,
  } as never);
  try {
    const info = await transport.sendMail(mail);
    return {
      messageId: info.messageId as string,
      accepted: info.accepted as string[],
      rejected: info.rejected as string[],
      subject: mail.subject,
    };
  } finally {
    transport.close();
  }
}
