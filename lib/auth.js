// Shared helpers for the Blockroom code gate.
import crypto from "node:crypto";

export const COOKIE = "br_auth";

// The session cookie holds a hash derived from the passcode, so changing the
// passcode in Vercel signs everyone out.
export function tokenFor(pass) {
  return crypto.createHash("sha256").update("blockroom-gate-v1:" + pass).digest("hex");
}

export function readCookie(header, name = COOKIE) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}

export function sameText(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

export function isAuthed(cookieHeader) {
  const pass = process.env.BLOCKROOM_PASSCODE;
  if (!pass) return false;
  const got = readCookie(cookieHeader);
  return !!got && sameText(got, tokenFor(pass));
}
