// Signs out of Blockroom on this device.
import { COOKIE } from "../lib/auth.js";

export default function handler(req, res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  res.setHeader("Cache-Control", "no-store");
  return res.redirect(303, "/");
}
