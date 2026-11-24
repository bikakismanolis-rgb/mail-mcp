import { z } from "zod";

export type Provider = "gmail" | "yahoo" | "outlook" | "icloud" | "aol" | "custom";

/** Known providers. "custom" needs explicit imap/smtp hosts. */
const PRESETS = {
  gmail: {
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
  },
  yahoo: {
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
  },
  // Hotmail / Outlook.com / Live. Microsoft no longer accepts passwords here, only OAuth2.
  outlook: {
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp-mail.outlook.com", port: 587, secure: false },
  },
  icloud: {
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
  },
  aol: {
    imap: { host: "imap.aol.com", port: 993, secure: true },
    smtp: { host: "smtp.aol.com", port: 465, secure: true },
  },
} as const;

/** Guesses the provider from the address so people only type email + password. */
export function detectProvider(email: string): Exclude<Provider, "custom"> | undefined {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const name = domain.split(".")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
  if (name === "yahoo" || domain === "ymail.com" || domain === "rocketmail.com") return "yahoo";
  if (["hotmail", "outlook", "live", "msn", "windowslive"].includes(name)) return "outlook";
  if (["icloud.com", "me.com", "mac.com"].includes(domain)) return "icloud";
  if (domain === "aol.com") return "aol";
  return undefined;
}

const endpointSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  secure: z.boolean().optional(),
});

const accountSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9_-]+$/i, "id may only contain letters, digits, - and _"),
    provider: z.enum(["gmail", "yahoo", "outlook", "icloud", "aol", "custom"]),
    email: z.string().email(),
    name: z.string().optional(),
    /** App password (Gmail, Yahoo, most IMAP providers). */
    password: z.string().optional(),
    /** OAuth2 refresh-token login (needed for Outlook/Hotmail). */
    oauth: z
      .object({
        clientId: z.string().min(1),
        clientSecret: z.string().optional(),
        refreshToken: z.string().min(1),
        tokenUrl: z.string().url().optional(),
        scope: z.string().optional(),
      })
      .optional(),
    imap: endpointSchema.optional(),
    smtp: endpointSchema.optional(),
  })
  .refine((a) => Boolean(a.password) !== Boolean(a.oauth), {
    message: "set exactly one of `password` or `oauth`",
  })
  .refine((a) => a.provider !== "custom" || (a.imap && a.smtp), {
    message: "provider `custom` needs both `imap` and `smtp`",
  });

type RawAccount = z.infer<typeof accountSchema>;

export type Endpoint = { host: string; port: number; secure: boolean };

export type Account = {
  id: string;
  provider: Provider;
  email: string;
  name?: string;
  password?: string;
  oauth?: {
    clientId: string;
    clientSecret?: string;
    refreshToken: string;
    tokenUrl: string;
    scope: string;
  };
  imap: Endpoint;
  smtp: Endpoint;
};

export type Config = {
  accounts: Account[];
  /** Shared secret that must be present in the URL or Authorization header. */
  authToken: string;
  /** When false, send_email is not offered at all; drafts only. */
  allowSend: boolean;
  /** Azure app (public client) used to sign Outlook/Hotmail mailboxes in. */
  outlookClientId?: string;
};

export const OUTLOOK_AUTH_BASE = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
export const OUTLOOK_SCOPE =
  "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access";

function withDefaults(e: z.infer<typeof endpointSchema>): Endpoint {
  return { host: e.host, port: e.port, secure: e.secure ?? (e.port === 993 || e.port === 465) };
}

function finish(a: RawAccount): Account {
  const preset = a.provider === "custom" ? undefined : PRESETS[a.provider];
  return {
    id: a.id.toLowerCase(),
    provider: a.provider,
    email: a.email,
    name: a.name,
    password: a.password,
    oauth: a.oauth && {
      clientId: a.oauth.clientId,
      clientSecret: a.oauth.clientSecret,
      refreshToken: a.oauth.refreshToken,
      tokenUrl: a.oauth.tokenUrl ?? `${OUTLOOK_AUTH_BASE}/token`,
      scope: a.oauth.scope ?? OUTLOOK_SCOPE,
    },
    imap: withDefaults(a.imap ?? preset!.imap),
    smtp: withDefaults(a.smtp ?? preset!.smtp),
  };
}

/** Full JSON form: MAIL_ACCOUNTS=[{...},{...}]. Needed for custom IMAP hosts. */
export function parseAccounts(raw: string): Account[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("MAIL_ACCOUNTS is not valid JSON");
  }
  const parsed = z.array(accountSchema).safeParse(json);
  if (!parsed.success) {
    // Zod issues carry paths and messages only, never the secret values.
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`MAIL_ACCOUNTS is invalid: ${msg}`);
  }
  return parsed.data.map(finish);
}

/**
 * Simple form, one variable per mailbox:
 *
 *   MAIL_ACCOUNT_1=you@gmail.com abcd efgh ijkl mnop
 *   MAIL_ACCOUNT_WORK=you@yahoo.com apppassword
 *   MAIL_ACCOUNT_HOTMAIL=you@hotmail.com token:<refresh token from the setup page>
 *
 * The provider comes from the address. Spaces inside the password are dropped,
 * so Google's "abcd efgh ijkl mnop" can be pasted as shown.
 */
export function parseSimpleAccount(
  name: string,
  value: string,
  outlookClientId?: string,
): Account {
  const suffix = name.replace(/^MAIL_ACCOUNT_/, "").toLowerCase();
  const [email, ...rest] = value.trim().split(/\s+/);
  const secret = rest.join("");
  if (!email?.includes("@") || !secret) {
    throw new Error(`${name} must look like: you@example.com your-app-password`);
  }
  const provider = detectProvider(email);
  if (!provider) {
    throw new Error(
      `${name}: unknown mail provider for that address; describe it in MAIL_ACCOUNTS (JSON) with imap/smtp hosts instead`,
    );
  }
  const id = /^\d+$/.test(suffix) ? `${provider}${suffix}` : suffix.replace(/[^a-z0-9_-]/g, "-");
  const raw: RawAccount = { id, provider, email };
  if (secret.startsWith("token:")) {
    if (!outlookClientId) throw new Error(`${name} uses a token but OUTLOOK_CLIENT_ID is not set`);
    raw.oauth = { clientId: outlookClientId, refreshToken: secret.slice("token:".length) };
  } else if (provider === "outlook") {
    throw new Error(
      `${name}: Microsoft no longer accepts passwords for Outlook/Hotmail; connect it from the setup page instead`,
    );
  } else {
    raw.password = secret;
  }
  const checked = accountSchema.safeParse(raw);
  if (!checked.success) throw new Error(`${name} is invalid: ${checked.error.issues[0]?.message}`);
  return finish(checked.data);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const authToken = env.MCP_AUTH_TOKEN ?? "";
  if (authToken.length < 24) {
    throw new Error("MCP_AUTH_TOKEN must be set to a random string of at least 24 characters");
  }
  const outlookClientId = env.OUTLOOK_CLIENT_ID?.trim() || undefined;

  const accounts: Account[] = env.MAIL_ACCOUNTS?.trim() ? parseAccounts(env.MAIL_ACCOUNTS) : [];
  for (const name of Object.keys(env).sort()) {
    if (!/^MAIL_ACCOUNT_[A-Za-z0-9_]+$/.test(name) || !env[name]?.trim()) continue;
    accounts.push(parseSimpleAccount(name, env[name]!, outlookClientId));
  }

  const seen = new Set<string>();
  for (const a of accounts) {
    if (seen.has(a.id)) throw new Error(`two mail accounts share the id "${a.id}"`);
    seen.add(a.id);
  }

  return { accounts, authToken, allowSend: env.MAIL_ALLOW_SEND === "true", outlookClientId };
}
