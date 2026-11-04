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
      const prefix = "[out:json][timeout:20];(";
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
        const marker = "(around:1000,";
        const at = clause.lastIndexOf(marker);
        if (at < 0 || !clause.endsWith(")")) return false;
        const selector = clause.slice(0, at);
        const coordinates = clause.slice(at + marker.length, -1).split(",");
        if (!allowedSelectors.has(selector) || coordinates.length !== 2) return false;
        if (!coordinates.every(value => /^-?\d+\.\d{5}$/.test(value))) return false;
        const [lat, lon] = coordinates.map(Number);
        return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
      };
      const clauses = query.startsWith(prefix) && query.endsWith(suffix) ? query.slice(prefix.length,-suffix.length).split(";") : [];
      if (!query || query.length > 24000 || clauses.length < 1 || clauses.length > 160 || clauses.some(clause => !validClause(clause))) {
        return Response.json({error:"Consulta Overpass vacía, demasiado grande o no permitida."},{status:400,headers});
      }
      // Evita lanzar todos los mirrors a la vez: se prueban en grupos de dos.
      // Cada grupo tiene un límite corto y solo se pasa al siguiente si ambos fallan.
      const endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://lz4.overpass-api.de/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
        "https://ovp.dresel.systems/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
      ];
      const failures = [];
      const groups = [endpoints.slice(0,2), endpoints.slice(2,4), endpoints.slice(4,5)];
      for (const group of groups) {
        const controllers = [];
        const attempts = group.map(async endpoint => {
          const controller = new AbortController();
          controllers.push(controller);
          const timer = setTimeout(() => controller.abort(), 7000);
          try {
            const response = await fetch(endpoint, {
              method:"POST",
              headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8","Accept":"application/json","User-Agent":"MallorcaRidersRoutes/1.0 (+https://github.com/Iriveraseguro/-mallorca-riders-routes)"},
              body:"data="+encodeURIComponent(query),
              signal:controller.signal
            });
            const body = await response.text();
            if (!response.ok) throw new Error(endpoint+" respondió HTTP "+response.status+": "+body.slice(0,120));
            let parsed;
            try { parsed=JSON.parse(body); } catch { throw new Error(endpoint+" devolvió una respuesta no válida."); }
            if (!Array.isArray(parsed.elements)) throw new Error(endpoint+" no devolvió una lista de resultados.");
            return parsed;
          } finally {
            clearTimeout(timer);
          }
        });
        try {
          const parsed = await Promise.any(attempts);
          controllers.forEach(controller => controller.abort());
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