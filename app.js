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
  map.setView(latlng,13);
  $('locStatus').textContent='✅ Ubicación obtenida';
  $('mapStatus').textContent='📍 Tu posición está marcada en el mapa.';
}

function locate(){
  if(!navigator.geolocation){$('locStatus').textContent='❌ Geolocalización no disponible';return}
  $('locStatus').textContent='⏳ Buscando ubicación…';
  navigator.geolocation.getCurrentPosition(showPosition,()=>{$('locStatus').textContent='❌ No se pudo obtener la ubicación';$('mapStatus').textContent='Permite la ubicación en el navegador para situarte.'},{enableHighAccuracy:true,timeout:10000,maximumAge:30000});
}

$('loc').onclick=locate;
$('centerMap').onclick=()=>{if(pos)map.setView([pos.latitude,pos.longitude],14);else locate()};
document.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));b.classList.add('active');type=b.dataset.v});

const VALHALLA_URL='https://valhalla1.openstreetmap.de/route';

function destinationPoint(lat,lon,distanceKm,bearingDeg){
  const R=6371, br=bearingDeg*Math.PI/180, d=distanceKm/R;
  const p1=lat*Math.PI/180, l1=lon*Math.PI/180;
  const p2=Math.asin(Math.sin(p1)*Math.cos(d)+Math.cos(p1)*Math.sin(d)*Math.cos(br));
  const l2=l1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(p1),Math.cos(d)-Math.sin(p1)*Math.sin(p2));
  return {lat:p2*180/Math.PI,lon:((l2*180/Math.PI+540)%360)-180};
}

function decodePolyline6(str){
  let index=0,lat=0,lon=0,out=[];
  while(index<str.length){
    let result=0,shift=0,b;
    do{b=str.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5}while(b>=32);
    const dlat=(result&1)?~(result>>1):(result>>1);lat+=dlat;
    result=0;shift=0;
    do{b=str.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5}while(b>=32);
    const dlon=(result&1)?~(result>>1):(result>>1);lon+=dlon;
    out.push([lat/1e6,lon/1e6]);
  }
  return out;
}

function clearRoute(){
  if(routeLine){map.removeLayer(routeLine);routeLine=null}
  routeMarkers.forEach(m=>map.removeLayer(m));routeMarkers=[];
}

function routePlan(){
  if(!pos){locate();return null}
  const requestedKm=parseInt(($('km').value.match(/\d+/)||['120'])[0],10);
  const outward=Math.max(18,Math.min(110,requestedKm*(($('circle').checked)?0.34:0.75)));
  const bearings={Mixta:35,Curvas:300,Costa:115,Montaña:270};
  const b=bearings[type]||35;
  const wp=destinationPoint(pos.latitude,pos.longitude,outward,b);
  return {wp,requestedKm};
}

async function generateRoute(){
  const plan=routePlan();
  if(!plan)return;
  const btn=$('generate');btn.disabled=true;btn.textContent='CALCULANDO RUTA… 🏍️';
  $('mapStatus').textContent='🧭 Calculando una ruta real por carretera…';
  clearRoute();
  const locations=[{lat:pos.latitude,lon:pos.longitude,type:'break'},{lat:plan.wp.lat,lon:plan.wp.lon,type:'break'}];
  if($('circle').checked)locations.push({lat:pos.latitude,lon:pos.longitude,type:'break'});
  const payload={locations,costing:'auto',units:'kilometers',directions_options:{units:'kilometers'}};
  if($('motor').checked){payload.costing_options={auto:{use_highways:false}}}
  try{
    const res=await fetch(VALHALLA_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Client-Id':'mallorca-riders-routes'},body:JSON.stringify(payload)});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const data=await res.json();
    if(!data.trip||!data.trip.legs?.length)throw new Error('Sin ruta');
    const coords=[];
    data.trip.legs.forEach(leg=>coords.push(...decodePolyline6(leg.shape)));
    if(!coords.length)throw new Error('Sin geometría');
    routeLine=L.polyline(coords,{weight:6,opacity:.9}).addTo(map);
    routeMarkers.push(L.marker([plan.wp.lat,plan.wp.lon]).addTo(map).bindPopup('🏍️ Punto de giro'));
    map.fitBounds(routeLine.getBounds(),{padding:[30,30]});
    const km=Math.round(data.trip.summary.length);
    const mins=Math.round(data.trip.summary.time/60);
    const duration=mins>=60?`${Math.floor(mins/60)} h ${mins%60} min`:`${mins} min`;
    current={id:Date.now(),name:type==='Curvas'?'Ruta de curvas':type==='Costa'?'Costa y curvas':type==='Montaña'?'Montaña y curvas':'Ruta mixta',km:`${km} km`,duration,curves:$('curves').value,stop:$('stop').value,circular:$('circle').checked,createdBy:'Motor de rutas',type,shape:coords};
    render(current);
    $('mapStatus').textContent=`🏍️ Ruta real calculada: ${km} km · ${duration}`;
  }catch(e){
    console.error(e);
    $('mapStatus').textContent='⚠️ No se pudo calcular la ruta ahora. Pulsa «GENERAR RUTA» de nuevo.';
    alert('No he podido conectar con el motor de rutas. Vamos a reintentarlo; si sigue fallando, cambiaremos de servidor.');
  }finally{btn.disabled=false;btn.textContent='GENERAR RUTA 🏍️'}
}

$('generate').onclick=generateRoute;

function render(r){
  $('result').classList.remove('hidden');
  $('result').innerHTML=`<h2>🏍️ ${r.name}</h2><small>Creada por ${r.createdBy} · ${r.circular?'ruta circular':'ruta lineal'}</small><div class="stats"><div class="stat"><b>${r.km}</b><small>distancia real</small></div><div class="stat"><b>${r.duration}</b><small>tiempo estimado</small></div><div class="stat"><b>${'🔥'.repeat(r.curves)}</b><small>curvas</small></div></div><div class="stop">${r.stop==='none'?'Sin parada':r.stop}</div><div class="warning">🗺️ Ruta calculada sobre carreteras reales. El mapa muestra ahora el recorrido obtenido del motor de rutas.</div><div class="actions"><button class="secondary" onclick="save()">💾 Guardar</button><button class="secondary" onclick="share()">📤 Compartir</button><button class="secondary" onclick="maps()">🗺️ Abrir mapas</button><button class="secondary" onclick="document.getElementById('generate').click()">🔄 Otra ruta</button></div>`;
  $('result').scrollIntoView({behavior:'smooth'});
}
function get(){return JSON.parse(localStorage.getItem('mrr')||'[]')}
function save(){let a=get();a.unshift(current);localStorage.setItem('mrr',JSON.stringify(a.slice(0,50)));list()}
function list(){let a=get();$('count').textContent=a.length;if(!a.length){$('saved').innerHTML='Todavía no has guardado ninguna ruta.';return}$('saved').innerHTML=a.map((r,i)=>`<div class="saved"><div><b>🏍️ ${r.name}</b><br><small>${r.km} · ${r.duration} · ${r.type||type}</small></div><button onclick="repeat(${i})">Repetir</button></div>`).join('')}
function repeat(i){current=get()[i];render(current)}
async function share(){let t=`🏍️ ${current.name}\n${current.km} · ${current.duration}\nMallorca Riders Routes`;if(navigator.share)await navigator.share({title:current.name,text:t});else if(navigator.clipboard)await navigator.clipboard.writeText(t)}
function maps(){window.open(pos?`https://www.google.com/maps/dir/?api=1&origin=${pos.latitude},${pos.longitude}&destination=${pos.latitude},${pos.longitude}&travelmode=driving`:'https://www.google.com/maps','_blank')}
initMap();list();
