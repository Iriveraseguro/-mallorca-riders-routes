const GOOGLE_HOSTS = new Set(["maps.app.goo.gl","goo.gl","www.google.com","google.com","maps.google.com"]);
const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/overpass") {
      const headers = {"Access-Control-Allow-Origin": url.origin,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Accept","Vary":"Origin","Cache-Control":"no-store"};
      if (request.method === "OPTIONS") return new Response(null,{status:204,headers});
      if (request.method !== "POST") return Response.json({error:"Método no permitido."},{status:405,headers});
      const query = await request.text();
      if (!query || query.length > 30000 || !/^\s*\[out:json\]/i.test(query) || !/\bout\s+center\s+tags\s*;/i.test(query)) return Response.json({error:"Consulta de mapa no válida."},{status:400,headers});
      let lastError="Los servicios de OpenStreetMap no responden.";
      for (const endpoint of OVERPASS_ENDPOINTS) {
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),11000);
        try {
          const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8","Accept":"application/json","User-Agent":"MallorcaRidersRoutes/1.0"},body:new URLSearchParams({data:query}).toString(),signal:controller.signal});
          const body=await response.text();
          if(!response.ok){lastError="OpenStreetMap respondió HTTP "+response.status+".";continue}
          let payload;try{payload=JSON.parse(body)}catch{lastError="Respuesta no válida de OpenStreetMap.";continue}
          if(!Array.isArray(payload.elements)){lastError="La respuesta de OpenStreetMap no contiene establecimientos.";continue}
          return Response.json(payload,{headers});
        } catch(error) {
          lastError=error?.name==="AbortError"?"La búsqueda de OpenStreetMap ha tardado demasiado.":"No se pudo conectar con OpenStreetMap.";
        } finally {clearTimeout(timer)}
      }
      return Response.json({error:lastError},{status:502,headers});
    }
    if (url.pathname === "/api/resolve-google") {
      const headers = {"Access-Control-Allow-Origin": url.origin,"Access-Control-Allow-Methods":"GET, OPTIONS","Access-Control-Allow-Headers":"Accept","Vary":"Origin"};
      if (request.method === "OPTIONS") return new Response(null,{status:204,headers});
      if (request.method !== "GET") return Response.json({error:"Método no permitido."},{status:405,headers});
      const raw=url.searchParams.get("url");
      if(!raw||raw.length>2048)return Response.json({error:"Falta un enlace válido."},{status:400,headers});
      let target;try{target=new URL(raw)}catch{return Response.json({error:"El enlace no es válido."},{status:400,headers})}
      if(target.protocol!=="https:"||!GOOGLE_HOSTS.has(target.hostname.toLowerCase()))return Response.json({error:"Solo se admiten enlaces HTTPS de Google Maps."},{status:400,headers});
      try{
        const response=await fetch(target.href,{redirect:"follow",headers:{"User-Agent":"Mozilla/5.0 (compatible; MallorcaRidersRoutes/1.0)","Accept":"text/html"}});
        const finalUrl=response.url;await response.body?.cancel();const final=new URL(finalUrl);
        if(final.protocol!=="https:"||!/(^|\.)google\.[a-z.]+$/i.test(final.hostname))return Response.json({error:"La redirección no termina en Google Maps."},{status:502,headers});
        return Response.json({url:final.href},{headers:{...headers,"Cache-Control":"no-store"}});
      }catch{return Response.json({error:"No se pudo resolver el enlace corto. Inténtalo con el enlace completo de indicaciones."},{status:502,headers})}
    }
    return env.ASSETS.fetch(request);
  }
};
