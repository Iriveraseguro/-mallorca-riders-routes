const GOOGLE_HOSTS = new Set(["maps.app.goo.gl","goo.gl","www.google.com","google.com","maps.google.com"]);
const OVERPASS_ENDPOINTS = ["https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/route") {
      const headers = {
        "Access-Control-Allow-Origin": url.origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Vary": "Origin",
        "Cache-Control": "no-store"
      };
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (request.method !== "POST") return Response.json({ error: "Método no permitido." }, { status: 405, headers });
      const body = await request.text();
      if (!body || body.length > 100000) return Response.json({ error: "Petición de ruta no válida." }, { status: 400, headers });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      try {
        // Llamamos directamente al servicio público de Valhalla. La antigua
        // URL intermedia mallorca-riders-proxy-test ya no resuelve la ruta y
        // devolvía 404 al intentar calcular recorridos.
        const upstream = await fetch("https://valhalla1.openstreetmap.de/route", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body,
          signal: controller.signal
        });
        const responseBody = await upstream.text();
        if (!upstream.ok) {
          return Response.json({
            error: "El motor de rutas ha respondido con un error.",
            detail: "Valhalla HTTP " + upstream.status,
            upstream_status: upstream.status
          }, { status: 502, headers });
        }
        let payload;
        try { payload = JSON.parse(responseBody); }
        catch {
          return Response.json({ error: "El motor de rutas devolvió una respuesta no válida." }, { status: 502, headers });
        }
        return Response.json(payload, { headers });
      } catch (error) {
        const detail = error?.name === "AbortError"
          ? "El motor de rutas ha tardado demasiado."
          : String(error?.message || error);
        return Response.json({ error: "No se pudo conectar con el motor de rutas.", detail }, { status: 502, headers });
      } finally {
        clearTimeout(timer);
      }
    }
    if (url.pathname === "/overpass") {
      const headers = {"Access-Control-Allow-Origin": url.origin,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Accept","Vary":"Origin","Cache-Control":"no-store"};
      if (request.method === "OPTIONS") return new Response(null,{status:204,headers});
      if (request.method !== "POST") return Response.json({error:"Método no permitido."},{status:405,headers});
      const query = await request.text();
      if (!query || query.length > 30000 || !/^\s*\[out:json\]/i.test(query) || !/\bout\s+center\s+tags\s*;/i.test(query)) return Response.json({error:"Consulta de mapa no válida."},{status:400,headers});
      let lastError="Los servicios de OpenStreetMap no responden.";
      for (const endpoint of OVERPASS_ENDPOINTS) {
        const startedAt=Date.now();
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
        try {
          console.info("[overpass] intentando", endpoint);
          const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8","Accept":"application/json","User-Agent":"MallorcaRidersRoutes/1.0"},body:new URLSearchParams({data:query}).toString(),signal:controller.signal});
          const body=await response.text();
          console.info("[overpass] respuesta", endpoint, "status", response.status, "ms", Date.now()-startedAt, "bytes", body.length);
          if(!response.ok){lastError="OpenStreetMap respondió HTTP "+response.status+".";console.warn("[overpass] endpoint rechazado",endpoint,response.status);continue}
          let payload;try{payload=JSON.parse(body)}catch{lastError="Respuesta no válida de OpenStreetMap.";console.warn("[overpass] JSON inválido",endpoint);continue}
          if(!Array.isArray(payload.elements)){lastError="La respuesta de OpenStreetMap no contiene establecimientos.";console.warn("[overpass] falta elements",endpoint);continue}
          console.info("[overpass] éxito",endpoint,"establecimientos",payload.elements.length);
          return Response.json(payload,{headers});
        } catch(error) {
          lastError=error?.name==="AbortError"?"La búsqueda de OpenStreetMap ha tardado demasiado.":"No se pudo conectar con OpenStreetMap.";
          console.warn("[overpass] fallo",endpoint,"ms",Date.now()-startedAt,"tipo",error?.name,"detalle",String(error?.message||error));
        } finally {clearTimeout(timer)}
      }
      console.error("[overpass] fallaron todos los endpoints",lastError);
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
