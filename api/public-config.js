export default function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.status(200).json({
    supabaseUrl:process.env.SUPABASE_URL||"",
    supabaseAnonKey:process.env.SUPABASE_ANON_KEY||"",
    supabaseReady:Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_ANON_KEY),
    stripeReady:Boolean(process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_PRICE_STARTER),
    plans:{starter:"$19/mo",growth:"$49/mo",agency:"$249/mo"}
  });
}