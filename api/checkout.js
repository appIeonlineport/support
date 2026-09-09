const TEST_LINKS = {
  starter: "https://buy.stripe.com/test_8x29AM9Odh1heXN4rT8so00",
  growth: "https://buy.stripe.com/test_6oU9AM2lLbGX2b1cYp8so01",
  agency: "https://buy.stripe.com/test_4gM28k7G5h1h7vl2jL8so02"
};

const ENV_LINKS = {
  starter: "STRIPE_PAYMENT_LINK_STARTER",
  growth: "STRIPE_PAYMENT_LINK_GROWTH",
  agency: "STRIPE_PAYMENT_LINK_AGENCY"
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  const plan = String(req.body?.plan || "").toLowerCase();
  if (!TEST_LINKS[plan]) {
    res.status(400).json({ ok: false, error: "Unknown plan." });
    return;
  }

  const liveLink = process.env[ENV_LINKS[plan]];
  const url = liveLink || TEST_LINKS[plan];

  res.status(200).json({
    ok: true,
    plan,
    url,
    billingMode: liveLink ? "live" : "test",
    note: liveLink
      ? "Live Stripe Payment Link."
      : "Stripe test-mode Payment Link. No real charge will be made."
  });
}
