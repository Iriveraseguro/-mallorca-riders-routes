/* Real motorcycle start sound. Audio begins only after a user tap for iOS Safari. */
(()=>{
  const start=()=>{
    if(document.getElementById('mrr-splash')) return;
    const splash=document.createElement('section');
    splash.id='mrr-splash';
    splash.setAttribute('role','dialog');
    splash.setAttribute('aria-label','Bienvenida a Mallorca Riders Routes');
    splash.innerHTML='<img src="assets/logo.png" alt="Mallorca Riders Routes"><div class="mrr-splash-caption">Rutas hechas por moteros, para moteros</div><div class="mrr-splash-actions"><button type="button" id="mrr-start-sound">🏍️ ARRANCAR · ENTRAR</button><button type="button" class="mrr-silent" id="mrr-start-silent">ENTRAR EN SILENCIO</button></div>';
    document.body.appendChild(splash);
    let closed=false;
    const close=()=>{if(closed)return;closed=true;splash.classList.add('mrr-splash-out');window.setTimeout(()=>splash.remove(),700);};
    document.getElementById('mrr-start-sound').addEventListener('click',async()=>{
      const b=document.getElementById('mrr-start-sound');
      b.disabled=true;
      b.textContent='RATA TA TA…';
      const audio=new Audio('./assets/engine-start.mp3');
      audio.preload='auto';
      audio.volume=0.82;
      audio.addEventListener('ended',close,{once:true});
      try{
        await audio.play();
        window.setTimeout(close,3000);
      }catch(e){
        console.warn('No se pudo reproducir el sonido de arranque:',e);
        close();
      }
    },{once:true});
    document.getElementById('mrr-start-silent').addEventListener('click',close,{once:true});
    window.setTimeout(close,12000);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
