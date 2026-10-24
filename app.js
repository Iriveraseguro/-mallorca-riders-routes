let type='Mixta',pos=null,current=null,map=null,userMarker=null,userAccuracy=null,routeLine=null,routeMarkers=[],manualWaypoints=[],manualMarkers=[],manualMode=false,manualRouteActive=false;
const $=x=>document.getElementById(x);

function initMap(){
  if(map) return map;
  const el=$('map');
  if(!el){ console.error('Mapa: no existe #map'); return null; }
  if(typeof L==='undefined'){ console.error('Mapa: Leaflet no ha cargado'); return null; }
  try{
    map=L.map(el,{zoomControl:true,preferCanvas:true}).setView([39.62,2.95],10);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
    map.on('click',e=>{if(manualMode)addManualWaypoint(e.latlng);});
    setTimeout(()=>map&&map.invalidateSize(),50);
    return map;
  }catch(err){
    console.error('Mapa: error al inicializar',err);
    map=null;
    return null;
  }
}

function showPosition(p){
  pos=p.coords;
  const latlng=[p.coords.latitude,p.coords.longitude];
  if(!initMap()) { $('locStatus').textContent='❌ El mapa todavía no está listo'; return; }
  if(userMarker) map.removeLayer(userMarker);
  if(userAccuracy) map.removeLayer(userAccuracy);
  const icon=L.divIcon({className:'',html:'<div class="user-dot"></div>',iconSize:[18,18],iconAnchor:[9,9]});
  userMarker=L.marker(latlng,{icon}).addTo(map).bindPopup('📍 Tu posición');
  userAccuracy=L.circle(latlng,{radius:p.coords.accuracy,color:'#1683ff',weight:1,fillOpacity:.08}).addTo(map);
  map.setView(latlng,13);
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
function locationErrorMessage(error){
  if(!error) return 'No se recibió una respuesta del GPS.';
  if(error.code===1) return 'Permiso de ubicación denegado. Abre esta app desde el icono, revisa los permisos de ubicación de iOS y vuelve a intentarlo.';
  if(error.code===2) return 'El iPhone no consigue determinar la posición. Activa Localización y prueba en un lugar con mejor señal.';
  if(error.code===3) return 'La búsqueda de ubicación ha tardado demasiado. Pulsa «Mi ubicación» otra vez y espera unos segundos.';
  return error.message || 'No se pudo determinar la ubicación.';
}
function locate(){
  if(!navigator.geolocation){
    $('locStatus').textContent='❌ Este modo de apertura no ofrece geolocalización.';
    $('mapStatus').textContent='Abre la app desde una dirección HTTPS en el navegador y comprueba los permisos de ubicación.';
    return;
  }
  $('locStatus').textContent='⏳ Buscando tu ubicación…';
  $('mapStatus').textContent='El iPhone puede tardar unos segundos en obtener el GPS.';
  const failed=(error,secondTry=false)=>{
    if(!secondTry && error && error.code!==1){
      $('locStatus').textContent='⏳ El GPS tarda; probando otra forma de localizarte…';
      navigator.geolocation.getCurrentPosition(showPosition,finalError,{
        enableHighAccuracy:false,timeout:20000,maximumAge:120000
      });
      return;
    }
    finalError(error);
  };
  const finalError=(error)=>{
    const message=locationErrorMessage(error);
    $('locStatus').textContent='❌ '+message;
    $('mapStatus').textContent='No se ha cambiado el punto de partida. Puedes volver a pulsar «Usar mi ubicación».';
    console.warn('Geolocalización fallida:',{code:error?.code,message:error?.message});
  };
  navigator.geolocation.getCurrentPosition(showPosition,(error)=>failed(error,false),{
    enableHighAccuracy:true,timeout:15000,maximumAge:60000
  });
}
$('loc').onclick=locate;
$('centerMap').onclick=()=>{if(!initMap()) return; if(pos)map.setView([pos.latitude,pos.longitude],14);else locate()};
document.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));b.classList.add('active');type=b.dataset.v});

const APP_VERSION='v5.3';
const VALHALLA_URL='/api/route';
const VALHALLA_HEADERS={'Content-Type':'application/json'};

function destinationPoint(lat,lon,distanceKm,bearingDeg){
  const R=6371, br=bearingDeg*Math.PI/180, d=distanceKm/R;
  const p1=lat*Math.PI/180, l1=lon*Math.PI/180;
  const p2=Math.asin(Math.sin(p1)*Math.cos(d)+Math.cos(p1)*Math.sin(d)*Math.cos(br));
  const l2=l1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(p1),Math.cos(d)-Math.sin(p1)*Math.sin(p2));
  return {lat:p2*180/Math.PI,lon:((l2*180/Math.PI+540)%360)-180};
}
function clearRoute(){if(!map) return; if(routeLine){map.removeLayer(routeLine);routeLine=null}routeMarkers.forEach(m=>map.removeLayer(m));routeMarkers=[]}

// Añade flechas en el sentido real del recorrido. Se usan coordenadas consecutivas
// de la geometría, por lo que funcionan igual en rutas generadas, importadas y compartidas.
function addDirectionalArrows(coords){
  if(!map||!Array.isArray(coords)||coords.length<3)return;
  let total=0,segments=[];
  for(let i=1;i<coords.length;i++){
    const a=coords[i-1],b=coords[i];
    const length=distanceKm({lat:a[0],lon:a[1]},{lat:b[0],lon:b[1]});
    if(!Number.isFinite(length)||length<=0)continue;
    segments.push({a,b,length,start:total,end:total+length});
    total+=length;
  }
  if(!segments.length||total<1)return;
  const spacing=total<18?Math.max(5,total/3):Math.max(7,Math.min(14,total/8));
  for(let target=spacing/2;target<total-spacing/4;target+=spacing){
    const seg=segments.find(s=>target>=s.start&&target<=s.end);
    if(!seg)continue;
    const fraction=(target-seg.start)/seg.length;
    const lat=seg.a[0]+(seg.b[0]-seg.a[0])*fraction;
    const lon=seg.a[1]+(seg.b[1]-seg.a[1])*fraction;
    const pa=map.latLngToLayerPoint([seg.a[0],seg.a[1]]);
    const pb=map.latLngToLayerPoint([seg.b[0],seg.b[1]]);
    const angle=Math.atan2(pb.y-pa.y,pb.x-pa.x)*180/Math.PI;
    const icon=L.divIcon({
      className:'route-direction-icon',
      html:'<span class="route-direction-arrow" style="transform:rotate('+angle.toFixed(1)+'deg)">➤</span>',
      iconSize:[24,24],
      iconAnchor:[12,12]
    });
    const marker=L.marker([lat,lon],{icon,interactive:false,keyboard:false,zIndexOffset:500}).addTo(map);
    routeMarkers.push(marker);
  }
}
function refreshManualPointLabels(){
  manualWaypoints.forEach((point,index)=>{
    point.name='Punto '+(index+1);
    const marker=manualMarkers.find(m=>m._manualPointId===point.id);
    if(marker){
      marker.setIcon(L.divIcon({className:'manual-point-icon',html:'<div class="manual-point">'+(index+1)+'</div>',iconSize:[30,30],iconAnchor:[15,15]}));
      const popupHtml='<b>Punto '+(index+1)+'</b><br>Punto de paso de tu ruta<br><button type="button" class="delete-manual-point" onclick="window.removeManualWaypoint('+point.id+')">🗑️ Borrar solo este punto</button>';
      if(marker.getPopup()) marker.setPopupContent(popupHtml);
      else marker.bindPopup(popupHtml);
    }
  });
}
window.removeManualWaypoint = function(id){
  const index=manualWaypoints.findIndex(p=>p.id===id);
  if(index<0)return;
  manualWaypoints.splice(index,1);
  const markerIndex=manualMarkers.findIndex(m=>m._manualPointId===id);
  if(markerIndex>=0){if(map)map.removeLayer(manualMarkers[markerIndex]);manualMarkers.splice(markerIndex,1)}
  refreshManualPointLabels();
  manualRouteActive=false;
  $('mapStatus').textContent='🗑️ Punto eliminado. Quedan '+manualWaypoints.length+'. Puedes añadir otro o terminar los puntos.';
};
function addManualWaypoint(latlng){
  const region=$('region').value,island=ISLANDS[region];
  if(island&&!pointInBox(latlng.lat,latlng.lng,island.box)){$('mapStatus').textContent='⚠️ Coloca los puntos dentro de la isla seleccionada.';return}
  const id=Date.now()+Math.floor(Math.random()*1000);
  manualWaypoints.push({id,name:'Punto '+manualWaypoints.length,lat:latlng.lat,lon:latlng.lng});
  const marker=L.marker([latlng.lat,latlng.lng],{draggable:true}).addTo(map);
  marker._manualPointId=id;
  marker.on('dragend',()=>{const p=marker.getLatLng(),point=manualWaypoints.find(w=>w.id===id);if(point){point.lat=p.lat;point.lon=p.lng;manualRouteActive=false}});
  manualMarkers.push(marker);refreshManualPointLabels();marker.openPopup();manualRouteActive=false;
  $('mapStatus').textContent='📍 '+manualWaypoints.length+' punto(s) colocados. Toca un punto para borrarlo individualmente. Añade al menos 2 y pulsa «Terminar puntos».';
}
function startManualRoute(){manualMode=true;manualRouteActive=false;$('manualMode').classList.add('active');$('mapStatus').textContent='👆 Toca el mapa para colocar los puntos en el orden del recorrido.'}
function finishManualRoute(){manualMode=false;$('manualMode').classList.remove('active');if(manualWaypoints.length<2){$('mapStatus').textContent='⚠️ Necesitas al menos 2 puntos.';return}manualRouteActive=true;$('mapStatus').textContent='✅ Ruta manual lista. Pulsa «Generar ruta».'}
function clearManualRoute(){manualMode=false;manualRouteActive=false;manualWaypoints=[];manualMarkers.forEach(m=>map&&map.removeLayer(m));manualMarkers=[];$('manualMode').classList.remove('active');$('mapStatus').textContent='🧹 Todos los puntos borrados.'}

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

function getRequestedKm(){return parseInt(($('km').value.match(/\d+/)||['120'])[0],10)}

function islandWaypoints(region,start){
  const island=ISLANDS[region], pool=island.waypoints[type]||island.waypoints.Mixta, requested=getRequestedKm();
  const candidates=pool.map(p=>{
    const d=distanceKm(start,p);
    const y=Math.sin((p.lon-start.lon)*Math.PI/180)*Math.cos(p.lat*Math.PI/180);
    const x=Math.cos(start.lat*Math.PI/180)*Math.sin(p.lat*Math.PI/180)-Math.sin(start.lat*Math.PI/180)*Math.cos(p.lat*Math.PI/180)*Math.cos((p.lon-start.lon)*Math.PI/180);
    return {...p,d,bearing:(Math.atan2(y,x)*180/Math.PI+360)%360};
  }).filter(p=>p.d>5);
  if(candidates.length<3){
    return candidates.sort((a,b)=>a.d-b.d).slice(0,2);
  }
  // Una ruta circular necesita puntos repartidos alrededor del origen,
  // no simplemente los dos lugares que estén a una distancia parecida.
  const targetRadius=Math.max(10,Math.min(requested*0.20,35));
  const combos=[];
  for(let i=0;i<candidates.length;i++){
    for(let j=i+1;j<candidates.length;j++){
      for(let k=j+1;k<candidates.length;k++){
        const trio=[candidates[i],candidates[j],candidates[k]].sort((a,b)=>a.bearing-b.bearing);
        const bearings=trio.map(p=>p.bearing).sort((a,b)=>a-b);
        const gaps=[bearings[1]-bearings[0],bearings[2]-bearings[1],360-bearings[2]+bearings[0]];
        const radialError=trio.reduce((sum,p)=>sum+Math.abs(p.d-targetRadius),0)/3;
        const spreadPenalty=gaps.reduce((sum,g)=>sum+Math.abs(g-120),0)/120;
        const separationPenalty=trio.reduce((sum,p,idx)=>sum+(idx?Math.max(0,8-distanceKm(p,trio[idx-1])):0),0);
        combos.push({trio,score:radialError+spreadPenalty*8+separationPenalty});
      }
    }
  }
  combos.sort((a,b)=>a.score-b.score);
  return combos[0]?.trio||candidates.sort((a,b)=>Math.abs(a.d-targetRadius)-Math.abs(b.d-targetRadius)).slice(0,3);
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
  if(!map) initMap();
  if(!map) return;
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
async function refreshApplication(){
  const button=$('refreshApp');
  if(button){button.disabled=true;button.textContent='⏳ Comprobando…'}
  try{
    if('serviceWorker' in navigator){
      const registration=await navigator.serviceWorker.getRegistration();
      if(registration){
        await registration.update();
        const worker=registration.installing||registration.waiting;
        if(worker&&worker.state!=='activated'){
          await new Promise(resolve=>{
            const timeout=setTimeout(resolve,8000);
            worker.addEventListener('statechange',()=>{
              if(worker.state==='activated'||worker.state==='redundant'){clearTimeout(timeout);resolve()}
            });
          });
        }
      }
    }
  }catch(error){console.warn('No se pudo comprobar la actualización',error)}
  window.location.reload();
}
function initApp(){
  // Conectar la importación antes de inicializar el mapa, para que el botón
  // no quede inactivo si falla la carga de Leaflet.
  $('importRouteButton').onclick=()=>{
    const panel=$('importRoutePanel');
    if(!panel){$('mapStatus').textContent='No se encontró el panel de importación.';return;}
    panel.classList.toggle('hidden');
    if(!panel.classList.contains('hidden')){
      panel.scrollIntoView({behavior:'smooth',block:'center'});
      $('googleMapsLink')?.focus({preventScroll:true});
    }
  };
  $('chooseRouteFileButton').onclick=()=>$('importRouteFile').click();
  $('importRouteFile').onchange=e=>importRouteFile(e.target.files?.[0]);
  $('importScreenshotButton').onclick=()=>$('routeScreenshotFile').click();
  $('routeScreenshotFile').onchange=e=>showRouteScreenshot(e.target.files?.[0]);
  $('closeScreenshot').onclick=closeRouteScreenshot;
  $('screenshotImportAlternatives').onclick=()=>{
    const panel=$('importRoutePanel');
    if(panel){panel.classList.remove('hidden');panel.scrollIntoView({behavior:'smooth',block:'center'});$('googleMapsLink')?.focus({preventScroll:true});}
    $('mapStatus').textContent='🆓 Importación sin costes: pega un enlace de indicaciones de Google Maps o selecciona un archivo GPX/KML/GeoJSON. La captura por sí sola no aporta coordenadas GPS.';
  };
  $('traceScreenshotButton').onclick=()=>{startManualRoute();$('mapStatus').textContent='👆 Modo manual: toca en el mapa los puntos del recorrido en orden. Esta opción no es automática.';$('map').scrollIntoView({behavior:'smooth',block:'center'})};
  $('loadMapsLinkButton').onclick=loadGoogleMapsLink;

  if(!initMap()){
    $('mapStatus').textContent='⚠️ El mapa no se ha podido inicializar. La importación se muestra, pero para dibujar la ruta hay que recargar la app.';
    return;
  }
  $('manualMode').onclick=()=>manualMode?finishManualRoute():startManualRoute();
  $('finishManual').onclick=finishManualRoute;
  $('clearManual').onclick=clearManualRoute;$('shareRoute').onclick=share;
  $('refreshApp').onclick=refreshApplication;
  $('region').onchange=()=>{clearManualRoute();updateRegionUI()};
  $('peninsulaStart').onchange=updateRegionUI;
  updateRegionUI();
}
window.addEventListener('load',initApp,{once:true});

function routePlan(){
  const region=$('region').value;
  // En modo manual, los puntos dibujados por el usuario son el origen y
  // los destinos; no dependemos de que exista una salida automática elegida.
  let st;
  if(manualRouteActive){
    if(manualWaypoints.length<2){$('mapStatus').textContent='⚠️ Coloca al menos 2 puntos y pulsa «Terminar puntos».';return null;}
    st={start:{lat:manualWaypoints[0].lat,lon:manualWaypoints[0].lon},targets:manualWaypoints.slice(1).map((p,i)=>({...p,name:'Punto '+(i+2)})),label:'ruta con puntos manuales'};
  }else{
    st=getStartAndTarget();
    if(!st)return null;
  }
  const durationHours=parseFloat($('duration').value||'3')||3;
  return {start:st.start,targets:st.targets,requestedKm:getRequestedKm(),requestedMinutes:durationHours*60,curves:Number($('curves').value)||3,type,label:st.label,region,manual:manualRouteActive};
}
function buildRouteCandidates(plan){
  const candidates=[];
  const add=(targets,variant)=>{
    if(!targets?.length)return;
    const signature=targets.map(p=>p.name||`${p.lat.toFixed(3)},${p.lon.toFixed(3)}`).join('|');
    if(candidates.some(c=>c.signature===signature))return;
    candidates.push({...plan,targets,signature,variant});
  };
  add(plan.targets,'base');
  const island=ISLANDS[plan.region];
  if(island&&!plan.manual){
    const pool=(island.waypoints[plan.type]||island.waypoints.Mixta).filter(p=>distanceKm(plan.start,p)>5);
    const targetRadius=Math.max(10,Math.min(plan.requestedKm*0.20,35));
    const bearingOf=p=>{
      const y=Math.sin((p.lon-plan.start.lon)*Math.PI/180)*Math.cos(p.lat*Math.PI/180);
      const x=Math.cos(plan.start.lat*Math.PI/180)*Math.sin(p.lat*Math.PI/180)-Math.sin(plan.start.lat*Math.PI/180)*Math.cos(p.lat*Math.PI/180)*Math.cos((p.lon-plan.start.lon)*Math.PI/180);
      return (Math.atan2(y,x)*180/Math.PI+360)%360;
    };
    const combos=[];
    for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++)for(let k=j+1;k<pool.length;k++){
      const trio=[pool[i],pool[j],pool[k]].sort((a,b)=>bearingOf(a)-bearingOf(b));
      const bearings=trio.map(bearingOf).sort((a,b)=>a-b);
      const gaps=[bearings[1]-bearings[0],bearings[2]-bearings[1],360-bearings[2]+bearings[0]];
      const radialError=trio.reduce((sum,p)=>sum+Math.abs(distanceKm(plan.start,p)-targetRadius),0)/3;
      const spreadPenalty=gaps.reduce((sum,g)=>sum+Math.abs(g-120),0)/120;
      combos.push({trio,score:radialError+spreadPenalty*8});
    }
    combos.sort((a,b)=>a.score-b.score);
    combos.slice(0,3).forEach((combo,index)=>add(combo.trio,`circular-${index+1}`));
  }
  return candidates.slice(0,3);
}
function routeOverlapPenalty(coords){
  if(!Array.isArray(coords)||coords.length<30)return 0;
  // Muestreamos la geometría y comparamos puntos separados por al menos 2,5 km
  // de recorrido. Si vuelven a pasar cerca, probablemente se está repitiendo carretera.
  const stride=Math.max(1,Math.ceil(coords.length/220));
  const samples=[];
  let travelled=0,last=null;
  for(let i=0;i<coords.length;i+=stride){
    const p=coords[i];
    if(!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1]))continue;
    if(last)travelled+=distanceKm({lat:last[0],lon:last[1]},{lat:p[0],lon:p[1]});
    samples.push({lat:p[0],lon:p[1],along:travelled,overlap:false});
    last=p;
  }
  if(samples.length<12)return 0;
  // Cierra el cálculo incluyendo el último punto.
  const end=coords[coords.length-1];
  const lastSample=samples[samples.length-1];
  if(end&&Number.isFinite(end[0])&&Number.isFinite(end[1])&&
     (lastSample.lat!==end[0]||lastSample.lon!==end[1])){
    travelled+=distanceKm({lat:lastSample.lat,lon:lastSample.lon},{lat:end[0],lon:end[1]});
    samples.push({lat:end[0],lon:end[1],along:travelled,overlap:false});
  }
  let duplicate=0;
  for(let i=0;i<samples.length;i++){
    for(let j=i+1;j<samples.length;j++){
      const alongGap=samples[j].along-samples[i].along;
      if(alongGap<2.5)continue;
      if(distanceKm(samples[i],samples[j])<0.18){
        if(!samples[i].overlap){samples[i].overlap=true;duplicate++;}
        if(!samples[j].overlap){samples[j].overlap=true;duplicate++;}
      }
    }
  }
  return duplicate/Math.max(samples.length,1);
}
function routeScore(result,plan){
  const kmError=Math.abs(result.summary.lengthKm-plan.requestedKm)/Math.max(plan.requestedKm,1);
  const timeError=Math.abs(result.summary.timeSec/60-plan.requestedMinutes)/Math.max(plan.requestedMinutes,1);
  const overlapPenalty=$('circle').checked?routeOverlapPenalty(result.coords)*1.25:0;
  return kmError*0.78+timeError*0.22+overlapPenalty;
}

function decodePolyline6(str){
  let index=0,lat=0,lon=0,out=[];
  while(index<str.length){let result=0,shift=0,b;do{b=str.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5}while(b>=32);const dlat=(result&1)?~(result>>1):(result>>1);lat+=dlat;result=0;shift=0;do{b=str.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5}while(b>=32);const dlon=(result&1)?~(result>>1):(result>>1);lon+=dlon;out.push([lat/1e6,lon/1e6])}return out;
}


const REGION_META={
  mallorca:{query:'Mallorca, Illes Balears, Spain'},
  menorca:{query:'Menorca, Illes Balears, Spain'},
  ibiza:{query:'Ibiza, Illes Balears, Spain'},
  formentera:{query:'Formentera, Illes Balears, Spain'}
};
const regionGeo={};
// Compartimos una única petición de contorno entre las rutas alternativas concurrentes.
const regionBoundaryPromises={};

function pointInRing(point,ring){
  const x=point[1],y=point[0]; let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
    const hit=((yi>y)!==(yj>y))&&(x<((xj-xi)*(y-yi))/(yj-yi)+xi);
    if(hit)inside=!inside;
  }
  return inside;
}
function pointInGeometry(lat,lon,geometry){
  if(!geometry)return false;
  const pt=[lat,lon];
  const insidePolygon=poly=>{
    if(!poly?.[0]||!pointInRing(pt,poly[0]))return false;
    return !(poly.slice(1).some(hole=>pointInRing(pt,hole)));
  };
  if(geometry.type==='Polygon') return insidePolygon(geometry.coordinates);
  if(geometry.type==='MultiPolygon') return geometry.coordinates.some(insidePolygon);
  return false;
}
async function loadRegionBoundary(region){
  if(!REGION_META[region])return null;
  if(regionGeo[region])return regionGeo[region];
  if(regionBoundaryPromises[region])return regionBoundaryPromises[region];
  regionBoundaryPromises[region]=(async()=>{
    const cached=localStorage.getItem('mrr-boundary-'+region);
    if(cached){try{regionGeo[region]=JSON.parse(cached);return regionGeo[region]}catch(_){}}
    const q=encodeURIComponent(REGION_META[region].query);
    const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&limit=1&featuretype=island&q=${q}`;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const res=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal});
      if(!res.ok)throw new Error('boundary http '+res.status);
      const data=await res.json();
      const geo=data[0]?.geojson;
      if(!geo)throw new Error('boundary missing');
      regionGeo[region]=geo;
      try{localStorage.setItem('mrr-boundary-'+region,JSON.stringify(geo))}catch(_){}
      return geo;
    }catch(e){
      console.warn('No se pudo cargar el contorno OSM de',region,e);
      return null;
    }finally{
      clearTimeout(timer);
      delete regionBoundaryPromises[region];
    }
  })();
  return regionBoundaryPromises[region];
}
function routeShapeIsInRegion(coords,region,geometry){
  const island=ISLANDS[region];
  if(!island||coords.length<5)return false;
  // Si disponemos del contorno real de OSM, TODOS los puntos deben estar dentro.
  if(geometry) return coords.every(p=>pointInGeometry(p[0],p[1],geometry));
  // Si no podemos obtener el contorno real, no aceptamos la ruta: la seguridad
  // de una isla no debe depender de una caja aproximada.
  return false;
}
function poiQueryForStop(stop){
  if(stop==='all')return [
    'node["amenity"~"^(restaurant|fast_food|cafe|bar|pub|fuel)$"]',
    'way["amenity"~"^(restaurant|fast_food|cafe|bar|pub|fuel)$"]'
  ];
  if(stop.includes('Restaurante'))return [
    'node["amenity"~"^(restaurant|fast_food)$"]',
    'way["amenity"~"^(restaurant|fast_food)$"]'
  ];
  if(stop.includes('Café')||stop.includes('Bar'))return [
    'node["amenity"~"^(cafe|bar|pub)$"]',
    'way["amenity"~"^(cafe|bar|pub)$"]'
  ];
  if(stop.includes('Gasolinera'))return [
    'node["amenity"="fuel"]',
    'way["amenity"="fuel"]'
  ];
  return [];
}

function placeCategory(tags){
  if(tags.tourism==='viewpoint')return {name:'Mirador',emoji:'📸',color:'#a855f7'};
  if(tags.amenity==='fuel')return {name:'Gasolinera',emoji:'⛽',color:'#f97316'};
  if(tags.amenity==='cafe')return {name:'Cafetería',emoji:'☕',color:'#f59e0b'};
  if(tags.amenity==='bar'||tags.amenity==='pub')return {name:'Bar',emoji:'🍺',color:'#3b82f6'};
  if(tags.amenity==='restaurant'||tags.amenity==='fast_food')return {name:'Restaurante',emoji:'🍽️',color:'#ef4444'};
  return {name:'Establecimiento',emoji:'📍',color:'#64748b'};
}
function placeCategory(tags){
  if(tags.tourism==='viewpoint')return {name:'Mirador',emoji:'📸',color:'#a855f7'};
  if(tags.amenity==='fuel')return {name:'Gasolinera',emoji:'⛽',color:'#f97316'};
  if(tags.amenity==='cafe')return {name:'Cafetería',emoji:'☕',color:'#f59e0b'};
  if(tags.amenity==='bar'||tags.amenity==='pub')return {name:'Bar',emoji:'🍺',color:'#3b82f6'};
  if(tags.amenity==='restaurant'||tags.amenity==='fast_food')return {name:'Restaurante',emoji:'🍽️',color:'#ef4444'};
  return {name:'Establecimiento',emoji:'📍',color:'#64748b'};
}
function poiMarkerIcon(category){return L.divIcon({className:'poi-div-icon',html:'<div class="poi-marker" style="--poi-color:'+category.color+'">'+category.emoji+'</div>',iconSize:[34,34],iconAnchor:[17,17]});}
function routeBounds(coords){
  const points=coords.filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(!points.length)throw new Error('ROUTE_BOUNDS_EMPTY');
  const lats=points.map(p=>p[0]),lons=points.map(p=>p[1]);
  return [
    Math.min(...lats).toFixed(6),
    Math.min(...lons).toFixed(6),
    Math.max(...lats).toFixed(6),
    Math.max(...lons).toFixed(6)
  ];
}

function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function stopIcon(stop){
  if(stop.includes('Restaurante'))return '🍽️';
  if(stop.includes('Café'))return '☕';
  if(stop.includes('Bar'))return '🍺';
  if(stop.includes('Gasolinera'))return '⛽';
  if(stop.includes('Mirador'))return '📸';
  return '📍';
}
async function findRealStops(coords,stop){
  const selector=poiQueryForStop(stop);if(!selector.length)return {places:[],error:null};
  try{
    // Buscamos en varios puntos repartidos por el recorrido, en vez de consultar
    // un rectángulo enorme que incluye mucha zona ajena a la ruta.
   const sampleCount=3;
    const samples=[];
    for(let i=0;i<sampleCount;i++){
      const p=coords[Math.round(i*(coords.length-1)/(sampleCount-1))];
      const key=Number(p[0]).toFixed(5)+','+Number(p[1]).toFixed(5);
      if(!samples.some(s=>s.key===key))samples.push({key,lat:Number(p[0]).toFixed(5),lon:Number(p[1]).toFixed(5)});
    }
    const clauses=samples.flatMap(p=>selector.map(q=>q+'(around:2000,'+p.lat+','+p.lon+');')).join('');
    const query='[out:json][timeout:8];('+clauses+');out center tags;';
    // Consultamos a través del Worker para evitar bloqueos CORS del navegador.
    const endpoint='https://mallorca-riders-proxy-test.i-riveraseguro.workers.dev/overpass';
    let data=null;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),16000);
    try{
      const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8',Accept:'application/json'},body:query,signal:controller.signal});
      if(!res.ok){
        let detail='';
        try{
          const errData=await res.json();
          detail=errData.detail||errData.error||'';
        }catch(_){}
        throw new Error('HTTP '+res.status+(detail?' — '+detail:''));
      }
      const json=await res.json();
      if(!Array.isArray(json.elements))throw new Error('respuesta no válida del servidor');
      data=json;
    }catch(error){if(error?.name==='AbortError')throw new Error('La búsqueda de establecimientos ha superado los 16 segundos');throw error}finally{clearTimeout(timer)}
    if(!data)throw new Error('sin respuesta del servidor');
    const candidates=(data.elements||[]).map(el=>{const tags=el.tags||{},category=placeCategory(tags);return {id:el.type+'/'+el.id,lat:el.lat??el.center?.lat,lon:el.lon??el.center?.lon,name:tags.name||tags.brand||tags.operator||category.name+' sin nombre',tags,category}}).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
    const stride=Math.max(1,Math.floor(coords.length/140));
    const places=candidates.map(c=>{let nearest=Infinity;for(let i=0;i<coords.length;i+=stride)nearest=Math.min(nearest,distanceKm({lat:c.lat,lon:c.lon},{lat:coords[i][0],lon:coords[i][1]}));return {...c,distanceKm:nearest}}).filter(c=>c.distanceKm<=3).sort((a,b)=>a.distanceKm-b.distanceKm);
    const unique=[];for(const p of places){if(unique.some(q=>q.name.toLowerCase()===p.name.toLowerCase()&&distanceKm(p,q)<0.08))continue;unique.push(p);if(unique.length>=80)break}
    return {places:unique,error:null};
  }catch(e){console.warn('No se pudieron consultar establecimientos de OpenStreetMap',e);return {places:[],error:String(e?.message||e||'error de consulta')}}
}
async function requestRoute(locations,plan){
  // Pedimos a Valhalla una geometría GeoJSON directamente. Así evitamos
  // cualquier error de decodificación de polilíneas y dibujamos exactamente
  // la geometría que devuelve el motor de carreteras.
  const payload={
    locations,
    costing:'motorcycle',
    units:'kilometers',
    format:'osrm',
    shape_format:'geojson',
    directions_type:'none',
    costing_options:{
      motorcycle:{
        exclude_ferries:true,
        use_highways:$('motor').checked?0.05:1,
        use_ferry:0,
        use_tolls:0.3,
        use_tracks:plan.type==='Montaña'?0.25:0.12
      }
    }
  };
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),25000);
  let res;
  try{
    res=await fetch(VALHALLA_URL,{method:'POST',headers:VALHALLA_HEADERS,body:JSON.stringify(payload),signal:controller.signal});
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
  if(!data.routes?.length)throw new Error(data.message||'SIN_RUTA');
  const route=data.routes[0];
  const geometry=route.geometry;
  const coords=Array.isArray(geometry?.coordinates)?geometry.coordinates.map(c=>[Number(c[1]),Number(c[0])]).filter(c=>Number.isFinite(c[0])&&Number.isFinite(c[1])):[];
  if(coords.length<2)throw new Error('Sin geometría');
  const summary={distance:Number(route.distance||0)/1000,duration:Number(route.duration||0)};
  // OSRM devuelve pasos/maneuvers; bloqueamos cualquier indicio de ferry aunque el servidor lo haya permitido.
  const hasFerry=route.legs?.some(leg=>leg.steps?.some(step=>String(step.mode||'').toLowerCase()==='ferry'||String(step.name||'').toLowerCase().includes('ferry')||String(step.maneuver?.type||'').toLowerCase().includes('ferry')))||false;
  if(hasFerry)throw new Error('ROUTE_HAS_FERRY');
  const boundary=ISLANDS[plan.region]?await loadRegionBoundary(plan.region):null;
  if(ISLANDS[plan.region] && !boundary) throw new Error('ISLAND_BOUNDARY_UNAVAILABLE');
  if(ISLANDS[plan.region]&&!routeShapeIsInRegion(coords,plan.region,boundary))throw new Error('ROUTE_LEFT_ISLAND');
  return {data,coords,summary:{lengthKm:summary.distance,timeSec:summary.duration}};
}
async function generateRoute(){
  if(screenshotReferenceActive&&!manualRouteActive){
    $('mapStatus').textContent='⚠️ La captura no contiene coordenadas GPS. Para no dibujar una ruta en otra zona, importa un enlace/archivo de ruta o pulsa «Marcar puntos manualmente» y coloca al menos 2 puntos sobre el mapa.';
    $('routeTraceStatus').textContent='La línea azul se ha detectado visualmente, pero aún no está geolocalizada. Usa un enlace/GPX o coloca puntos en el mapa para generar una ruta fiable.';
    $('map').scrollIntoView({behavior:'smooth',block:'center'});
    return;
  }
  const plan=routePlan();if(!plan)return;
  const btn=$('generate');btn.disabled=true;btn.textContent='CALCULANDO RUTA… 🏍️';
  $('mapStatus').textContent='🧭 Comparando alternativas para acercarnos a los km y duración elegidos…';clearRoute();
  try{
    const alternatives=plan.manual?[plan]:buildRouteCandidates(plan);
    const settled=await Promise.allSettled(alternatives.map(async candidate=>{
      const filter=ISLANDS[candidate.region]?{exclude_ferry:true}:{};
      const locations=[{lat:candidate.start.lat,lon:candidate.start.lon,type:'break',search_filter:filter}];
      candidate.targets.forEach(p=>locations.push({lat:p.lat,lon:p.lon,type:'break',search_filter:filter}));
      if($('circle').checked)locations.push({lat:candidate.start.lat,lon:candidate.start.lon,type:'break',search_filter:filter});
      const result=await requestRoute(locations,candidate);
      return {result,candidate,score:routeScore(result,candidate)};
    }));
    const valid=settled.filter(x=>x.status==='fulfilled').map(x=>x.value);
    if(!valid.length)throw(settled.find(x=>x.status==='rejected')?.reason||new Error('SIN_RUTA'));
    valid.sort((a,b)=>a.score-b.score);
    const {result,candidate:chosen}=valid[0];
    const error=Math.abs(result.summary.lengthKm-plan.requestedKm)/Math.max(plan.requestedKm,1);
    routeLine=L.polyline(result.coords,{weight:6,opacity:.9,color:'#1683ff'}).addTo(map);addDirectionalArrows(result.coords);
    if(!plan.manual){
      chosen.targets.forEach(p=>routeMarkers.push(L.marker([p.lat,p.lon]).addTo(map).bindPopup(`🏍️ ${p.name}`)));
    }
    let realStop=null,realStops=[],poiError=null;
    if($('stop').value!=='none'){
      $('mapStatus').textContent='📍 Buscando establecimientos reales cerca de la ruta…';
      const poiResult=await findRealStops(result.coords,$('stop').value);
      realStops=poiResult.places;poiError=poiResult.error;
      const icon=stopIcon($('stop').value);
      realStops.forEach(place=>{
        const cat=place.category;
        const popup='<b>'+escapeHtml(place.name)+'</b><br>'+cat.emoji+' '+cat.name+'<br>A '+place.distanceKm.toFixed(1)+' km de la ruta';
        const marker=L.marker([place.lat,place.lon],{icon:poiMarkerIcon(cat)}).addTo(map).bindPopup(popup);
        marker.bindTooltip(cat.emoji+' '+escapeHtml(place.name),{sticky:true,direction:'top',opacity:0.96});
        routeMarkers.push(marker);
      });
      realStop=realStops[0]||null;
    }
    const viewBounds=routeLine.getBounds();
    realStops.forEach(place=>viewBounds.extend([place.lat,place.lon]));
    map.fitBounds(viewBounds,{padding:[30,30]});
    const km=Math.round(result.summary.lengthKm),mins=Math.round(result.summary.timeSec/60);
    const duration=mins>=60?`${Math.floor(mins/60)} h ${mins%60} min`:`${mins} min`;
    const requestedNote=error<=0.10?'Distancia muy próxima a la elegida.':error<=0.20?'Distancia aproximada a la elegida.':'La red de carreteras no permite acercarse más con estas alternativas.';
    current={id:Date.now(),name:type==='Curvas'?'Ruta de curvas':type==='Costa'?'Costa y curvas':type==='Montaña'?'Montaña y curvas':'Ruta mixta',km:`${km} km`,duration,curves:$('curves').value,stop:$('stop').value,realStop,realStops,poiError,circular:$('circle').checked,createdBy:'Motor de rutas',type,shape:result.coords,routePoints:plan.manual?manualWaypoints.map((p,i)=>({name:p.name||'Punto '+(i+1),lat:p.lat,lon:p.lon})):chosen.targets.map(p=>({name:p.name||'Punto de paso',lat:p.lat,lon:p.lon})),region:plan.region,start:plan.label,requestedKm:plan.requestedKm,requestedDuration:plan.requestedMinutes,requestedNote};
    render(current);
    const poiStatus=$('stop').value==='none'?'':(poiError?' ⚠️ No se pudieron cargar las paradas ('+poiError+').' :' 📍 '+realStops.length+' establecimientos encontrados en el mapa.');
    $('mapStatus').textContent=`🏍️ Ruta terrestre: ${km} km · ${duration} · objetivo ${plan.requestedKm} km / ${plan.requestedMinutes/60} h. ${requestedNote}${poiStatus}`;
  }catch(e){
    console.error('Error al generar ruta:',e);
    const reason=String(e?.message||e||'ERROR_DESCONOCIDO');
    let msg;
    if(reason==='ROUTE_HAS_FERRY')msg='⚠️ El motor devolvió un tramo en ferry y lo he bloqueado.';
    else if(reason==='ROUTE_LEFT_ISLAND')msg=`⚠️ El motor intentó sacar la ruta de ${ISLANDS[plan.region]?.name||'la zona seleccionada'}. He bloqueado ese recorrido.`;
    else if(reason==='ISLAND_BOUNDARY_UNAVAILABLE')msg='⚠️ No he podido verificar el contorno real de la isla. Comprueba la conexión e inténtalo de nuevo.';
    else if(reason==='TIMEOUT')msg='⚠️ El servidor de rutas está tardando demasiado.';
    else if(reason==='NETWORK')msg='⚠️ No hay conexión con el servidor de rutas.';
    else if(reason.startsWith('HTTP_'))msg=`⚠️ El servidor de rutas ha rechazado la petición (${reason.slice(0,100)}).`;
    else msg=`⚠️ Fallo al generar la ruta: ${reason.slice(0,180)}`;
    $('mapStatus').textContent=msg;alert(msg);
  }finally{btn.disabled=false;btn.textContent='GENERAR RUTA 🏍️'}
}
$('generate').onclick=generateRoute;

function render(r){$('result').classList.remove('hidden');$('result').innerHTML=`<h2>🏍️ ${r.name}</h2><small>📍 ${r.region==='peninsula'?'Península':(ISLANDS[r.region]?.name||r.region)} · Creada por ${r.createdBy} · ${r.circular?'ruta circular':'ruta lineal'}</small><div class="stats"><div class="stat"><b>${r.km}</b><small>distancia real</small></div><div class="stat"><b>${r.duration}</b><small>tiempo estimado</small></div><div class="stat"><b>${'🔥'.repeat(r.curves)}</b><small>curvas</small></div></div><div class="stop">${r.stop==='none'?'Sin parada':(r.poiError?'⚠️ No se pudieron consultar los establecimientos. Comprueba la conexión y vuelve a generar la ruta.':(r.realStops?.length?('📍 '+r.realStops.length+' establecimientos marcados en el mapa. Toca un marcador para ver su nombre y ubicación.'): (r.stop+' · No se encontraron establecimientos con nombre a menos de 3 km de la ruta.')))}</div><div class="warning">🗺️ Ruta calculada sobre carreteras reales y validada para no salir de la zona seleccionada.</div><div class="actions"><button class="secondary" onclick="save()">💾 Guardar</button><button class="secondary" onclick="share()">📤 Compartir</button><button class="secondary" onclick="maps()">🗺️ Abrir mapas</button><button class="secondary" onclick="document.getElementById('generate').click()">🔄 Otra ruta</button></div>`;$('result').scrollIntoView({behavior:'smooth'})}
function get(){return JSON.parse(localStorage.getItem('mrr')||'[]')}
async function save(){if(!current){alert('Primero genera una ruta.');return}let a=get();a.unshift(current);localStorage.setItem('mrr',JSON.stringify(a.slice(0,50)));list();if(!sbClient||!sbSession){$('authStatus').textContent='Ruta guardada en este dispositivo. Inicia sesión para guardarla también en la nube.';return}try{const km=Number(String(current.km||'0').replace(/[^0-9.,]/g,'').replace(',','.'))||0;const durationMatch=String(current.duration||'').match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*min)?/i);const minutes=durationMatch?(Number(durationMatch[1]||0)*60+Number(durationMatch[2]||0)):0;const payload={user_id:sbSession.user.id,name:String(current.name||'Ruta'),description:String(current.requestedNote||''),region:current.region||'mallorca',route_type:current.type||'Mixta',distance_km:km,duration_minutes:minutes,route_data:current,is_public:false};const {error}=await sbClient.from('routes').insert(payload);if(error)throw error;$('authStatus').textContent='✅ Ruta guardada en este dispositivo y en tu cuenta.'}catch(e){console.error('Error guardando ruta en Supabase',e);$('authStatus').textContent='La ruta está guardada en este dispositivo, pero no se pudo guardar en la nube: '+(e.message||'error de conexión')}}
function list(){let a=get();$('count').textContent=a.length;if(!a.length){$('saved').innerHTML='Todavía no has guardado ninguna ruta.';return}$('saved').innerHTML=a.map((r,i)=>`<div class="saved"><div><b>🏍️ ${escapeHtml(r.name||'Ruta')}</b><br><small>${escapeHtml(r.km||'')} · ${escapeHtml(r.duration||'')} · ${escapeHtml(r.type||type)}</small></div><button onclick="repeat(${i})">Repetir</button></div>`).join('')}
function repeat(i){current=get()[i];render(current)}
function encodePolyline6(coords){
  let lastLat=0,lastLon=0,out='';
  const encodeValue=value=>{
    let v=value<0?~(value<<1):(value<<1);
    while(v>=0x20){out+=String.fromCharCode((0x20|(v&0x1f))+63);v>>=5}
    out+=String.fromCharCode(v+63);
  };
  for(const point of coords){
    const lat=Math.round(Number(point[0])*1e6);
    const lon=Math.round(Number(point[1])*1e6);
    encodeValue(lat-lastLat);encodeValue(lon-lastLon);
    lastLat=lat;lastLon=lon;
  }
  return out;
}
async function share(){
  if(!current?.shape?.length){alert('Primero genera o abre una ruta.');return}
  // Compartimos el trazado, los puntos de paso y los establecimientos encontrados.
  // No se publica la ruta en Supabase ni se exponen otras rutas del usuario.
  const stops=(Array.isArray(current.realStops)?current.realStops:[]).map(p=>({
    id:p.id||'',
    lat:Number(p.lat),
    lon:Number(p.lon),
    name:String(p.name||p.category?.name||'Establecimiento'),
    distanceKm:Number(p.distanceKm||0),
    tags:p.tags&&typeof p.tags==='object'?p.tags:{},
    category:p.category&&typeof p.category==='object'?p.category:{name:'Establecimiento',emoji:'📍',color:'#64748b'}
  })).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
  const routePoints=(Array.isArray(current.routePoints)?current.routePoints:[]).map(p=>({
    name:String(p.name||'Punto de paso'),lat:Number(p.lat),lon:Number(p.lon)
  })).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
  const params=new URLSearchParams({
    route:encodePolyline6(current.shape),
    name:current.name||'Ruta compartida',
    km:current.km||'',
    duration:current.duration||'',
    curves:String(current.curves||3),
    type:current.type||type,
    region:current.region||'mallorca',
    circular:current.circular?'1':'0',
    stop:current.stop||'none',
    stops:JSON.stringify(stops),
    points:JSON.stringify(routePoints)
  });
  const shareUrl=new URL(window.location.href);
  shareUrl.hash=params.toString();
  const url=shareUrl.toString();
  const textMessage=`🏍️ ${current.name||'Ruta compartida'}\n${current.km||''} · ${current.duration||''}\n${stops.length} establecimientos · ${routePoints.length} puntos de paso\nMallorca Riders Routes`;
  if(navigator.share){
    try{await navigator.share({title:current.name||'Ruta compartida',text:textMessage,url})}
    catch(error){if(error?.name!=='AbortError')alert('No se pudo abrir el menú para compartir. Puedes copiar este enlace:\n'+url)}
  }else if(navigator.clipboard){
    try{await navigator.clipboard.writeText(textMessage+'\n'+url);alert('Enlace de la ruta completa copiado. Ya puedes enviarlo por WhatsApp.')}
    catch(_){prompt('Copia este enlace para compartir la ruta completa:',url)}
  }else{
    prompt('Copia este enlace para compartir la ruta completa:',url);
  }
}
function loadSharedRoute(){
  const params=new URLSearchParams(window.location.hash.slice(1));
  const encoded=params.get('route');
  if(!encoded)return;
  try{
    const shape=decodePolyline6(encoded);
    if(shape.length<2)throw new Error('La ruta compartida no contiene suficientes puntos.');
    let sharedStops=[],routePoints=[];
    try{const value=JSON.parse(params.get('stops')||'[]');if(Array.isArray(value))sharedStops=value}catch(_){}
    try{const value=JSON.parse(params.get('points')||'[]');if(Array.isArray(value))routePoints=value}catch(_){}
    sharedStops=sharedStops.filter(p=>p&&Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lon))).map(p=>({
      ...p,lat:Number(p.lat),lon:Number(p.lon),
      category:p.category&&typeof p.category==='object'?p.category:{name:'Establecimiento',emoji:'📍',color:'#64748b'},
      distanceKm:Number(p.distanceKm||0)
    }));
    routePoints=routePoints.filter(p=>p&&Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lon))).map(p=>({...p,lat:Number(p.lat),lon:Number(p.lon)}));
    current={
      id:Date.now(),
      name:params.get('name')||'Ruta compartida',
      km:params.get('km')||Math.round(shape.reduce((sum,p,i)=>i?sum+distanceKm({lat:shape[i-1][0],lon:shape[i-1][1]},{lat:p[0],lon:p[1]}):sum,0))+' km',
      duration:params.get('duration')||'',
      curves:Number(params.get('curves')||3),
      stop:params.get('stop')|| (sharedStops.length?'all':'none'),
      realStop:sharedStops[0]||null,realStops:sharedStops,poiError:null,
      circular:params.get('circular')==='1',
      createdBy:'un motero',
      type:params.get('type')||'Mixta',
      shape,routePoints,
      region:params.get('region')||'mallorca',
      start:'Ruta compartida',
      requestedKm:0,requestedDuration:0,
      requestedNote:'Ruta compartida por un motero'
    };
    clearRoute();
    routeLine=L.polyline(shape,{weight:6,opacity:.9,color:'#1683ff'}).addTo(map);addDirectionalArrows(shape);
    routePoints.forEach((p,i)=>{
      const marker=L.marker([p.lat,p.lon]).addTo(map).bindPopup('🏍️ '+escapeHtml(p.name||('Punto '+(i+1))));
      routeMarkers.push(marker);
    });
    sharedStops.forEach(place=>{
      const cat=place.category||{name:'Establecimiento',emoji:'📍',color:'#64748b'};
      const popup='<b>'+escapeHtml(place.name)+'</b><br>'+escapeHtml(cat.emoji||'📍')+' '+escapeHtml(cat.name||'Establecimiento')+'<br>A '+Number(place.distanceKm||0).toFixed(1)+' km de la ruta';
      const marker=L.marker([place.lat,place.lon],{icon:poiMarkerIcon(cat)}).addTo(map).bindPopup(popup);
      marker.bindTooltip((cat.emoji||'📍')+' '+escapeHtml(place.name),{sticky:true,direction:'top',opacity:0.96});
      routeMarkers.push(marker);
    });
    const bounds=routeLine.getBounds();
    [...routePoints.map(p=>[p.lat,p.lon]),...sharedStops.map(p=>[p.lat,p.lon])].forEach(p=>bounds.extend(p));
    map.fitBounds(bounds,{padding:[30,30]});
    render(current);
    $('mapStatus').textContent='🏍️ Ruta completa compartida: trazado, '+routePoints.length+' puntos de paso y '+sharedStops.length+' establecimientos. Puedes guardarla o volver a compartirla.';
  }catch(error){
    console.error('No se pudo abrir la ruta compartida',error);
    alert('No se ha podido abrir esta ruta compartida. Pide que te envíen un enlace nuevo.');
  }
}
function maps(){
  if(!current?.shape?.length||current.shape.length<2){alert('Primero genera, importa o abre una ruta.');return}
  const shape=current.shape;
  const origin=shape[0],destination=shape[shape.length-1];
  const distanceBetween=(a,b)=>distanceKm({lat:a[0],lon:a[1]},{lat:b[0],lon:b[1]});
  const total=shape.reduce((sum,p,i)=>i?sum+distanceBetween(shape[i-1],p):sum,0);
  // Hasta tres puntos intermedios para favorecer compatibilidad con Google Maps móvil.
  const waypoints=[];
  for(let targetIndex=1;targetIndex<=3;targetIndex++){
    const targetDistance=total*targetIndex/4;
    let travelled=0,chosen=null;
    for(let i=1;i<shape.length;i++){
      travelled+=distanceBetween(shape[i-1],shape[i]);
      if(travelled>=targetDistance){chosen=shape[i];break}
    }
    if(chosen&&distanceBetween(origin,chosen)>0.5&&distanceBetween(destination,chosen)>0.5)waypoints.push(chosen);
  }
  const params=new URLSearchParams({api:'1',origin:origin[0]+','+origin[1],destination:destination[0]+','+destination[1],travelmode:'driving'});
  if(waypoints.length)params.set('waypoints',waypoints.map(p=>p[0]+','+p[1]).join('|'));
  const url='https://www.google.com/maps/dir/?'+params.toString();
  window.open(url,'_blank','noopener');
  $('mapStatus').textContent='🗺️ Abriendo Google Maps con origen, destino y hasta 3 puntos intermedios. Google puede recalcular algunos tramos.';
}
let screenshotObjectUrl=null,screenshotReferenceActive=false;
async function showRouteScreenshot(file){
  if(!file)return;
  if(!file.type.startsWith('image/')){alert('Selecciona una imagen JPG, PNG o WEBP.');return}
  // Desde que se elige una captura, bloquear la generación normal hasta cerrar
  // el panel o elegir puntos geográficos reales; incluso si falla la detección.
  if(screenshotObjectUrl)URL.revokeObjectURL(screenshotObjectUrl);
  screenshotObjectUrl=URL.createObjectURL(file);
  $('routeScreenshotPreview').src=screenshotObjectUrl;
  $('routeScreenshotName').textContent=file.name;
  $('routeScreenshotPanel').classList.remove('hidden');
  const status=$('routeTraceStatus'),canvas=$('routeTraceCanvas'),img=$('routeScreenshotPreview');
  canvas.classList.add('hidden');canvas.style.display='none';
  status.textContent='Analizando los colores de la captura en este dispositivo…';
  $('mapStatus').textContent='📸 Analizando la captura localmente; no se sube a ningún servidor.';
  try{
    await new Promise((resolve,reject)=>{if(img.complete&&img.naturalWidth)resolve();else{img.onload=resolve;img.onerror=()=>reject(new Error('No se pudo abrir la imagen.'))}});
    const maxSide=1100,scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
    const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
    canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(img,0,0,w,h);
    const frame=ctx.getImageData(0,0,w,h),d=frame.data;
    const totalPixels=w*h,blue=new Uint8Array(totalPixels),visited=new Uint8Array(totalPixels);
    // Primero aislamos píxeles azulados y después buscamos grupos conectados.
    // Así evitamos resaltar todos los iconos azules dispersos del mapa.
    let blueHits=0;
    for(let p=0;p<totalPixels;p++){
      const i=p*4,r=d[i],g=d[i+1],b=d[i+2];
      if(b>115&&b>r*1.28&&b>g*1.06&&g>55&&r<115&&d[i+3]>100){blue[p]=1;blueHits++}
    }
    const stack=new Int32Array(totalPixels);
    let components=[],largest=0;
    for(let p=0;p<totalPixels;p++){
      if(!blue[p]||visited[p])continue;
      let top=0;stack[top++]=p;visited[p]=1;
      const pixels=[];let minX=w,minY=h,maxX=0,maxY=0;
      while(top){
        const q=stack[--top],x=q%w,y=(q/w)|0;
        pixels.push(q);if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          if(!dx&&!dy)continue;
          const nx=x+dx,ny=y+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;
          const n=ny*w+nx;if(blue[n]&&!visited[n]){visited[n]=1;stack[top++]=n}
        }
      }
      if(pixels.length>largest)largest=pixels.length;
      components.push({pixels,size:pixels.length,minX,minY,maxX,maxY});
    }
    if(blueHits<Math.max(45,totalPixels*0.00008)||!components.length){
      status.textContent='No he podido detectar un trazado azul suficientemente claro. No se ha creado ninguna ruta.';
      $('mapStatus').textContent='⚠️ No se ha detectado una línea azul fiable.';
      return;
    }
    // Conservamos el componente principal y solo segmentos grandes relacionados
    // por tamaño; los iconos aislados y pequeños quedan fuera.
    const keep=components.filter(c=>c.size>=Math.max(8,largest*0.10)).sort((a,b)=>b.size-a.size).slice(0,18);
    const selected=new Uint8Array(totalPixels);let hits=0,minX=w,minY=h,maxX=0,maxY=0;
    for(const c of keep)for(const q of c.pixels){selected[q]=1;hits++;const x=q%w,y=(q/w)|0;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}
    if(!hits){status.textContent='No he podido separar la línea principal del mapa.';return}
    const mask=ctx.createImageData(w,h),md=mask.data;
    for(let p=0;p<totalPixels;p++)if(selected[p]){const i=p*4;md[i]=255;md[i+1]=30;md[i+2]=190;md[i+3]=220}
    canvas.style.backgroundImage='url("'+screenshotObjectUrl+'")';
    canvas.style.backgroundSize='100% 100%';
    canvas.style.backgroundRepeat='no-repeat';
    canvas.style.backgroundColor='transparent';
    ctx.clearRect(0,0,w,h);
    ctx.putImageData(mask,0,0);
    canvas.classList.remove('hidden');canvas.style.display='block';
    screenshotReferenceActive=true;
    status.textContent='He aislado '+hits.toLocaleString('es-ES')+' píxeles conectados del posible trazado azul y los he resaltado en magenta. Esto aún no identifica su ubicación GPS.';
    $('mapStatus').textContent='🧭 Captura analizada. Para evitar una ruta en otra zona, no se usará esta imagen como si contuviera coordenadas GPS. Importa un enlace/GPX o coloca puntos sobre el mapa.';
  }catch(err){
    status.textContent='No se pudo analizar la imagen: '+(err.message||'error desconocido');
    $('mapStatus').textContent='⚠️ No se pudo analizar la captura.';
  }
}
function closeRouteScreenshot(){
  screenshotReferenceActive=false;
  $('routeScreenshotPanel').classList.add('hidden');
  $('routeScreenshotFile').value='';
  if(screenshotObjectUrl){URL.revokeObjectURL(screenshotObjectUrl);screenshotObjectUrl=null}
}
async function loadGoogleMapsLink(){
  const raw=$('googleMapsLink').value.trim();
  if(!raw){alert('Pega primero el enlace de Google Maps.');return}
  let inputUrl;
  try{inputUrl=new URL(raw)}catch(_){alert('El enlace no parece válido. Copia la dirección completa de Google Maps.');return}
  const allowedHosts=['maps.app.goo.gl','goo.gl','www.google.com','google.com','maps.google.com'];
  if(inputUrl.protocol!=='https:'||!allowedHosts.includes(inputUrl.hostname.toLowerCase())){
    alert('Por seguridad, pega un enlace HTTPS de Google Maps.');
    return;
  }
  const button=$('loadMapsLinkButton');
  button.disabled=true;
  button.textContent='⏳ Leyendo enlace…';
  $('mapStatus').textContent='Resolviendo el enlace de Google Maps y buscando los puntos del recorrido…';
  try{
    let decoded=decodeURIComponent(raw);
    if(/^(maps\.app\.goo\.gl|goo\.gl)$/i.test(inputUrl.hostname)){
      const response=await fetch('/api/resolve-google?url='+encodeURIComponent(inputUrl.href),{headers:{Accept:'application/json'}});
      const payload=await response.json();
      if(!response.ok||!payload.url)throw new Error(payload.error||'Google Maps no ha permitido resolver este enlace.');
      decoded=decodeURIComponent(payload.url);
    }
    const candidates=[];
    const addPair=(lat,lon)=>{lat=Number(lat);lon=Number(lon);if(Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&!candidates.some(p=>Math.abs(p.lat-lat)<0.0001&&Math.abs(p.lon-lon)<0.0001))candidates.push({lat,lon})};
    for(const m of decoded.matchAll(/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/g))addPair(m[1],m[2]);
    for(const m of decoded.matchAll(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/g))addPair(m[1],m[2]);
    for(const m of decoded.matchAll(/[?&](?:destination|origin|query|q)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/g))addPair(m[1],m[2]);
    for(const m of decoded.matchAll(/(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/g))addPair(m[1],m[2]);
    if(candidates.length<2){
      $('mapStatus').textContent='El enlace se ha abierto, pero Google Maps no ha incluido coordenadas suficientes. Prueba Compartir → Copiar enlace desde la pantalla de indicaciones, o importa un GPX.';
      alert('He podido leer el enlace, pero no contiene suficientes coordenadas para reconstruir toda la ruta. En Google Maps, abre las indicaciones y usa Compartir → Copiar enlace. Si sigue igual, podremos añadir importación GPX.');
      return;
    }
    clearManualRoute();clearRoute();
    const chosen=candidates.slice(0,20);
    chosen.forEach(p=>addManualWaypoint({lat:p.lat,lng:p.lon}));
    finishManualRoute();
    map.fitBounds(L.latLngBounds(chosen.map(p=>[p.lat,p.lon])),{padding:[35,35]});
    $('mapStatus').textContent='📍 Recuperados '+chosen.length+' puntos del enlace. Comprueba el trazado y pulsa «Generar ruta» para ajustarlo a carreteras reales.';
    $('generate').scrollIntoView({behavior:'smooth',block:'center'});
  }catch(error){
    console.error('Error importando enlace de Google Maps',error);
    $('mapStatus').textContent='⚠️ No se pudo resolver el enlace. Puedes intentarlo de nuevo o importar un archivo GPX.';
    alert('No he podido leer este enlace de Google Maps: '+(error?.message||'error de conexión'));
  }finally{
    button.disabled=false;
    button.textContent='Intentar recuperar puntos';
  }
}
function parseImportedRoute(textContent,extension){
  const coords=[];
  if(extension==='gpx'){
    const xml=new DOMParser().parseFromString(textContent,'application/xml');
    if(xml.querySelector('parsererror'))throw new Error('El archivo GPX no es válido.');
    let points=[...xml.getElementsByTagName('trkpt')];
    if(!points.length)points=[...xml.getElementsByTagName('rtept')];
    if(!points.length)points=[...xml.getElementsByTagName('wpt')];
    points.forEach(p=>{const lat=Number(p.getAttribute('lat')),lon=Number(p.getAttribute('lon'));if(Number.isFinite(lat)&&Number.isFinite(lon))coords.push([lat,lon])});
  }else if(extension==='kml'){
    const xml=new DOMParser().parseFromString(textContent,'application/xml');
    if(xml.querySelector('parsererror'))throw new Error('El archivo KML no es válido.');
    const line=xml.querySelector('LineString coordinates');
    if(line)line.textContent.trim().split(/\s+/).forEach(pair=>{const values=pair.split(',').map(Number);if(Number.isFinite(values[0])&&Number.isFinite(values[1]))coords.push([values[1],values[0]])});
  }else{
    let data;try{data=JSON.parse(textContent)}catch(_){throw new Error('El archivo JSON/GeoJSON no es válido.')}
    const lines=[];
    const walk=g=>{if(!g)return;if(g.type==='FeatureCollection')g.features?.forEach(f=>walk(f.geometry));else if(g.type==='Feature')walk(g.geometry);else if(g.type==='LineString')lines.push(g.coordinates);else if(g.type==='MultiLineString')g.coordinates.forEach(line=>lines.push(line));};
    walk(data);
    if(lines.length)lines.forEach((line,index)=>line.forEach((p,i)=>{if(index===0||i>0)if(Number.isFinite(p?.[0])&&Number.isFinite(p?.[1]))coords.push([p[1],p[0]])}));
    else if(Array.isArray(data.coordinates))data.coordinates.forEach(p=>{if(Number.isFinite(p?.[0])&&Number.isFinite(p?.[1]))coords.push([p[1],p[0]])});
  }
  if(coords.length<2)throw new Error('No encuentro un trazado con al menos dos puntos. Prueba con un GPX, KML o GeoJSON de una ruta.');
  return coords;
}
async function importRouteFile(file){
  if(!file)return;
  try{
    const extension=(file.name.split('.').pop()||'').toLowerCase();
    if(!['gpx','kml','geojson','json'].includes(extension))throw new Error('Formato no compatible. Usa GPX, KML o GeoJSON.');
    const shape=parseImportedRoute(await file.text(),extension);
    clearRoute();clearManualRoute();
    routeLine=L.polyline(shape,{weight:6,opacity:.9}).addTo(map);
    map.fitBounds(routeLine.getBounds(),{padding:[30,30]});
    const km=Math.round(shape.reduce((sum,p,i)=>i?sum+distanceKm({lat:shape[i-1][0],lon:shape[i-1][1]},{lat:p[0],lon:p[1]}):sum,0));
    const routeName=file.name.replace(/\.(gpx|kml|geojson|json)$/i,'').replace(/[_-]+/g,' ').trim()||'Ruta importada';
    current={id:Date.now(),name:routeName,km:km+' km',duration:'',curves:3,stop:'none',realStop:null,realStops:[],poiError:null,circular:distanceKm({lat:shape[0][0],lon:shape[0][1]},{lat:shape[shape.length-1][0],lon:shape[shape.length-1][1]})<2,createdBy:'Importada',type:'Mixta',shape,routePoints:[],region:$('region').value,start:'Ruta importada',requestedKm:km,requestedDuration:0,requestedNote:'Importada desde '+file.name};
    render(current);
    $('mapStatus').textContent='✅ Ruta importada: '+shape.length+' puntos · '+km+' km. Puedes guardarla, compartirla o abrirla en Google Maps.';
    $('result').scrollIntoView({behavior:'smooth'});
  }catch(error){
    alert('No he podido importar la ruta. '+(error?.message||'Comprueba el archivo.'));
    $('mapStatus').textContent='⚠️ No se pudo importar el archivo de ruta.';
  }finally{$('importRouteFile').value=''}
}

list();

/* Cuenta y sincronización con Supabase. La clave publishable está diseñada para el cliente;
   el acceso a los datos lo limita RLS en la tabla routes. */
const SUPABASE_URL='https://btgnisuqbwmgnjmzdiik.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_JNnQlrSyEYhAgpq5URmvGw_atnRO_B3';
let sbClient=null,sbSession=null;
function setAuthStatus(message){const el=$('authStatus');if(el)el.textContent=message}
function setAuthUI(session){
  sbSession=session||null;
  const signedIn=!!sbSession;
  $('authSignedIn').classList.toggle('hidden',!signedIn);
  $('authEmail').classList.toggle('hidden',signedIn);
  $('authPassword').classList.toggle('hidden',signedIn);
  $('signUp').classList.toggle('hidden',signedIn);
  $('signIn').classList.toggle('hidden',signedIn);
  $('authUser').textContent=signedIn?'Sesión iniciada: '+(sbSession.user.email||'usuario'):'';
  if(signedIn){setAuthStatus('Cuenta conectada. Sincronizando tus rutas guardadas…');loadCloudRoutes()}
  else setAuthStatus('Puedes seguir usando la app sin registrarte; tus rutas se guardarán solo en este dispositivo.');
}
async function loadCloudRoutes(){
  if(!sbClient||!sbSession)return;
  try{
    const {data,error}=await sbClient.from('routes').select('id,name,description,region,route_type,distance_km,duration_minutes,route_data,created_at').order('created_at',{ascending:false}).limit(50);
    if(error)throw error;
    const local=get();
    const cloud=(data||[]).map(row=>({...((row.route_data&&typeof row.route_data==='object')?row.route_data:{}),id:row.route_data?.id??row.id,cloudId:row.id,name:row.name||row.route_data?.name||'Ruta',km:(row.distance_km||0)+' km',duration:row.route_data?.duration||((row.duration_minutes||0)+' min'),region:row.region||'mallorca',type:row.route_type||'Mixta',createdAt:row.created_at}));
    const merged=[...cloud,...local.filter(l=>!cloud.some(c=>String(c.id)===String(l.id)))].slice(0,50);
    localStorage.setItem('mrr',JSON.stringify(merged));list();
    setAuthStatus('✅ Cuenta conectada. Tus rutas de la nube están sincronizadas.');
  }catch(e){console.error('Error cargando rutas de Supabase',e);setAuthStatus('Has iniciado sesión, pero no se pudieron cargar las rutas: '+(e.message||'error de conexión'))}
}
async function initSupabaseAuth(){
  if(!window.supabase||typeof window.supabase.createClient!=='function'){setAuthStatus('No se pudo cargar el servicio de cuentas. Puedes seguir usando las rutas guardadas en este dispositivo.');return}
  sbClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
  const {data,error}=await sbClient.auth.getSession();
  if(error)console.warn('No se pudo recuperar la sesión',error);
  setAuthUI(data?.session||null);
  sbClient.auth.onAuthStateChange((_event,session)=>{setAuthUI(session)});
}
$('signUp').onclick=async()=>{
  const email=$('authEmail').value.trim(),password=$('authPassword').value;
  if(!email||password.length<6){setAuthStatus('Introduce un correo válido y una contraseña de al menos 6 caracteres.');return}
  $('signUp').disabled=true;setAuthStatus('Creando tu cuenta…');
  try{const {data,error}=await sbClient.auth.signUp({email,password});if(error)throw error;if(data.session){setAuthUI(data.session)}else setAuthStatus('Cuenta creada. Revisa tu correo para confirmar el registro y después inicia sesión.')}
  catch(e){setAuthStatus('No se pudo crear la cuenta: '+(e.message||'error'))}
  finally{$('signUp').disabled=false}
};
$('signIn').onclick=async()=>{
  const email=$('authEmail').value.trim(),password=$('authPassword').value;
  if(!email||!password){setAuthStatus('Introduce tu correo y contraseña.');return}
  $('signIn').disabled=true;setAuthStatus('Iniciando sesión…');
  try{const {data,error}=await sbClient.auth.signInWithPassword({email,password});if(error)throw error;setAuthUI(data.session)}
  catch(e){setAuthStatus('No se pudo iniciar sesión: '+(e.message||'error'))}
  finally{$('signIn').disabled=false}
};
$('signOut').onclick=async()=>{if(!sbClient)return;const {error}=await sbClient.auth.signOut();if(error)setAuthStatus('No se pudo cerrar sesión: '+error.message);else setAuthUI(null)};

initSupabaseAuth();

window.addEventListener('load',loadSharedRoute,{once:true});
