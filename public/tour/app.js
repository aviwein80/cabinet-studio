(function(){
  var cards=[].slice.call(document.querySelectorAll('.card'));
  var links={};[].forEach.call(document.querySelectorAll('.chap ol a'),function(a){links[a.dataset.id]=a;});
  var cur=-1;
  function setActive(i){
    if(i===cur||i<0)return; cur=i;
    cards.forEach(function(c,j){c.classList.toggle('current',j===i);});
    Object.keys(links).forEach(function(k){links[k].classList.remove('active');});
    var a=links[cards[i].id]; if(a){a.classList.add('active'); var s=document.querySelector('.side'), r=a.getBoundingClientRect(), sr=s.getBoundingClientRect(); if(r.top<sr.top+60||r.bottom>sr.bottom-60) s.scrollTop+=r.top-sr.top-sr.height/2;}
  }
  var lockUntil=0;
  function onScroll(){
    if(Date.now()<lockUntil)return;
    var mid=window.innerHeight*0.4, best=-1;
    for(var i=0;i<cards.length;i++){var r=cards[i].getBoundingClientRect(); if(r.top<=mid) best=i; else break;}
    if(best<0){cards.forEach(function(c){c.classList.remove('current');}); Object.keys(links).forEach(function(k){links[k].classList.remove('active');}); cur=-1; return;}
    setActive(best);
  }
  var tick=false; window.addEventListener('scroll',function(){if(!tick){tick=true;requestAnimationFrame(function(){tick=false;onScroll();});}},{passive:true});
  onScroll();
  // only one video plays at a time
  var vids=[].slice.call(document.querySelectorAll('video'));
  vids.forEach(function(v){v.addEventListener('play',function(){vids.forEach(function(o){if(o!==v&&!o.paused)o.pause();});});});
  function go(i){
    i=Math.max(0,Math.min(cards.length-1,i));
    var v=document.querySelector('.card.current video'); if(v&&!v.paused)v.pause();
    lockUntil=Date.now()+900;
    cards[i].scrollIntoView({behavior:'smooth',block:'start'}); cards[i].focus({preventScroll:true}); setActive(i);
    if(history.replaceState)history.replaceState(null,'','#'+cards[i].id);
  }
  document.addEventListener('keydown',function(e){
    if(e.metaKey||e.ctrlKey||e.altKey)return;
    var t=e.target; if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'))return;
    var k=e.key, inVideo=t&&t.tagName==='VIDEO';
    if(k==='j'||k==='J'||(k==='ArrowDown'&&!inVideo)){e.preventDefault();go(cur+1);}
    else if(k==='k'||k==='K'||(k==='ArrowUp'&&!inVideo)){e.preventDefault();go(cur<0?0:cur-1);}
    else if((k===' '||k==='Spacebar')&&!inVideo&&cur>=0){e.preventDefault();var v=cards[cur].querySelector('video'); if(v.paused)v.play(); else v.pause();}
    else if((k==='f'||k==='F')&&cur>=0){var v2=cards[cur].querySelector('video');
      if(v2.requestFullscreen)v2.requestFullscreen(); else if(v2.webkitEnterFullscreen)v2.webkitEnterFullscreen(); else if(v2.webkitRequestFullscreen)v2.webkitRequestFullscreen();}
  });
})();
