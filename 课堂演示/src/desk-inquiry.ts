type DeskInquiry = {step:'choose'|'leaf'|'found'|'done'; opening:number; needsClue:boolean; meetingRead:boolean};

function mountDeskInquiry(frame:HTMLElement, adjust:(opening:number)=>void, settle:()=>void) {
  const layout:{size:[number,number];crop:[number,number,number,number];cell:[number,number];columns:number;count:number} = JSON.parse(mediaAssets['desk-leaf-layout']);
  const [sourceWidth, sourceHeight] = layout.size;
  const [left, top, right, bottom] = layout.crop;
  const [cellWidth, cellHeight] = layout.cell;
  const last:number = layout.count-1;
  const canvas = element('canvas','desk-inquiry-sheet');
  canvas.width=cellWidth;
  canvas.height=cellHeight;
  canvas.style.left=left/sourceWidth*100+'%';
  canvas.style.top=top/sourceHeight*100+'%';
  canvas.style.width=(right-left)/sourceWidth*100+'%';
  canvas.style.height=(bottom-top)/sourceHeight*100+'%';
  const brush=canvas.getContext('2d')!;
  const atlas=new Image();
  let requested=false;
  let desired=0;
  let drawn=-1;
  function draw() {
    if (!atlas.naturalWidth || drawn===desired) return;
    brush.clearRect(0,0,cellWidth,cellHeight);
    if (desired>0) {
      brush.drawImage(atlas,(desired%layout.columns)*cellWidth,Math.floor(desired/layout.columns)*cellHeight,
        cellWidth,cellHeight,0,0,cellWidth,cellHeight);
    }
    drawn=desired;
  }
  atlas.onload=draw;

  const ink = document.createElementNS('http://www.w3.org/2000/svg','svg');
  ink.setAttribute('class','desk-inquiry-ink');
  ink.setAttribute('viewBox','0 0 1280 720');
  ink.setAttribute('aria-hidden','true');
  const line = document.createElementNS(ink.namespaceURI!,'path');
  line.setAttribute('d','M454 432 Q448 423 440 422 T424 410 Q418 401 413 389 T402 376');
  line.setAttribute('pathLength','1');
  ink.append(line);
  for (const [horizontal,vertical,name] of [[452,452,'黎平'],[403,370,'黔北']] as const) {
    const label=document.createElementNS(ink.namespaceURI!,'text');
    label.setAttribute('x',String(horizontal));label.setAttribute('y',String(vertical));
    label.textContent=name;ink.append(label);
  }
  const cue=element('p','desk-inquiry-cue');
  cue.setAttribute('role','status');
  const indicator=element('span','desk-inquiry-marker');
  indicator.setAttribute('aria-hidden','true');
  const grip=element('span','desk-inquiry-grip','↖');
  grip.setAttribute('aria-hidden','true');
  const range=element('input','desk-inquiry-range');
  range.type='range';range.min='0';range.max=String(last);range.step='1';
  range.setAttribute('aria-label','手记开合');
  range.title='手记开合';
  range.oninput=()=>adjust(range.valueAsNumber);
  range.onchange=settle;
  range.onkeydown=event=>event.stopPropagation();
  frame.append(canvas,ink,indicator,grip,cue);

  function paint(task:DeskInquiry|null, rightPin:readonly number[]) {
    frame.dataset.inquiry=task?.step ?? 'off';
    frame.dataset.opening=String(task?.opening ?? 0);
    if (task && !requested) {requested=true;atlas.src=mediaAssets['desk-leaf'];}
    const handling=!!task && task.step!=='choose';
    const opening=task?.opening ?? 0;
    desired=opening;
    grip.hidden=!handling || task?.step!=='leaf' || opening!==0;
    canvas.hidden=!handling || opening===0;
    if (!canvas.hidden) draw();
    const trace=handling ? Math.min(1,Math.max(0,(opening/last-.56)/.24)) : 0;
    ink.style.display=trace>0?'':'none';
    if (trace>0) {
      line.setAttribute('stroke-dashoffset',String(1-trace));
      ink.style.setProperty('--ink-label',String(Math.max(0,(trace-.52)/.48)));
    }
    indicator.hidden=!task?.needsClue;
    if (!indicator.hidden) {
      indicator.style.left=rightPin[0]*100+'%';
      indicator.style.top=rightPin[1]*100+'%';
    }
    cue.hidden=!task;
    let text='';
    if (task?.step==='choose') text=task.needsClue?'再查会前手记。':'先查哪一册？';
    else if (task?.step==='leaf') text='向左拖开手记。';
    else if (task?.step==='found') text=task.meetingRead?'松手，对照两册。':'再查会议卷宗。';
    else if (task?.step==='done') text='对照会前处境与会议议题。';
    if (cue.textContent!==text) cue.textContent=text;
    range.hidden=!handling || task?.step==='done';
    if (range.valueAsNumber!==opening) range.value=String(opening);
    range.setAttribute('aria-valuetext',Math.round(opening/last*100)+'% 展开');
  }
  function overPage(horizontal:number, vertical:number) {
    return horizontal>=left/sourceWidth && horizontal<=right/sourceWidth && vertical>=top/sourceHeight && vertical<=bottom/sourceHeight;
  }
  function dispose() {
    atlas.onload=null;
    atlas.removeAttribute('src');
    canvas.width=0;
  }
  return {paint,overPage,dispose,range,last};
}
