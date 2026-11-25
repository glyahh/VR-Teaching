const deskMapModes = [
  {mode:'original',label:'原议湘西'},
  {mode:'revised',label:'改向黔北'},
  {mode:'both',label:'叠加'},
  {mode:'parallel',label:'并排'},
] as const;

function createDeskMapReader(body:HTMLElement, onMode:(mode:DeskRouteMode,replay?:boolean)=>void) {
  const {bounds,places,original,revised,incoming,routes}=explorationStage.deskRouteMap;
  const plots=element('div','desk-map-plots');
  const tools=element('div','desk-map-toolbar');
  const legend=element('div','desk-map-legend');
  const fact=element('p','desk-map-fact');
  const terrain=new Image();
  terrain.src=mediaAssets.terrain;
  const buttons=deskMapModes.map(({mode,label})=>control(label,()=>onMode(mode),'desk-map-mode'));
  const replay=control('重画路线',()=>{if (active) onMode(active.mode,true);},'desk-map-replay','reset');
  replay.setAttribute('aria-label','重画路线');
  tools.setAttribute('role','group');
  tools.setAttribute('aria-label','路线显示方式');

  tools.append(...buttons,replay);
  body.append(tools,plots,legend,fact);
  let active:Extract<DeskReading,{kind:'map'}>|undefined;
  let raf=0;
  const W=960, H=460;
  const base=element('canvas');
  base.width=W;
  base.height=H;
  const duration=880;
  const originalPlaces=new Set(['湘江','黎平','湘西北']);
  const revisedPlaces=new Set(['湘江','黎平','猴场','乌江','遵义']);
  const ink={incoming:'#62503d',original:'#244e60',revised:'#9b3129'};
  const xy=(lon:number,lat:number):Point=>[
    63+(lon-bounds.left)/(bounds.right-bounds.left)*(W-133),
    19+(bounds.top-lat)/(bounds.top-bounds.bottom)*(H-55),
  ];
  const paths={incoming:incoming.map(([x,y])=>xy(x,y)),original:original.map(([x,y])=>xy(x,y)),revised:revised.map(([x,y])=>xy(x,y))};

  function swatch(kind:'incoming'|'original'|'revised',label:string) {
    const item=element('span','desk-map-key is-'+kind);
    item.append(element('i'),element('span','',label));
    return item;
  }
  function makePlot(mode:Exclude<DeskRouteMode,'parallel'>, paired:boolean) {
    const figure=element('figure','desk-map-plot');
    figure.dataset.route=mode;
    const label=mode==='original' ? '原议湘西' : mode==='revised' ? '改向黔北' : '两条进军路线';
    if (paired) figure.append(element('figcaption','',label));
    const geography=element('div','desk-map-geography');
    const canvas=element('canvas','desk-map-ink');
    canvas.width=W;
    canvas.height=H;
    canvas.setAttribute('aria-hidden','true');
    const north=element('span','desk-map-north','↑ 北');
    north.setAttribute('aria-hidden','true');
    geography.append(canvas,north);
    for (const [place,lon,lat] of places) {
      const name=String(place);
      if (mode==='original' && !originalPlaces.has(name) || mode==='revised' && !revisedPlaces.has(name)) continue;
      const [x,y]=xy(Number(lon),Number(lat));
      const marker=element('span','desk-map-place');
      marker.dataset.place=name;
      marker.style.left=(x/W*100)+'%';
      marker.style.top=(y/H*100)+'%';
      marker.append(element('i'),element('span','',name));
      geography.append(marker);
    }
    figure.append(geography);
    return {figure,canvas,mode};
  }
  function drawPath(ctx:CanvasRenderingContext2D,kind:keyof typeof paths,progress:number) {
    const points=paths[kind];
    const lengths=points.slice(1).map(([x,y],index)=>Math.hypot(x-points[index][0],y-points[index][1]));
    let remaining=lengths.reduce((sum,n)=>sum+n,0)*progress;
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (let index=0;index<lengths.length && remaining>0;index++) {
      const [x,y]=points[index], [toX,toY]=points[index+1];
      const ratio=Math.min(1,remaining/lengths[index]);
      ctx.lineTo(x+(toX-x)*ratio,y+(toY-y)*ratio);
      remaining-=lengths[index];
    }
    const dash=kind==='original' ? [16,11] : [];
    ctx.setLineDash(dash);
    ctx.lineWidth=kind==='incoming' ? 9 : 13;
    ctx.strokeStyle='#fff5dd';
    ctx.stroke();
    ctx.lineWidth=kind==='incoming' ? 5 : 8;
    ctx.strokeStyle=ink[kind];
    ctx.stroke();
  }
  function prepareBase() {
    const ctx=base.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle='#d6c39a';
    ctx.fillRect(0,0,W,H);
    if (terrain.complete && terrain.naturalWidth) {
      const width=terrain.naturalWidth,height=terrain.naturalHeight;
      ctx.filter='grayscale(.82) sepia(.38) contrast(.72) brightness(1.20)';
      ctx.drawImage(terrain,(bounds.left-104.5)/14*width,(30.65-bounds.top)/6.8*height,
        (bounds.right-bounds.left)/14*width,(bounds.top-bounds.bottom)/6.8*height,63,19,W-133,H-55);
      ctx.filter='none';
      ctx.fillStyle='#ead2a565';
      ctx.fillRect(63,19,W-133,H-55);
    }
    ctx.lineWidth=1;
    ctx.strokeStyle='#74604455';
    ctx.setLineDash([]);
    ctx.strokeRect(63,19,W-133,H-55);
  }
  prepareBase();
  function renderPlot(plot:ReturnType<typeof makePlot>,progress:number) {
    const ctx=plot.canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(base,0,0);
    ctx.lineCap='round';
    ctx.lineJoin='round';
    drawPath(ctx,'incoming',1);
    if (plot.mode!=='revised') drawPath(ctx,'original',progress);
    if (plot.mode!=='original') drawPath(ctx,'revised',progress);
  }
  function paint(view:Extract<DeskReading,{kind:'map'}>) {
    if (view.mode===active?.mode && view.drawAt===active.drawAt) return;
    const previous=active?.mode;
    active=view;
    cancelAnimationFrame(raf);
    const display=view.mode==='parallel' ? [makePlot('original',true),makePlot('revised',true)] : [makePlot(view.mode,false)];
    plots.dataset.mode=view.mode;
    plots.replaceChildren(...display.map(plot=>plot.figure));
    legend.replaceChildren(swatch('incoming','湘江至黎平'));
    if (view.mode!=='revised') legend.append(swatch('original','原议湘西'));
    if (view.mode!=='original') legend.append(swatch('revised','改向黔北'));
    fact.textContent=view.mode==='original' ? routes.original : view.mode==='revised' ? routes.changed : routes.compare;
    buttons.forEach((button,index)=>button.setAttribute('aria-pressed',String(deskMapModes[index].mode===view.mode)));
    function draw() {
      const elapsed=Math.max(0,Date.now()-view.drawAt);
      const fraction=reducedMotion.matches ? 1 : deskClamp(elapsed/duration,0,1);
      const progress=1-(1-fraction)**2;
      for (const plot of display) renderPlot(plot,progress);
      plots.dataset.drawing=String(fraction<1);
      plots.dataset.progress=progress.toFixed(3);
      if (fraction<1) raf=requestAnimationFrame(draw);
    }
    terrain.onload=()=>{
      prepareBase();
      if (active===view && plots.dataset.drawing==='false') display.forEach(plot=>renderPlot(plot,1));
    };
    if (previous!==view.mode) body.scrollTop=0;
    draw();
  }
  return {
    paint,
    dispose() {cancelAnimationFrame(raf);terrain.onload=null;},
  };
}

function mountDeskReader(stage:HTMLElement, session:ReturnType<typeof mountDeskSession>, closed:()=>void) {
  const root=element('section','desk-reader');
  const backdrop=element('div','desk-reader-backdrop');
  const surface=element('div','desk-reader-surface');
  const bar=element('header','desk-reader-heading');
  const title=element('h2');
  const context=element('div','desk-reader-actions');
  const close=control('返回桌面',closed,'desk-reader-back','arrowLeft');
  const content=element('div','desk-reader-content');
  const footer=element('div','desk-reader-footer');
  const compare=control('对照两份材料',()=>{
    const reading=session.read().reading;
    session.openReading({kind:'compare',clueIndex:reading?.kind==='clue'?reading.index:undefined});
  },'desk-reader-compare');
  const route=control('查看行军路线图',session.openMap,'desk-reader-route');
  const pageLabel=element('span','desk-reader-page-number');
  const back=control('',()=>session.turn('back'),'desk-reader-arrow','arrowLeft');
  const next=control('',()=>session.turn('forward'),'desk-reader-arrow','arrowRight');
  setIconButton(back,'前一张手记','arrowLeft');
  setIconButton(next,'后一张手记','arrowRight');

  root.hidden=true;
  title.id='desk-reader-title';
  root.setAttribute('aria-labelledby',title.id);

  context.append(route,compare,close);
  bar.append(title,context);
  footer.append(back,pageLabel,next);
  surface.append(bar,content,footer);
  root.append(backdrop,surface);
  stage.append(root);

  let current:DeskReading|undefined;
  let map:ReturnType<typeof createDeskMapReader>|undefined;
  let book:ReturnType<typeof createBook>|undefined;
  let seenSpread=-1;
  let shownClue:HallClue|undefined;
  let rotate:Animation|undefined;
  let fade:Animation|undefined;

  function article(item:{title:string;lines:readonly string[]},className='') {
    const panel=element('article','desk-reader-article '+className);
    panel.append(element('h3','',item.title),...item.lines.map(line=>element('p','',line)));
    return panel;
  }
  function createBook() {
    const spread=element('div','desk-reader-book');
    const left=element('article','desk-reader-leaf is-left');
    const right=element('article','desk-reader-leaf is-right');
    const turn=element('span','desk-reader-turn');
    turn.hidden=true;
    turn.setAttribute('aria-hidden','true');
    const strips=Array.from({length:10},()=>element('span'));
    turn.append(...strips);
    spread.append(left,right,turn);
    let input:{id:number;x:number;y:number;drag?:DeskLeafDrag;ignore?:boolean}|undefined;
    spread.addEventListener('pointerdown',event=>{
      if (!event.isPrimary || event.button!==0) return;
      input={id:event.pointerId,x:event.clientX,y:event.clientY};
      spread.setPointerCapture(event.pointerId);
    });
    spread.addEventListener('pointermove',event=>{
      if (input?.id!==event.pointerId || input.ignore) return;
      const dx=event.clientX-input.x,dy=event.clientY-input.y;
      if (!input.drag) {
        if (Math.hypot(dx,dy)<9) return;
        if (Math.abs(dx)<Math.abs(dy)*1.15) {input.ignore=true;return;}
        input.drag=session.beginLeaf(dx<0 ? 'forward' : 'back');
        input.ignore=!input.drag;
      }
      if (input.drag) {
        const distance=(input.drag.reverse ? -1 : 1)*(input.drag.leaf.direction==='forward'?-dx:dx);
        session.dragLeaf(input.drag,distance/Math.max(84,spread.clientWidth*.25));
      }
    });
    function release(event:PointerEvent,cancelled:boolean) {
      if (input?.id!==event.pointerId) return;
      const {drag,ignore,x}=input;
      input=undefined;
      if (drag) session.releaseLeaf(drag,cancelled);
      else if (!cancelled && !ignore) {
        const box=spread.getBoundingClientRect();
        session.turn(x<box.left+box.width*.5 ? 'back' : 'forward');
      }
    }
    spread.addEventListener('pointerup',event=>release(event,false));
    spread.addEventListener('pointercancel',event=>release(event,true));
    spread.addEventListener('lostpointercapture',event=>release(event,true));
    return {spread,left,right,animate(leaf:DeskLeaf|undefined) {
      turn.hidden=!leaf || leaf.progress<.015 || leaf.progress>.985;
      if (!leaf || turn.hidden) return;
      const backwards=leaf.direction==='back';
      const direction=backwards ? -1 : 1;
      turn.dataset.direction=leaf.direction;
      const angle=Math.PI*leaf.progress, flex=Math.sin(angle);
      let x=0, depth=0;
      const section=turn.clientWidth/strips.length;
      strips.forEach((strip,index)=>{
        const u=(index+.5)/strips.length;
        const bend=deskClamp(angle+flex*(1.05*(u-.32)-.32*Math.sin(Math.PI*u)),0,Math.PI);
        strip.style.transform='translate3d('+(direction*x)+'px,0,'+depth+'px) rotateY('+(-direction*bend)+'rad)';
        strip.style.setProperty('--strip-shade',String(.86+.14*Math.abs(Math.cos(bend))));
        x+=Math.cos(bend)*section;
        depth+=Math.sin(bend)*section;
      });
    },cancel(){
      const drag=input?.drag;
      const id=input?.id;
      input=undefined;
      if (id!==undefined && spread.hasPointerCapture(id)) spread.releasePointerCapture(id);
      if (drag) session.releaseLeaf(drag,true);
    }};
  }

  function paint(view:DeskView, clues:readonly HallClue[], anchor:Point) {
    const reading=view.reading;
    const wasOpen=!!current;
    const kindChanged=reading?.kind!==current?.kind;
    current=reading;
    if (!reading) {
      if (root.hidden || !wasOpen) return;
      book?.cancel();
      map?.dispose();
      map=undefined;
      book=undefined;
      shownClue=undefined;
      fade?.cancel();
      rotate?.cancel();
      surface.inert=true;
      root.dataset.phase='closing';
      const exit=animatePart(surface,[{opacity:1,transform:'none'},{opacity:0,transform:'scale(.94)'}],175);
      if (exit) void exit.finished.then(()=>{if (!current) root.hidden=true;},()=>{});
      else root.hidden=true;
      fade=exit;
      return;
    }

    root.dataset.reading=reading.kind;
    const showBook=reading.kind==='journal';
    footer.hidden=!showBook;
    compare.hidden=(reading.kind!=='journal' && reading.kind!=='dossier' && reading.kind!=='clue');
    route.hidden=reading.kind!=='clue' || reading.source!=='map';
    if (!wasOpen || kindChanged) {
      fade?.cancel();
      rotate?.cancel();
      root.hidden=false;
      root.dataset.phase='open';
      surface.inert=false;
      if (!wasOpen) {
        surface.style.transformOrigin=anchor.map(value=>100*value+'%').join(' ');
        rotate=animatePart(surface,[{opacity:0,transform:'scale(.91)'},{opacity:1,transform:'none'}],260,60);
      }
      map?.dispose();
      map=undefined;
      book?.cancel();
      book=undefined;
      seenSpread=-1;
      shownClue=undefined;
      content.replaceChildren();
      content.scrollTop=0;
      if ((!wasOpen || !context.contains(document.activeElement))) close.focus({preventScroll:true});
    }

    if (reading.kind==='map') {
      title.textContent='行军路线图';
      map ??=createDeskMapReader(content,session.chooseMap);
      map.paint(reading);
    } else if (showBook) {
      title.textContent='会前手记';
      if (!book) {book=createBook();content.append(book.spread);}
      const index=Math.max(0,view.saved.spread-1);
      if (seenSpread!==index) {
        const leaf=explorationStage.deskNotebook[index];
        book.left.replaceChildren(element('p','desk-reader-note',leaf.note),element('h3','',leaf.title),element('p','',leaf.finding));
        const facts=element('dl','desk-reader-facts');
        for (const [label,value] of leaf.rows) facts.append(element('dt','',label),element('dd','',value));
        book.right.replaceChildren(facts,element('p','',leaf.detail));
        seenSpread=index;
      }
      const flight=view.preview?.kind==='page'?view.preview:undefined;
      book.animate(flight);
      pageLabel.textContent=(index+1)+' / '+deskSpreads;
      pageLabel.setAttribute('aria-label','第 '+(index+1)+' 页，共 '+deskSpreads+' 页');
      const blocked=view.saved.spread<=1 && (!flight || flight.direction==='back' || view.saved.spread===0);
      back.setAttribute('aria-disabled',String(blocked));
      next.setAttribute('aria-disabled',String(view.saved.spread===deskSpreads && !flight));
    } else if (reading.kind==='clue') {
      const clue=clues[reading.index];
      if (clue!==shownClue || !content.childElementCount) {
        const item=clue??zunyiMaterials[0];
        title.textContent=clue?.title??'会前线索';
        content.replaceChildren(article(item));
        shownClue=clue;
      }
    } else if (reading.kind==='compare') {
      const clue=reading.clueIndex===undefined ? undefined : clues[reading.clueIndex];
      if (clue!==shownClue || !content.childElementCount) {
        title.textContent='对照两份材料';
        const pair=element('div','desk-reader-pair');
        pair.append(article(clue??zunyiMaterials[0],'is-left'),article(zunyiMaterials[1],'is-right'));
        content.replaceChildren(pair);
        shownClue=clue;
      }
    } else if (kindChanged || !content.childElementCount) {
      const left=reading.kind==='sheet' && reading.id==='before';
      const item=zunyiMaterials[left ? 0 : 1];
      title.textContent=left ? '摘录' : '会议材料';
      content.replaceChildren(article(item,left ? 'is-left' : 'is-right'));
    }
  }

  {
    backdrop.addEventListener('click',closed);
    root.addEventListener('keydown',event=>{
      if (event.key==='Escape') {event.preventDefault();closed();return;}
      if (current?.kind==='journal' && ['ArrowLeft','ArrowRight','[',']'].includes(event.key)) {
        event.preventDefault();
        book?.cancel();
        session.turn(event.key==='ArrowLeft' || event.key==='[' ? 'back' : 'forward');
      }
      if (['ArrowLeft','ArrowRight','PageUp','PageDown'].includes(event.key)) event.stopPropagation();
    });
  }
  return {
    paint,
    dispose() {map?.dispose();fade?.cancel();rotate?.cancel();},
  };
}
