import { scanSite, generateFixPack } from "./_lib/scanner.js";

function bodyOf(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  const body = bodyOf(req);

  try {
    const report = body.report?.mode === "live" ? body.report : await scanSite(body.url);
    const pack = generateFixPack(report);

    res.status(200).json({ ok: true, ...pack });
  } catch (error) {
    res.status(422).json({
      ok: false,
      error: error?.message || "Unable to generate fix pack."
    });
  }
}
