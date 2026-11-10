/* Branded startup. Audio is started only after a tap because iOS Safari blocks autoplay. */
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
    const engineSound=async()=>{
      const AudioCtx=window.AudioContext||window.webkitAudioContext;
      if(!AudioCtx)return;
      const ctx=new AudioCtx();
      if(ctx.state==='suspended') await ctx.resume();
      const now=ctx.currentTime;
      const master=ctx.createGain();master.gain.setValueAtTime(.0001,now);master.gain.exponentialRampToValueAtTime(.20,now+.08);master.gain.setValueAtTime(.16,now+1.05);master.gain.exponentialRampToValueAtTime(.0001,now+1.8);master.connect(ctx.destination);
      const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.setValueAtTime(190,now);filter.frequency.linearRampToValueAtTime(520,now+.55);filter.frequency.linearRampToValueAtTime(210,now+1.75);filter.Q.value=.8;filter.connect(master);
      [0,1].forEach((n)=>{const osc=ctx.createOscillator();const g=ctx.createGain();osc.type='sawtooth';osc.frequency.setValueAtTime(42+n*2,now);osc.frequency.linearRampToValueAtTime(78+n*3,now+.52);osc.frequency.linearRampToValueAtTime(48+n*2,now+1.15);osc.frequency.linearRampToValueAtTime(39+n*2,now+1.8);g.gain.value=n?.24:.55;osc.connect(g);g.connect(filter);osc.start(now);osc.stop(now+1.85);});
      const length=Math.floor(ctx.sampleRate*1.8);const buffer=ctx.createBuffer(1,length,ctx.sampleRate);const data=buffer.getChannelData(0);for(let i=0;i<length;i++){const t=i/ctx.sampleRate;data[i]=(Math.random()*2-1)*(.12*Math.exp(-t*1.15));}
      const noise=ctx.createBufferSource();noise.buffer=buffer;const nf=ctx.createBiquadFilter();nf.type='lowpass';nf.frequency.value=260;const ng=ctx.createGain();ng.gain.value=.22;noise.connect(nf);nf.connect(ng);ng.connect(master);noise.start(now);noise.stop(now+1.8);
      window.setTimeout(()=>ctx.close().catch(()=>{}),2400);
    };
    document.getElementById('mrr-start-sound').addEventListener('click',async()=>{
      const b=document.getElementById('mrr-start-sound');b.disabled=true;b.textContent='RATA TA TA…';
      try{await engineSound();}catch(e){console.warn('No se pudo reproducir el sonido de arranque:',e);}
      window.setTimeout(close,1050);
    },{once:true});
    document.getElementById('mrr-start-silent').addEventListener('click',close,{once:true});
    // Fallback so the app never queda bloqueada if the splash is left untouched.
    window.setTimeout(close,12000);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
