// Vercel serverless function: /api/health
import { handleRequest } from "../lib/proxy.js";

export function GET(request) {
  return handleRequest(request);
}
