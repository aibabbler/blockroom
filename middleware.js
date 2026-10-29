// Code gate: nothing in Blockroom loads until the visitor has entered the access code.
import { next } from "@vercel/functions";
import { isAuthed } from "./lib/auth.js";
import { gatePage } from "./lib/gate.js";

export const config = {
  runtime: "nodejs",
  // everything except the unlock endpoint
  matcher: ["/((?!api/unlock).*)"],
};

export default function middleware(request) {
  if (isAuthed(request.headers.get("cookie"))) return next();
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Locked. Enter your code on the Blockroom page first." }), { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  const html = gatePage({ error: url.searchParams.get("e") === "1", setup: !process.env.BLOCKROOM_PASSCODE });
  return new Response(html, { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
