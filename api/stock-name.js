import { onRequestGet } from "../functions/stock-name.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  const request = new Request(new URL(req.url, "https://stock-name.local"));
  const response = await onRequestGet({ request });
  for (const [key, value] of response.headers) res.setHeader(key, value);
  return res.status(response.status).send(await response.text());
}
