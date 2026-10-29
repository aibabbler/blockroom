// Checks the access code and sets the session cookie.
import { COOKIE, tokenFor, sameText } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.redirect(303, "/");
  const pass = process.env.BLOCKROOM_PASSCODE;
  let body = req.body;
  if (typeof body === "string") body = Object.fromEntries(new URLSearchParams(body));
  const code = String((body && body.code) || "").trim();
  await new Promise(r => setTimeout(r, 450)); // slow down guessing
  if (!pass || !code || !sameText(code, pass)) return res.redirect(303, "/?e=1");
  res.setHeader("Set-Cookie", `${COOKIE}=${tokenFor(pass)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
  res.setHeader("Cache-Control", "no-store");
  return res.redirect(303, "/");
}
