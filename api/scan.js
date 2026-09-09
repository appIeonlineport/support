import { scanSite } from "./_lib/scanner.js";

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="GET"){res.status(405).json({error:"Method not allowed."});return;}
  const raw=Array.isArray(req.query?.url)?req.query.url[0]:req.query?.url;
  if(!raw){res.status(400).json({error:"Missing ?url= parameter."});return;}
  try{res.status(200).json(await scanSite(raw));}
  catch(error){res.status(422).json({ok:false,error:error?.message||"Unable to scan that website."});}
}