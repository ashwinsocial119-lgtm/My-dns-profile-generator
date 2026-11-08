// Vercel serverless function: /api/fetch
import { handleRequest } from "../lib/proxy.js";

export function GET(request) {
  return handleRequest(request);
}
