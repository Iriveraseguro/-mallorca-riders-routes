let type='Mixta',pos=null,current=null,map=null,userMarker=null,userAccuracy=null,routeLine=null,routeMarkers=[];
const $=x=>document.getElementById(x);

function initMap(){
  map=L.map('map',{zoomControl:true}).setView([39.62,2.95],10);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
}

function showPosition(p){
  pos=p.coords;
  const latlng=[p.coords.latitude,p.coords.longitude];
  if(userMarker) map.removeLayer(userMarker);
  if(userAccuracy) map.removeLayer(userAccuracy);
  const icon=L.divIcon({className:'',html:'<div class="user-dot"></div>',iconSize:[18,18],iconAnchor:[9,9]});
  userMarker=L.marker(latlng,{icon}).addTo(map).bindPopup('📍 Tu posición');
  userAccuracy=L.circle(latlng,{radius:p.coords.accuracy,color:'#1683ff',weight:1,fillOpacity:.08}).addTo(map);
  const detected=detectIsland(pos);
  if(detected){
    $('region').value=detected;
    updateRegionUI();
    $('locStatus').textContent=`✅ Ubicación obtenida · ${ISLANDS[detected].name}`;
  }else{
    map.setView(latlng,13);
    $('locStatus').textContent='✅ Ubicación obtenida';
    $('mapStatus').textContent='📍 Tu posición está marcada en el mapa.';
  }
}
function locate(){
  if(!navigator.geolocation){$('locStatus').textContent='❌ Geolocalización no disponible';return}
  $('locStatus').textContent='⏳ Buscando ubicación…';
  navigator.geolocation.getCurrentPosition(showPosition,()=>{$('locStatus').textContent='❌ No se pudo obtener la ubicación';$('mapStatus').textContent='Permite la ubicación en el navegador para situarte.'},{enableHighAccuracy:true,timeout:10000,maximumAge:30000});
}
$('loc').onclick=locate;
$('centerMap').onclick=()=>{if(pos)map.setView([pos.latitude,pos.longitude],14);else locate()};
document.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));b.classList.add('active');type=b.dataset.v});

const VALHALLA_URL='https://valhalla.openstreetmap.de/route';

function destinationPoint(lat,lon,distanceKm,bearingDeg){
  const R=6371, br=bearingDeg*Math.PI/180, d=distanceKm/R;
  const p1=lat*Math.PI/180, l1=lon*Math.PI/180;
  const p2=Math.asin(Math.sin(p1)*Math.cos(d)+Math.cos(p1)*Math.sin(d)*Math.cos(br));
  const l2=l1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(p1),Math.cos(d)-Math.sin(p1)*Math.sin(p2));
  return {lat:p2*180/Math.PI,lon:((l2*180/Math.PI+540)%360)-180};
}
function clearRoute(){if(routeLine){map.removeLayer(routeLine);routeLine=null}routeMarkers.forEach(m=>map.removeLayer(m));routeMarkers=[]}

const PENINSULA={
  barcelona:{name:'Barcelona',lat:41.3874,lon:2.1686,targets:{Mixta:[41.73,2.25],Curvas:[41.65,2.45],Costa:[41.96,3.20],Montaña:[42.15,2.52]}},
  valencia:{name:'Valencia',lat:39.4699,lon:-0.3763,targets:{Mixta:[39.72,-0.75],Curvas:[40.02,-0.67],Costa:[39.85,0.10],Montaña:[40.25,-0.80]}},
  alicante:{name:'Alicante',lat:38.3452,lon:-0.4810,targets:{Mixta:[38.70,-0.55],Curvas:[38.65,-0.75],Costa:[38.45,0.05],Montaña:[38.75,-0.95]}},
  malaga:{name:'Málaga',lat:36.7213,lon:-4.4214,targets:{Mixta:[36.95,-4.80],Curvas:[36.85,-4.95],Costa:[36.72,-3.70],Montaña:[37.15,-4.90]}},
  madrid:{name:'Madrid',lat:40.4168,lon:-3.7038,targets:{Mixta:[40.85,-3.65],Curvas:[40.72,-3.95],Costa:[39.95,-3.10],Montaña:[41.00,-3.75]}},
  bilbao:{name:'Bilbao',lat:43.2630,lon:-2.9350,targets:{Mixta:[43.10,-2.40],Curvas:[43.00,-2.75],Costa:[43.40,-2.55],Montaña:[42.95,-3.25]}},
  sevilla:{name:'Sevilla',lat:37.3891,lon:-5.9845,targets:{Mixta:[37.65,-5.60],Curvas:[37.80,-5.25],Costa:[37.20,-6.60],Montaña:[37.95,-5.50]}}
};

// Zonas terrestres: cada isla tiene una caja de seguridad y puntos reales de ruta.
// La caja no pretende definir la costa exacta; es una segunda barrera para impedir
// que el motor de rutas se vaya al continente o al mar mediante un ferry.
const ISLANDS={
  mallorca:{
    name:'Mallorca',center:{lat:39.6953,lon:3.0176},box:{minLat:39.30,maxLat:40.20,minLon:2.10,maxLon:3.60},
    starts:[{name:'Palma',lat:39.5696,lon:2.6502}],
    waypoints:{
      Montaña:[{name:'Valldemossa',lat:39.7105,lon:2.6223},{name:'Sóller',lat:39.7662,lon:2.7152},{name:'Escorca',lat:39.8214,lon:2.8471},{name:'Pollença',lat:39.8767,lon:3.0168}],
      Curvas:[{name:'Esporles',lat:39.6697,lon:2.5780},{name:'Puigpunyent',lat:39.6255,lon:2.5265},{name:'Estellencs',lat:39.6547,lon:2.4819},{name:'Banyalbufar',lat:39.6870,lon:2.5140},{name:'Valldemossa',lat:39.7105,lon:2.6223}],
      Costa:[{name:'Andratx',lat:39.5758,lon:2.4212},{name:'Port de Sóller',lat:39.7970,lon:2.6960},{name:'Artà',lat:39.6930,lon:3.3490},{name:'Capdepera',lat:39.7020,lon:3.4330}],
      Mixta:[{name:'Alaró',lat:39.7046,lon:2.7910},{name:'Inca',lat:39.7210,lon:2.9100},{name:'Pollença',lat:39.8767,lon:3.0168},{name:'Sóller',lat:39.7662,lon:2.7152}]
    }
  },
  menorca:{
    name:'Menorca',center:{lat:39.9857,lon:4.1100},box:{minLat:39.78,maxLat:40.15,minLon:3.75,maxLon:4.45},
    starts:[{name:'Mahón',lat:39.8885,lon:4.2658}],
    waypoints:{
      Montaña:[{name:'Es Mercadal',lat:39.9904,lon:4.0937},{name:'Monte Toro',lat:39.9869,lon:4.1104},{name:'Fornells',lat:40.0548,lon:4.1326},{name:'Ferreries',lat:40.0177,lon:4.0111}],
      Curvas:[{name:'Ferreries',lat:40.0177,lon:4.0111},{name:'Es Migjorn Gran',lat:39.9461,lon:4.0490},{name:'Es Mercadal',lat:39.9904,lon:4.0937},{name:'Fornells',lat:40.0548,lon:4.1326}],
      Costa:[{name:'Fornells',lat:40.0548,lon:4.1326},{name:'Ciutadella',lat:40.0019,lon:3.8414},{name:'Cala Galdana',lat:39.9400,lon:3.9530},{name:'Mahón',lat:39.8885,lon:4.2658}],
      Mixta:[{name:'Es Mercadal',lat:39.9904,lon:4.0937},{name:'Ciutadella',lat:40.0019,lon:3.8414},{name:'Fornells',lat:40.0548,lon:4.1326},{name:'Ferreries',lat:40.0177,lon:4.0111}]
    }
  },
  ibiza:{
    name:'Ibiza',center:{lat:39.0200,lon:1.4821},box:{minLat:38.85,maxLat:39.20,minLon:1.10,maxLon:1.60},
    starts:[{name:'Ibiza',lat:38.9067,lon:1.4206}],
    waypoints:{
      Montaña:[{name:'Sant Josep',lat:38.9214,lon:1.2945},{name:'Sant Rafel',lat:38.9590,lon:1.4010},{name:'Santa Eulària',lat:38.9849,lon:1.5347}],
      Curvas:[{name:'Sant Rafel',lat:38.9590,lon:1.4010},{name:'Santa Gertrudis',lat:39.0196,lon:1.4312},{name:'Sant Josep',lat:38.9214,lon:1.2945},{name:'Sant Joan',lat:39.0784,lon:1.5115}],
      Costa:[{name:'Sant Antoni',lat:38.9807,lon:1.3036},{name:'Cala d\'Hort',lat:38.8915,lon:1.2265},{name:'Santa Eulària',lat:38.9849,lon:1.5347},{name:'Sant Joan',lat:39.0784,lon:1.5115}],
      Mixta:[{name:'Sant Rafel',lat:38.9590,lon:1.4010},{name:'Santa Gertrudis',lat:39.0196,lon:1.4312},{name:'Santa Eulària',lat:38.9849,lon:1.5347},{name:'Sant Josep',lat:38.9214,lon:1.2945}]
    }
  },
  formentera:{
    name:'Formentera',center:{lat:38.7044,lon:1.4531},box:{minLat:38.63,maxLat:38.78,minLon:1.35,maxLon:1.57},
    starts:[{name:'Sant Francesc',lat:38.7068,lon:1.4281}],
    waypoints:{
      Montaña:[{name:'La Mola',lat:38.6650,lon:1.5050},{name:'Es Caló',lat:38.6746,lon:1.4921},{name:'Sant Ferran',lat:38.7008,lon:1.4575}],
      Curvas:[{name:'Sant Ferran',lat:38.7008,lon:1.4575},{name:'Es Caló',lat:38.6746,lon:1.4921},{name:'La Mola',lat:38.6650,lon:1.5050}],
      Costa:[{name:'Es Pujols',lat:38.7235,lon:1.4530},{name:'Migjorn',lat:38.6790,lon:1.4320},{name:'La Mola',lat:38.6650,lon:1.5050}],
      Mixta:[{name:'Sant Ferran',lat:38.7008,lon:1.4575},{name:'Es Pujols',lat:38.7235,lon:1.4530},{name:'La Mola',lat:38.6650,lon:1.5050},{name:'Sant Francesc',lat:38.7068,lon:1.4281}]
    }
  }
};

function pointInBox(lat,lon,box){return lat>=box.minLat&&lat<=box.maxLat&&lon>=box.minLon&&lon<=box.maxLon}
function detectIsland(coords){
  const lat=coords.latitude??coords.lat, lon=coords.longitude??coords.lon;
  for(const [key,island] of Object.entries(ISLANDS)) if(pointInBox(lat,lon,island.box)) return key;
  return null;
}
function routeShapeIsInRegion(coords,region){
  const island=ISLANDS[region];
  return !!island && coords.length>4 && coords.every(p=>pointInBox(p[0],p[1],island.box));
}

function getRequestedKm(){return parseInt(($('km').value.match(/\d+/)||['120'])[0],10)}

function islandWaypoints(region,start){
  const island=ISLANDS[region], pool=island.waypoints[type]||island.waypoints.Mixta, requested=getRequestedKm();
  const candidates=pool.map(p=>({...p,d:distanceKm(start,p)}));
  const targetRadius=Math.max(8,Math.min(requested*0.28,Math.max(12,requested/2)));
  candidates.sort((a,b)=>Math.abs(a.d-targetRadius)-Math.abs(b.d-targetRadius));
  const first=candidates[0];
  const second=candidates.filter(p=>p.name!==first.name).sort((a,b)=>Math.abs(a.d-targetRadius*1.35)-Math.abs(b.d-targetRadius*1.35))[0];
  return [first,second].filter(Boolean);
}

function distanceKm(a,b){
  const R=6371, dLat=(b.lat-a.lat)*Math.PI/180, dLon=(b.lon-a.lon)*Math.PI/180;
  const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

function getStartAndTarget(){
  const region=$('region').value;
  if(region==='peninsula'){
    const city=PENINSULA[$('peninsulaStart').value];
    return {start:{lat:city.lat,lon:city.lon},targets:[{name:city.name,lat:city.targets[type][0],lon:city.targets[type][1]}],label:city.name};
  }
  const island=ISLANDS[region];
  if(!island)return null;
  const detected=pos&&detectIsland(pos);
  const start=detected===region?{lat:pos.latitude,lon:pos.longitude}:island.starts[0];
  const label=detected===region?'tu ubicación':`${island.starts[0].name} (${island.name})`;
  return {start,targets:islandWaypoints(region,start),label};
}
function updateRegionUI(){
  const region=$('region').value;
  const pen=region==='peninsula';
  $('peninsulaStart').disabled=!pen;
  const island=ISLANDS[region];
  if(pen){
    $('mapStatus').textContent='🇪🇸 Ruta en Península: elige ciudad de salida y genera la ruta.';
    const c=PENINSULA[$('peninsulaStart').value];
    map.setView([c.lat,c.lon],8);
  }else if(island){
    const detected=pos&&detectIsland(pos);
    if(detected===region) map.setView([pos.latitude,pos.longitude],12);
    else map.setView([island.center.lat,island.center.lon],10);
    $('mapStatus').textContent=`${region==='mallorca'?'🏝️':'🏝️'} Ruta solo por ${island.name}.`;
  }
}
$('region').onchange=updateRegionUI;$('peninsulaStart').onchange=updateRegionUI;updateRegionUI();

function routePlan(){
  const region=$('region').value;
  const st=getStartAndTarget();if(!st)return null;
  return {start:st.start,targets:st.targets,requestedKm:getRequestedKm(),label:st.label,region};
}

function decodePolyline6(str){
  let index=0,lat=0,lon=0,out=[];
  while(index<str.length){let result=0,shift=0,b;do{b=str.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5}while(b>=32);const dlat=(result&1)?~(result>>1):(result>>1);lat+=dlat;result=0;shift=0;do{b=str.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5}while(b>=32);const dlon=(result&1)?~(result>>1):(result>>1);lon+=dlon;out.push([lat/1e6,lon/1e6])}return out;
}

async function requestRoute(locations,plan){
  // Pedimos a Valhalla una geometría GeoJSON directamente. Así evitamos
  // cualquier error de decodificación de polilíneas y dibujamos exactamente
  // la geometría que devuelve el motor de carreteras.
  const payload={
    locations,
    costing:'motorcycle',
    units:'kilometers',
    format:'json',
    shape_format:'geojson',
    directions_type:'none',
    costing_options:{
      motorcycle:{
        use_highways:$('motor').checked?0.05:1,
        use_ferry:0,
        exclude_ferries:true,
        use_tolls:0.3,
        use_tracks:0.15
      }
    }
  };
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),25000);
  let res;
  try{
    res=await fetch(VALHALLA_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
  }catch(e){
    if(e.name==='AbortError') throw new Error('TIMEOUT');
    throw new Error('NETWORK');
  }finally{clearTimeout(timer)}
  if(!res.ok){
    let detail='';
    try{detail=(await res.text()).slice(0,180)}catch(_){}
    throw new Error(`HTTP_${res.status}${detail?'_'+detail.replace(/\s+/g,' ').trim():''}`);
  }
  const data=await res.json();
  if(!data.routes?.length)throw new Error('SIN_RUTA');
  const route=data.routes[0];
  const coords=(route.geometry?.coordinates||[]).map(c=>[c[1],c[0]]);
  if(coords.length<2)throw new Error('Sin geometría');
  const summary={distance:Number(route.distance||0),duration:Number(route.duration||0)};
  // En formato OSRM la respuesta nos permite comprobar de forma inequívoca
  // si el motor ha usado un ferry. En Mallorca eso debe bloquearse.
  const hasFerry=route.legs?.some(leg=>leg.steps?.some(step=>String(step.name||'').toLowerCase().includes('ferry')||String(step.maneuver?.type||'').toLowerCase().includes('ferry')))||false;
  if(hasFerry)throw new Error('ROUTE_HAS_FERRY');
  if(ISLANDS[plan.region]&&!routeShapeIsInRegion(coords,plan.region))throw new Error('ROUTE_LEFT_ISLAND');
  return {data,coords,summary:{lengthKm:summary.distance/1000,timeSec:summary.duration}};
}
async function generateRoute(){
  const plan=routePlan();if(!plan)return;
  const btn=$('generate');btn.disabled=true;btn.textContent='CALCULANDO RUTA… 🏍️';$('mapStatus').textContent='🧭 Calculando una ruta real, solo por carreteras terrestres…';clearRoute();
  try{
    let locations=[{lat:plan.start.lat,lon:plan.start.lon,type:'break'}];
    plan.targets.forEach(p=>locations.push({lat:p.lat,lon:p.lon,type:'break'}));
    if($('circle').checked)locations.push({lat:plan.start.lat,lon:plan.start.lon,type:'break'});
    const result=await requestRoute(locations,plan);
    routeLine=L.polyline(result.coords,{weight:6,opacity:.9}).addTo(map);
    plan.targets.forEach(p=>routeMarkers.push(L.marker([p.lat,p.lon]).addTo(map).bindPopup('🏍️ Punto de ruta')));
    map.fitBounds(routeLine.getBounds(),{padding:[30,30]});
    const km=Math.round(result.summary.lengthKm),mins=Math.round(result.summary.timeSec/60);
    const duration=mins>=60?`${Math.floor(mins/60)} h ${mins%60} min`:`${mins} min`;
    current={id:Date.now(),name:type==='Curvas'?'Ruta de curvas':type==='Costa'?'Costa y curvas':type==='Montaña'?'Montaña y curvas':'Ruta mixta',km:`${km} km`,duration,curves:$('curves').value,stop:$('stop').value,circular:$('circle').checked,createdBy:'Motor de rutas',type,shape:result.coords,region:plan.region,start:plan.label};
    render(current);$('mapStatus').textContent=`🏍️ Ruta terrestre calculada: ${km} km · ${duration}`;
  }catch(e){
    console.error(e);
    const msg=e.message==='ROUTE_HAS_FERRY'?'⚠️ El motor devolvió un tramo en ferry y lo he bloqueado.':e.message==='ROUTE_LEFT_ISLAND'?`⚠️ El motor intentó sacar la ruta de ${ISLANDS[plan.region]?.name||'la zona seleccionada'}. He bloqueado ese recorrido.`:e.message==='TIMEOUT'?'⚠️ El servidor de rutas está tardando demasiado.':e.message==='NETWORK'?'⚠️ No hay conexión con el servidor de rutas.':e.message.startsWith('HTTP_')?'⚠️ El servidor de rutas ha rechazado la petición. Prueba de nuevo en unos segundos.':'⚠️ No se pudo calcular la ruta ahora. Pulsa «GENERAR RUTA» de nuevo.';
    $('mapStatus').textContent=msg;alert(msg);
  }finally{btn.disabled=false;btn.textContent='GENERAR RUTA 🏍️'}
}
$('generate').onclick=generateRoute;

function render(r){$('result').classList.remove('hidden');$('result').innerHTML=`<h2>🏍️ ${r.name}</h2><small>📍 ${r.region==='peninsula'?'Península':(ISLANDS[r.region]?.name||r.region)} · Creada por ${r.createdBy} · ${r.circular?'ruta circular':'ruta lineal'}</small><div class="stats"><div class="stat"><b>${r.km}</b><small>distancia real</small></div><div class="stat"><b>${r.duration}</b><small>tiempo estimado</small></div><div class="stat"><b>${'🔥'.repeat(r.curves)}</b><small>curvas</small></div></div><div class="stop">${r.stop==='none'?'Sin parada':r.stop}</div><div class="warning">🗺️ Ruta calculada sobre carreteras reales y validada para no salir de la zona seleccionada.</div><div class="actions"><button class="secondary" onclick="save()">💾 Guardar</button><button class="secondary" onclick="share()">📤 Compartir</button><button class="secondary" onclick="maps()">🗺️ Abrir mapas</button><button class="secondary" onclick="document.getElementById('generate').click()">🔄 Otra ruta</button></div>`;$('result').scrollIntoView({behavior:'smooth'})}
function get(){return JSON.parse(localStorage.getItem('mrr')||'[]')}
function save(){let a=get();a.unshift(current);localStorage.setItem('mrr',JSON.stringify(a.slice(0,50)));list()}
function list(){let a=get();$('count').textContent=a.length;if(!a.length){$('saved').innerHTML='Todavía no has guardado ninguna ruta.';return}$('saved').innerHTML=a.map((r,i)=>`<div class="saved"><div><b>🏍️ ${r.name}</b><br><small>${r.km} · ${r.duration} · ${r.type||type}</small></div><button onclick="repeat(${i})">Repetir</button></div>`).join('')}
function repeat(i){current=get()[i];render(current)}
async function share(){let t=`🏍️ ${current.name}\n${current.km} · ${current.duration}\nMallorca Riders Routes`;if(navigator.share)await navigator.share({title:current.name,text:t});else if(navigator.clipboard)await navigator.clipboard.writeText(t)}
function maps(){window.open(pos?`https://www.google.com/maps/dir/?api=1&origin=${pos.latitude},${pos.longitude}&destination=${pos.latitude},${pos.longitude}&travelmode=driving`:'https://www.google.com/maps','_blank')}
initMap();list();
