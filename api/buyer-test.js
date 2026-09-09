import { scanSite, runBuyerTest } from "./_lib/scanner.js";

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="POST"){res.status(405).json({error:"Method not allowed."});return;}
  const {url,query}=req.body||{};
  if(!url||!query){res.status(400).json({error:"url and query are required."});return;}
  try{
    const report=await scanSite(url);
    res.status(200).json({ok:true,report:{domain:report.domain,score:report.score,platform:report.platform,products:report.detected.products},test:runBuyerTest(report,query)});
  }catch(error){res.status(422).json({ok:false,error:error?.message||"Unable to run buyer test."});}
}