import { scanSite, generateFixPack } from "./_lib/scanner.js";

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="POST"){res.status(405).json({error:"Method not allowed."});return;}
  const {url}=req.body||{};
  if(!url){res.status(400).json({error:"url is required."});return;}
  try{
    const report=await scanSite(url);
    res.status(200).json({ok:true,fixPack:generateFixPack(report)});
  }catch(error){res.status(422).json({ok:false,error:error?.message||"Unable to generate fix pack."});}
}