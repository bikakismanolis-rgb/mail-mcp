import type { IncomingMessage, ServerResponse } from "node:http";
import { handleMcp } from "../src/http.js";

export const config = { maxDuration: 120 };

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handleMcp(req, res);
}
