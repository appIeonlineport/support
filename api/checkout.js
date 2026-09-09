const PRICE_ENV={starter:"STRIPE_PRICE_STARTER",growth:"STRIPE_PRICE_GROWTH",agency:"STRIPE_PRICE_AGENCY"};

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="POST"){res.status(405).json({error:"Method not allowed."});return;}
  const secret=process.env.STRIPE_SECRET_KEY;
  if(!secret){res.status(503).json({error:"Billing is not activated yet."});return;}
  const plan=String(req.body?.plan||"starter").toLowerCase();
  if(!PRICE_ENV[plan]){res.status(400).json({error:"Unknown plan."});return;}
  const price=process.env[PRICE_ENV[plan]];
  if(!price){res.status(503).json({error:"This plan is not activated yet."});return;}
  const origin=(req.headers["x-forwarded-proto"]||"https")+"://"+req.headers.host;
  const params=new URLSearchParams();
  params.set("mode","subscription");
  params.set("line_items[0][price]",price);
  params.set("line_items[0][quantity]","1");
  params.set("success_url",origin+"/dashboard.html?billing=success");
  params.set("cancel_url",origin+"/dashboard.html?billing=cancelled");
  params.set("allow_promotion_codes","true");
  const email=req.body?.email;
  if(email)params.set("customer_email",String(email));
  const response=await fetch("https://api.stripe.com/v1/checkout/sessions",{
    method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/x-www-form-urlencoded"},
    body:params
  });
  const data=await response.json();
  if(!response.ok){res.status(502).json({error:data?.error?.message||"Stripe checkout failed."});return;}
  res.status(200).json({ok:true,url:data.url,id:data.id});
}