const GOOGLE_HOSTS = new Set(["maps.app.goo.gl","goo.gl","www.google.com","google.com","maps.google.com"]);
const DGT_RESOURCE_ID = "1d36ea74-593d-4e45-acfa-fb8db5a460bc";
const DGT_DOWNLOAD_URLS = [
  "https://nap.dgt.es/dataset/77be854a-6911-47dc-ba4c-b13067a50552/resource/1d36ea74-593d-4e45-acfa-fb8db5a460bc/download/datex2_v37.xml",
  "https://nap.dgt.es/es/dataset/incidencias-dgt-datex2-v3-7/resource/1d36ea74-593d-4e45-acfa-fb8db5a460bc/download/datex2_v37.xml",
  "https://nap.dgt.es/dataset/incidencias-dgt-datex2-v3-7/resource/1d36ea74-593d-4e45-acfa-fb8db5a460bc/download/datex2_v37.xml"
];
let cachedDgtFeed = null;
let cachedDgtFeedAt = 0;
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
    if (url.pathname === "/api/health") {
      const headers = {
        "Access-Control-Allow-Origin": url.origin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Accept",
        "Cache-Control": "no-store",
        "Vary": "Origin"
      };
      if (request.method === "OPTIONS") return new Response(null,{status:204,headers});
      if (request.method !== "GET") return Response.json({error:"Método no permitido."},{status:405,headers});
      return Response.json({
        status:"ok",
        workerHost:url.hostname,
        build:"mrr-roadworks-2026-11-06-v3",
        features:["dgt-roadworks","adaptive-decision-distance","voice-or-buttons","verified-valhalla-reroute"],
        trafficEndpoint:"/api/traffic/incidents",
        dgtResourceId:DGT_RESOURCE_ID
      },{headers});
    }
    if (url.pathname === "/api/traffic/incidents") {
      const headers = {
        "Access-Control-Allow-Origin": url.origin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Accept",
        "Cache-Control": "no-store",
        "Vary": "Origin"
      };
      if (request.method === "OPTIONS") return new Response(null,{status:204,headers});
      if (request.method !== "GET") return Response.json({error:"Método no permitido."},{status:405,headers});
      if (cachedDgtFeed && Date.now() - cachedDgtFeedAt < 45000) {
        return new Response(cachedDgtFeed,{status:200,headers:{...headers,"Content-Type":"application/xml; charset=utf-8","X-Traffic-Source":"DGT-NAP","X-Traffic-Cache":"HIT"}});
      }
      const sources = [];
      try {
        const metadataResponse = await fetch("https://nap.dgt.es/api/3/action/resource_show?id="+DGT_RESOURCE_ID,{
          headers:{"Accept":"application/json","User-Agent":"MallorcaRidersRoutes/1.0"}
        });
        if (metadataResponse.ok) {
          const metadata = await metadataResponse.json();
          const candidate = metadata?.result?.url;
          if (metadata?.success && candidate) {
            const parsed = new URL(candidate);
            if (parsed.protocol === "https:" && parsed.hostname === "nap.dgt.es") sources.push(parsed.href);
          }
        }
      } catch (error) {
        console.warn("No se pudo resolver el recurso DATEX II del NAP:",String(error?.message||error));
      }
      sources.push(...DGT_DOWNLOAD_URLS);
      const failures = [];
      for (const source of [...new Set(sources)]) {
        const controller = new AbortController();
        const timer = setTimeout(()=>controller.abort(),18000);
        try {
          const upstream = await fetch(source,{
            headers:{
              "Accept":"application/xml, text/xml;q=0.9, */*;q=0.5",
              "User-Agent":"MallorcaRidersRoutes/1.0 (+https://github.com/Iriveraseguro/-mallorca-riders-routes)"
            },
            redirect:"follow",
            signal:controller.signal
          });
          if (!upstream.ok) throw new Error("NAP respondió HTTP "+upstream.status);
          const xml = await upstream.text();
          const contentType = upstream.headers.get("Content-Type") || "desconocido";
          const trimmedXml = String(xml || "").replace(/^\uFEFF/,"").trimStart();
          const finalUrl = new URL(upstream.url);
          const finalPath = finalUrl.pathname;
          const isOfficialIncidentFeed = finalUrl.hostname === "nap.dgt.es" && /SituationPublication/i.test(finalPath);
          const xmlLooksValid = /^<\?xml\b/i.test(trimmedXml)
            && !/<html[\s>]/i.test(trimmedXml)
            && /<[^!?][^>]*>/i.test(trimmedXml);
          if (!xml || xml.length > 6000000 || !contentType.toLowerCase().includes("xml") || !xmlLooksValid || !isOfficialIncidentFeed) {
            const preview = String(xml || "").slice(0,900).replace(/\s+/g," ").trim();
            throw new Error("DATEX II no válido (tipo="+contentType+", ruta="+finalPath+", inicio="+preview+").");
          }
          cachedDgtFeed = xml;
          cachedDgtFeedAt = Date.now();
          return new Response(xml,{status:200,headers:{...headers,"Content-Type":"application/xml; charset=utf-8","X-Traffic-Source":"DGT-NAP","X-Traffic-Cache":"MISS"}});
        } catch (error) {
          failures.push(String(error?.message||error).slice(0,180));
        } finally {
          clearTimeout(timer);
        }
      }
      return Response.json({
        error:"No se ha podido consultar el feed oficial de incidencias de la DGT.",
        detail:failures.join(" | ").slice(0,500),
        source:"DGT NAP DATEX II v3.7"
      },{status:502,headers});
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
        'nw["amenity"~"^(restaurant|fast_food|cafe|bar|pub|fuel)$"]',
        'nw["amenity"~"^(restaurant|fast_food)$"]',
        'nw["amenity"~"^(cafe|bar|pub)$"]',
        'nw["amenity"="fuel"]',
        'node["highway"="speed_camera"]',
        'nw["tourism"="viewpoint"]'
      ]);
      const validClause = rawClause => {
        const clause = String(rawClause || "").trim();
        const marker = "(around:";
        const at = clause.lastIndexOf(marker);
        if (at < 0 || !clause.endsWith(")")) return false;
        const selector = clause.slice(0, at).trim();
        const parts = clause.slice(at + marker.length, -1).split(",").map(value => value.trim());
        if (!allowedSelectors.has(selector) || parts.length < 3 || parts.length > 129 || parts.length % 2 !== 1) return false;
        const radius = Number(parts[0]);
        if (!Number.isInteger(radius) || radius < 500 || radius > 1800) return false;
        const coordinates = parts.slice(1);
        if (coordinates.some(value => value === "" || !Number.isFinite(Number(value)))) return false;
        for (let i=0;i<coordinates.length;i+=2) {
          const lat=Number(coordinates[i]), lon=Number(coordinates[i+1]);
          if (!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) return false;
        }
        return true;
      };
      const hasPrefix = query.startsWith(prefix);
      const hasSuffix = query.endsWith(suffix);
      const inner = hasPrefix && hasSuffix ? query.slice(prefix.length,-suffix.length) : "";
      const clauses = inner.split(";").map(clause => clause.trim()).filter(Boolean);
      const invalidClause = clauses.find(clause => !validClause(clause));
      let validationError = "";
      if (!query) validationError = "consulta vacía";
      else if (query.length > 24000) validationError = "consulta superior a 24.000 caracteres";
      else if (!hasPrefix) validationError = "cabecera Overpass inesperada";
      else if (!hasSuffix) validationError = "cierre Overpass inesperado";
      else if (clauses.length < 1) validationError = "no se encontraron elementos dentro de la unión";
      else if (clauses.length > 160) validationError = "demasiados elementos en la unión: "+clauses.length;
      else if (invalidClause) validationError = "elemento de consulta no permitido: "+invalidClause.slice(0,180);
      if (validationError) {
        return Response.json({error:"El Worker ha rechazado la consulta de establecimientos.",detail:validationError},{status:400,headers});
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
          const parsed = await requestEndpoint(primary[0],22000,env.OVERPASS_API_KEY);
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