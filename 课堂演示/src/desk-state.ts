type DeskPose = {yaw:number; pitch:number; zoom:number};
type DeskPoint = {x:number; z:number};
type DeskMaterial = 'before' | 'discussion';
type DeskSheet = {id:DeskMaterial; at:DeskPoint};
type DeskEvidence = 'none' | 'left' | 'right' | 'both';
type DeskMap = 'stored' | 'original' | 'revised' | 'both';
type DeskDossier = 'sealed' | 'untied' | 'open';
type DeskSaved = Readonly<{
  camera:DeskPose;
  spread:number;
  dossier:DeskDossier;
  sheets:readonly DeskSheet[];
  map:DeskMap;
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
  evidence:DeskEvidence;
  investigating:boolean;
  carried:boolean;
}>;

const deskMaterials = ['before','discussion'] as const;
const deskSpreads = 4;
const deskHome = ():DeskPose => ({yaw:0,pitch:0,zoom:1});

function freshDesk():DeskSaved {
  return {camera:deskHome(),spread:0,dossier:'sealed',sheets:[],map:'stored'};
}
function deskClamp(value:number,min:number,max:number) {
  return Math.min(max,Math.max(min,value));
}
function deskCamera(pose:DeskPose):DeskPose {
  return {yaw:deskClamp(pose.yaw,-18,18),pitch:deskClamp(pose.pitch,-5,6),zoom:deskClamp(pose.zoom,.92,1.28)};
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
    case 'map': return {...saved,map:saved.map==='stored'?'original':'stored'};
    case 'overlay': return saved.map==='stored' ? saved : {...saved,map:saved.map==='both'?'original':'both'};
  }
}

function isDeskMaterial(value:unknown):value is DeskMaterial {
  return value==='before' || value==='discussion';
}
function isDeskPose(value:unknown):value is DeskPose {
  if (!value || typeof value!=='object') return false;
  const pose=value as DeskPose;
  return Number.isFinite(pose.yaw) && Number.isFinite(pose.pitch) && Number.isFinite(pose.zoom) &&
    pose.yaw>=-18 && pose.yaw<=18 && pose.pitch>=-5 && pose.pitch<=6 && pose.zoom>=.92 && pose.zoom<=1.28;
}
function isDeskPoint(value:unknown):value is DeskPoint {
  if (!value || typeof value!=='object') return false;
  const point=value as DeskPoint;
  return Number.isFinite(point.x) && Number.isFinite(point.z) && Math.abs(point.x)<=4 && Math.abs(point.z)<=4;
}
function isDeskGesture(value:unknown):value is DeskGesture {
  if (!value || typeof value!=='object' || !('kind' in value)) return false;
  const gesture=value as DeskGesture;
  if (gesture.kind==='camera') return isDeskPose(gesture.pose);
  if (gesture.kind==='inspect') return isDeskMaterial(gesture.id);
  if (gesture.kind==='sheet') return isDeskMaterial(gesture.id) && isDeskPoint(gesture.at) &&
    Number.isFinite(gesture.lift) && gesture.lift>=0 && gesture.lift<=1;
  if (!Number.isFinite(gesture.progress) || gesture.progress<0 || gesture.progress>1) return false;
  if (gesture.kind==='page') return gesture.direction==='forward' || gesture.direction==='back';
  return ['cord','cover','map','overlay'].includes(gesture.kind);
}
function isDeskView(value:unknown):value is DeskView {
  if (!value || typeof value!=='object') return false;
  const view=value as DeskView;
  const saved=view.saved;
  return !!saved && isDeskPose(saved.camera) && Number.isInteger(saved.spread) && saved.spread>=0 && saved.spread<=deskSpreads &&
    ['sealed','untied','open'].includes(saved.dossier) && ['stored','original','revised','both'].includes(saved.map) &&
    Array.isArray(saved.sheets) && saved.sheets.length<=deskMaterials.length &&
    saved.sheets.every(sheet=>sheet && isDeskMaterial(sheet.id) && isDeskPoint(sheet.at)) &&
    new Set(saved.sheets.map(sheet=>sheet.id)).size===saved.sheets.length &&
    ['none','left','right','both'].includes(view.evidence) && typeof view.investigating==='boolean' &&
    typeof view.carried==='boolean' && (view.preview===undefined || isDeskGesture(view.preview));
}
