let type='Mixta',pos=null,current=null,map=null,userMarker=null,userAccuracy=null;
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

$('generate').onclick=()=>{
  current={id:Date.now(),name:type==='Curvas'?'La ruta de las curvas':type==='Costa'?'Mar y curvas':type==='Montaña'?'Montaña y curvas':'La vuelta sorpresa',km:$('km').value,duration:$('duration').value,curves:$('curves').value,stop:$('stop').value,circular:$('circle').checked,createdBy:'IA',type};
  render(current);
};

function render(r){
  $('result').classList.remove('hidden');
  $('result').innerHTML=`<h2>🏍️ ${r.name}</h2><small>Creada por ${r.createdBy} · ${r.circular?'ruta circular':'ruta lineal'}</small><div class="stats"><div class="stat"><b>${r.km}</b><small>distancia</small></div><div class="stat"><b>${r.duration}</b><small>duración</small></div><div class="stat"><b>${'🔥'.repeat(r.curves)}</b><small>curvas</small></div></div><div class="stop">${r.stop==='none'?'Sin parada':r.stop}</div><div class="warning">🗺️ El mapa ya está conectado con carreteras reales. El siguiente paso será sustituir esta ruta de prueba por un motor que calcule automáticamente el recorrido real según tus preferencias.</div><div class="actions"><button class="secondary" onclick="save()">💾 Guardar</button><button class="secondary" onclick="share()">📤 Compartir</button><button class="secondary" onclick="maps()">🗺️ Abrir mapas</button><button class="secondary" onclick="document.getElementById('generate').click()">🔄 Otra ruta</button></div>`;
  $('result').scrollIntoView({behavior:'smooth'});
}
function get(){return JSON.parse(localStorage.getItem('mrr')||'[]')}
function save(){let a=get();a.unshift(current);localStorage.setItem('mrr',JSON.stringify(a.slice(0,50)));list()}
function list(){let a=get();$('count').textContent=a.length;if(!a.length){$('saved').innerHTML='Todavía no has guardado ninguna ruta.';return}$('saved').innerHTML=a.map((r,i)=>`<div class="saved"><div><b>🏍️ ${r.name}</b><br><small>${r.km} · ${r.duration} · ${r.type||type}</small></div><button onclick="repeat(${i})">Repetir</button></div>`).join('')}
function repeat(i){current=get()[i];render(current)}
async function share(){let t=`🏍️ ${current.name}\n${current.km} · ${current.duration}\nMallorca Riders Routes`;if(navigator.share)await navigator.share({title:current.name,text:t});else if(navigator.clipboard)await navigator.clipboard.writeText(t)}
function maps(){window.open(pos?`https://www.google.com/maps/dir/?api=1&origin=${pos.latitude},${pos.longitude}&destination=${pos.latitude},${pos.longitude}&travelmode=driving`:'https://www.google.com/maps','_blank')}
initMap();list();
