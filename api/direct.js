// Blockroom AI director route: forwards a scene-planning request to OpenRouter.
// Needs two environment variables in Vercel: OPENROUTER_API_KEY and BLOCKROOM_PASSCODE.
export const config = { maxDuration: 300 };

const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

export default async function handler(req, res) {
  const key = process.env.OPENROUTER_API_KEY;
  const pass = process.env.BLOCKROOM_PASSCODE;

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, hasKey: !!key, hasPasscode: !!pass });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!key) return res.status(500).json({ error: "OPENROUTER_API_KEY is not set in Vercel." });
  if (!pass) return res.status(500).json({ error: "BLOCKROOM_PASSCODE is not set in Vercel." });
  if ((req.headers["x-passcode"] || "") !== pass) return res.status(401).json({ error: "Wrong passcode. Check it in the Direct tab." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || !Array.isArray(body.messages) || !body.model) return res.status(400).json({ error: "Missing model or messages." });
  const model = String(body.model).slice(0, 120);
  const messages = body.messages.slice(0, 6).map(m => ({ role: m.role === "system" ? "system" : m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 120000) }));
  const schema = body.schema && typeof body.schema === "object" ? body.schema : null;

  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": `https://${req.headers.host || "blockroom.vercel.app"}`,
    "X-Title": "Blockroom",
  };
  const call = async (payload) => {
    const r = await fetch(OPENROUTER, { method: "POST", headers, body: JSON.stringify(payload) });
    const text = await r.text();
    let data = null; try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { ok: r.ok, status: r.status, data, text };
  };

  const base = { model, messages, max_tokens: 16000, temperature: 0.4, usage: { include: true } };
  let fallback = false;
  let out = schema
    ? await call({ ...base, response_format: { type: "json_schema", json_schema: { name: "scene_plan", strict: true, schema } }, provider: { require_parameters: true } })
    : await call({ ...base, response_format: { type: "json_object" } });

  // Some models or providers don't take strict schemas: retry in plain JSON mode with the schema in the prompt.
  if (schema && (!out.ok || !out.data?.choices?.[0]?.message?.content)) {
    fallback = true;
    const hint = { role: "system", content: "Return ONLY a single JSON object (no markdown fences) that matches this JSON schema exactly:\n" + JSON.stringify(schema) };
    out = await call({ ...base, messages: [...messages, hint], response_format: { type: "json_object" } });
    if (!out.ok) out = await call({ ...base, messages: [...messages, hint] });
  }

  if (!out.ok && out.status === 400 && /max_tokens|max tokens|maximum/i.test(out.text || "")) {
    const { max_tokens, ...rest } = base;
    out = await call({ ...rest, messages: fallback ? [...messages, { role: "system", content: "Return ONLY a single JSON object that matches this JSON schema exactly:\n" + JSON.stringify(schema) }] : messages, response_format: fallback || !schema ? { type: "json_object" } : { type: "json_schema", json_schema: { name: "scene_plan", strict: true, schema } } });
  }
  if (!out.ok) {
    const msg = out.data?.error?.message || out.text?.slice(0, 300) || `OpenRouter returned ${out.status}`;
    return res.status(out.status === 401 ? 502 : out.status || 502).json({ error: `OpenRouter: ${msg}` });
  }
  const content = out.data?.choices?.[0]?.message?.content;
  if (!content) return res.status(502).json({ error: "The model returned an empty answer. Try again or pick another model." });
  return res.status(200).json({ content, model: out.data.model, cost: out.data.usage?.cost ?? null, usage: out.data.usage || null, fallback });
}
