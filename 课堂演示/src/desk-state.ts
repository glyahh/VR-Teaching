type DeskPose = {yaw:number; pitch:number; zoom:number};
type DeskPoint = {x:number; z:number};
type DeskMaterial = 'before' | 'discussion';
type DeskSheet = {id:DeskMaterial; at:DeskPoint};
type DeskMap = 'stored' | 'original' | 'revised' | 'both';
type DeskDossier = 'sealed' | 'untied' | 'open';
type DeskObject = 'journal' | 'dossier' | 'map';
type DeskRouteMode = Exclude<DeskMap,'stored'> | 'parallel';
type DeskReading =
  | {kind:'journal'|'dossier'}
  | {kind:'compare'; clueIndex?:number}
  | {kind:'sheet'; id:DeskMaterial}
  | {kind:'map'; mode:DeskRouteMode; drawAt:number}
  | {kind:'clue'; index:number; source:'map'|'journal'};
type DeskFocus = DeskPoint & {amount:number};
type DeskSaved = Readonly<{
  camera:DeskPose;
  spread:number;
  dossier:DeskDossier;
  sheets:readonly DeskSheet[];
  map:DeskMap;
  routeReading?:DeskRouteMode;
  seen?:readonly DeskObject[];
}>;
type DeskGesture =
  | {kind:'page'; direction:'forward'|'back'; progress:number}
  | {kind:'cord'|'cover'|'map'|'overlay'; progress:number}
  | {kind:'sheet'; id:DeskMaterial; at:DeskPoint; lift:number}
  | {kind:'inspect'; id:DeskMaterial}
  | {kind:'camera'; pose:DeskPose};
type DeskView = Readonly<{
  saved:DeskSaved;
  preview?:DeskGesture;
  reading?:DeskReading;
  camera?:DeskPose;
  focus?:DeskFocus;
}>;

const deskMaterials = ['before','discussion'] as const;
const deskSpreads = explorationStage.deskNotebook.length;
const deskObjects = ['journal','dossier','map'] as const;
const deskRouteModes = ['original','revised','both','parallel'] as const;
const deskHome = ():DeskPose => ({yaw:0,pitch:0,zoom:1});

function freshDesk():DeskSaved {
  return {camera:deskHome(),spread:0,dossier:'sealed',sheets:[],map:'stored'};
}
function deskClamp(value:number,min:number,max:number) {
  return Math.min(max,Math.max(min,value));
}
function deskCamera(pose:DeskPose):DeskPose {
  return {yaw:deskClamp(pose.yaw,-18,18),pitch:deskClamp(pose.pitch,-5,16),zoom:deskClamp(pose.zoom,.92,1.28)};
}

function placeDeskSheet(saved:DeskSaved,sheet:DeskSheet):DeskSaved {
  return {...saved,sheets:[...saved.sheets.filter(other=>other.id!==sheet.id),{id:sheet.id,at:{...sheet.at}}]};
}

function settleDesk(saved:DeskSaved,gesture:DeskGesture):DeskSaved {
  if (gesture.kind==='camera') return {...saved,camera:gesture.pose};
  if (gesture.kind==='sheet') return placeDeskSheet(saved,gesture);
  if (gesture.kind==='inspect' || gesture.progress<.43) return saved;
  switch (gesture.kind) {
    case 'page': return {...saved,spread:deskClamp(saved.spread+(gesture.direction==='forward'?1:-1),0,deskSpreads)};
    case 'cord': return saved.dossier==='sealed' ? {...saved,dossier:'untied'} : saved;
    case 'cover': return saved.dossier==='untied' ? {...saved,dossier:'open'} : saved;
    case 'map': return {...saved,map:saved.map==='stored'?'original':'stored',routeReading:undefined};
    case 'overlay': return saved.map==='stored' ? saved : {...saved,map:saved.map==='both'?'original':'both',routeReading:undefined};
  }
}

function isDeskMaterial(value:unknown):value is DeskMaterial {
  return value==='before' || value==='discussion';
}
function isDeskPose(value:unknown):value is DeskPose {
  return !!value && typeof value==='object' && 'yaw' in value && 'pitch' in value && 'zoom' in value &&
    typeof value.yaw==='number' && value.yaw>=-18 && value.yaw<=18 &&
    typeof value.pitch==='number' && value.pitch>=-5 && value.pitch<=16 &&
    typeof value.zoom==='number' && value.zoom>=.92 && value.zoom<=1.28;
}
function isDeskPoint(value:unknown):value is DeskPoint {
  return !!value && typeof value==='object' && 'x' in value && 'z' in value &&
    typeof value.x==='number' && Math.abs(value.x)<=4 && typeof value.z==='number' && Math.abs(value.z)<=4;
}
function isDeskGesture(value:unknown):value is DeskGesture {
  if (!value || typeof value!=='object' || !('kind' in value)) return false;
  if (value.kind==='camera') return 'pose' in value && isDeskPose(value.pose);
  if (value.kind==='inspect') return 'id' in value && isDeskMaterial(value.id);
  if (value.kind==='sheet') return 'id' in value && isDeskMaterial(value.id) && 'at' in value && isDeskPoint(value.at) &&
    'lift' in value && typeof value.lift==='number' && value.lift>=0 && value.lift<=1;
  if (!('progress' in value) || typeof value.progress!=='number' || !(value.progress>=0 && value.progress<=1)) return false;
  if (value.kind==='page') return 'direction' in value && (value.direction==='forward' || value.direction==='back');
  return value.kind==='cord' || value.kind==='cover' || value.kind==='map' || value.kind==='overlay';
}
function isDeskReading(value:unknown):value is DeskReading {
  if (!value || typeof value!=='object' || !('kind' in value)) return false;
  if (value.kind==='sheet') return 'id' in value && isDeskMaterial(value.id);
  const mode='mode' in value ? value.mode : undefined;
  if (value.kind==='map') return deskRouteModes.some(option=>option===mode) &&
    'drawAt' in value && typeof value.drawAt==='number' && Number.isSafeInteger(value.drawAt) && value.drawAt>=0;
  const validIndex=(index:unknown)=>typeof index==='number' && Number.isSafeInteger(index) && index>=0 && index<=32;
  if (value.kind==='clue') return 'index' in value && validIndex(value.index) && 'source' in value &&
    (value.source==='map' || value.source==='journal');
  if (value.kind==='compare') return !('clueIndex' in value) || value.clueIndex===undefined || validIndex(value.clueIndex);
  return value.kind==='journal' || value.kind==='dossier';
}
function isDeskSaved(value:unknown):value is DeskSaved {
  if (!value || typeof value!=='object' || !('camera' in value) || !isDeskPose(value.camera)) return false;
  const dossier='dossier' in value ? value.dossier : undefined;
  const map='map' in value ? value.map : undefined;
  const routeReading='routeReading' in value ? value.routeReading : undefined;
  return 'spread' in value && typeof value.spread==='number' && Number.isInteger(value.spread) &&
    value.spread>=0 && value.spread<=deskSpreads &&
    ['sealed','untied','open'].some(state=>state===dossier) &&
    ['stored','original','revised','both'].some(mode=>mode===map) &&
    (routeReading===undefined || deskRouteModes.some(mode=>mode===routeReading)) &&
    'sheets' in value && Array.isArray(value.sheets) && value.sheets.length<=deskMaterials.length &&
    value.sheets.every(sheet=>sheet && isDeskMaterial(sheet.id) && isDeskPoint(sheet.at)) &&
    new Set(value.sheets.map(sheet=>sheet.id)).size===value.sheets.length &&
    (!('seen' in value) || value.seen===undefined || Array.isArray(value.seen) &&
      value.seen.length<=deskObjects.length && value.seen.every(item=>deskObjects.some(object=>object===item)));
}
function isDeskView(value:unknown):value is DeskView {
  return !!value && typeof value==='object' && 'saved' in value && isDeskSaved(value.saved) &&
    (!('preview' in value) || value.preview===undefined || isDeskGesture(value.preview)) &&
    (!('reading' in value) || value.reading===undefined || isDeskReading(value.reading)) &&
    (!('camera' in value) || value.camera===undefined || isDeskPose(value.camera)) &&
    (!('focus' in value) || value.focus===undefined || isDeskPoint(value.focus) &&
      'amount' in value.focus && typeof value.focus.amount==='number' && value.focus.amount>=0 && value.focus.amount<=1);
}
