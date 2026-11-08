// Cloudflare Pages Function: handles every /api/* route.
import { handleRequest } from "../../lib/proxy.js";

export const onRequest = (context) => handleRequest(context.request);
