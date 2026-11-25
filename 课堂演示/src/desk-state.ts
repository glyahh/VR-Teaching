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
