export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const supabaseKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  const liveBilling =
    Boolean(process.env.STRIPE_PAYMENT_LINK_STARTER) &&
    Boolean(process.env.STRIPE_PAYMENT_LINK_GROWTH) &&
    Boolean(process.env.STRIPE_PAYMENT_LINK_AGENCY);

  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: supabaseKey,
    supabaseReady: Boolean(process.env.SUPABASE_URL && supabaseKey),
    stripeReady: true,
    stripeMode: liveBilling ? "live" : "test",
    plans: {
      starter: "$19/mo",
      growth: "$49/mo",
      agency: "$249/mo"
    }
  });
}
