const GOOGLE_HOSTS = new Set(["maps.app.goo.gl","goo.gl","www.google.com","google.com","maps.google.com"]);
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/route") {
      const headers = {
        "Access-Control-Allow-Origin": url.origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Cache-Control": "no-store",
        "Vary": "Origin"
      };
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return Response.json({error:"Origen no permitido."},{status:403,headers});
      if (request.method === "OPTIONS") return new Response(null,{status:204,headers});
      if (request.method !== "POST") return Response.json({error:"Método no permitido."},{status:405,headers});
      try {
        const body = await request.text();
        if (!body || body.length > 100000) return Response.json({error:"Solicitud de ruta no válida."},{status:400,headers});
        const upstream = await fetch("https://valhalla1.openstreetmap.de/route", {
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "Accept":"application/json",
            "X-Client-Id":"mallorca-riders-routes"
          },
          body,
          signal:AbortSignal.timeout(22000)
        });
        return new Response(upstream.body, {
          status:upstream.status,
          headers:{...headers,"Content-Type":upstream.headers.get("Content-Type")||"application/json"}
        });
      } catch (error) {
        return Response.json({error:"No se pudo conectar con el motor de rutas.",detail:String(error?.message||error).slice(0,250)},{status:502,headers});
      }
    }
    if (url.pathname === "/api/overpass") {
      const headers = {"Cache-Control":"no-store"};
      if (request.method !== "POST") return Response.json({error:"Método no permitido."},{status:405,headers});
      const contentType = request.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("text/plain")) return Response.json({error:"La consulta debe enviarse como texto."},{status:415,headers});
      let query = "";
      try { query = await request.text(); } catch { return Response.json({error:"No se pudo leer la consulta."},{status:400,headers}); }
      const prefix = "[out:json][timeout:15];(";
      const suffix = ");out center tags;";
      const allowedSelectors = new Set([
        'node["amenity"~"^(restaurant|fast_food|cafe|bar|pub|fuel)$"]',
        'way["amenity"~"^(restaurant|fast_food|cafe|bar|pub|fuel)$"]',
        'node["amenity"~"^(restaurant|fast_food)$"]',
        'way["amenity"~"^(restaurant|fast_food)$"]',
        'node["amenity"~"^(cafe|bar|pub)$"]',
        'way["amenity"~"^(cafe|bar|pub)$"]',
        'node["amenity"="fuel"]',
        'way["amenity"="fuel"]',
        'node["tourism"="viewpoint"]',
        'way["tourism"="viewpoint"]'
      ]);
      const validClause = clause => {
        const marker = "(around:750,";
        const at = clause.lastIndexOf(marker);
        if (at < 0 || !clause.endsWith(")")) return false;
        const selector = clause.slice(0, at);
        const coordinates = clause.slice(at + marker.length, -1).split(",");
        if (!allowedSelectors.has(selector) || coordinates.length !== 2) return false;
        if (!coordinates.every(value => /^-?\d+\.\d{5}$/.test(value))) return false;
        const [lat, lon] = coordinates.map(Number);
        return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
      };
      const clauses = query.startsWith(prefix) && query.endsWith(suffix) ? query.slice(prefix.length,-suffix.length).split(";").filter(Boolean) : [];
      if (!query || query.length > 24000 || clauses.length < 1 || clauses.length > 160 || clauses.some(clause => !validClause(clause))) {
        return Response.json({error:"Consulta Overpass vacía, demasiado grande o no permitida."},{status:400,headers});
      }
      // Prioriza Overpass.ch con la clave privada del Worker. La clave nunca llega al navegador.
      // Si el servicio gratuito está ocupado, se prueban mirrors públicos como respaldo.
      const primary = env.OVERPASS_API_KEY
        ? ["https://api.overpass.ch/v1/interpreter"]
        : [];
      const fallbackGroups = [
        ["https://overpass.private.coffee/api/interpreter","https://overpass-api.de/api/interpreter"],
        ["https://lz4.overpass-api.de/api/interpreter","https://ovp.dresel.systems/api/interpreter"]
      ];
      const failures = [];
      const cleanErrorBody = (body) => String(body || "")
        .replace(/<!DOCTYPE[\s\S]*?>/gi, " ")
        .replace(/<\?xml[^>]*\?>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0,700);
      const requestEndpoint = async (endpoint, timeoutMs, apiKey = "") => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(endpoint, {
            method:"POST",
            headers:{
              "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8",
              "Accept":"application/json",
              "User-Agent":"MallorcaRidersRoutes/1.0 (+https://github.com/Iriveraseguro/-mallorca-riders-routes)",
              ...(apiKey ? {"X-API-Key":apiKey} : {})
            },
            body:new URLSearchParams({data:query}).toString(),
            signal:controller.signal
          });
          const body = await response.text();
          if (!response.ok) {
            const cleanBody = cleanErrorBody(body);
            const detail = apiKey ? cleanBody.replaceAll(apiKey, "[clave oculta]") : cleanBody;
            const error = new Error(endpoint.replace("/api/interpreter","")+" respondió HTTP "+response.status+(detail?": "+detail:""));
            error.status = response.status;
            throw error;
          }
          let parsed;
          try { parsed=JSON.parse(body); } catch {
            const error = new Error(endpoint.replace("/api/interpreter","")+" devolvió una respuesta no válida.");
            error.status = 502;
            throw error;
          }
          if (!Array.isArray(parsed.elements)) {
            const error = new Error(endpoint.replace("/api/interpreter","")+" no devolvió una lista de resultados.");
            error.status = 502;
            throw error;
          }
          return parsed;
        } finally {
          clearTimeout(timer);
        }
      };
      // La clave se envía en X-API-Key: nunca aparece en la URL ni en los mensajes de error.
      if (primary.length) {
        try {
          const parsed = await requestEndpoint(primary[0],16000,env.OVERPASS_API_KEY);
          return Response.json(parsed,{headers});
        } catch (error) {
          const message = String(error?.message||error);
          if (error?.status === 400) {
            return Response.json({error:"Overpass ha rechazado la consulta de establecimientos.",detail:message},{status:400,headers});
          }
          if (error?.status === 401 || error?.status === 403) {
            return Response.json({error:"Overpass.ch no ha aceptado la clave API configurada.",detail:message},{status:error.status,headers});
          }
          failures.push(message);
        }
      }
      for (const group of fallbackGroups) {
        const attempts = group.map(endpoint => requestEndpoint(endpoint,6000));
        try {
          const parsed = await Promise.any(attempts);
          return Response.json(parsed,{headers});
        } catch (error) {
          (error?.errors||[error]).forEach(e => failures.push(String(e?.message||e)));
        }
      }
      return Response.json({error:"No se pudo consultar ningún servidor de establecimientos.",detail:failures.join(" | ").slice(0,500)},{status:502,headers});
    }
    if (url.pathname === "/api/resolve-google") {
      const headers = {"Access-Control-Allow-Origin": url.origin,"Access-Control-Allow-Methods":"GET, OPTIONS","Access-Control-Allow-Headers":"Accept","Vary":"Origin"};
      if (request.method === "OPTIONS") return new Response(null,{status:204,headers});
      if (request.method !== "GET") return Response.json({error:"Método no permitido."},{status:405,headers});
      const raw=url.searchParams.get("url");
      if(!raw||raw.length>2048)return Response.json({error:"Falta un enlace válido."},{status:400,headers});
      let target;
      try{target=new URL(raw)}catch{return Response.json({error:"El enlace no es válido."},{status:400,headers})}
      if(target.protocol!=="https:"||!GOOGLE_HOSTS.has(target.hostname.toLowerCase()))return Response.json({error:"Solo se admiten enlaces HTTPS de Google Maps."},{status:400,headers});
      try{
        const response=await fetch(target.href,{redirect:"follow",headers:{"User-Agent":"Mozilla/5.0 (compatible; MallorcaRidersRoutes/1.0)","Accept":"text/html"}});
        const finalUrl=response.url;
        await response.body?.cancel();
        const final=new URL(finalUrl);
        if(final.protocol!=="https:"||!/(^|\.)google\.[a-z.]+$/i.test(final.hostname))return Response.json({error:"La redirección no termina en Google Maps."},{status:502,headers});
        return Response.json({url:final.href},{headers:{...headers,"Cache-Control":"no-store"}});
      }catch{return Response.json({error:"No se pudo resolver el enlace corto. Inténtalo con el enlace completo de indicaciones."},{status:502,headers})}
    }
    return env.ASSETS.fetch(request);
  }
};