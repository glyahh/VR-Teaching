function mountStoryShots(camera: HTMLElement, spotlight: HTMLElement, steps: readonly StepItem[]) {
  const shots = new Map<string, HTMLImageElement>();
  for (const { shot } of steps) {
    if (!shot || shots.has(shot)) continue;
    const picture = photo(shot);
    picture.className = 'story-shot';
    picture.dataset.storyShot = shot;
    spotlight.before(picture);
    shots.set(shot, picture);
  }
  return (step?: StepItem) => {
    for (const [shot, picture] of shots) picture.classList.toggle('is-current', shot === step?.shot);
  };
}

function mountOrganizationFolder(stage: HTMLElement, onOpen: () => void) {
  const folder = element('div','organization-folder');
  const cover = control('打开会议卷宗', onOpen, 'organization-cover');
  const leaf = element('div','organization-leaf');
  const date = element('p','organization-date');
  const title = element('strong','organization-finding');
  leaf.append(date,title);
  folder.append(leaf,cover);
  stage.append(folder);
  return (step?: StepItem) => {
    folder.dataset.open = String(Boolean(step));
    cover.inert = Boolean(step);
    leaf.inert = !step;
    if (step) {
      date.textContent = step.date ?? '1935 年 1 月 · 遵义会议';
      title.textContent = step.title;
      animatePart(leaf,[{ opacity: .55, translate: '0 10px' },{ opacity: 1, translate: '0 0' }],250);
    }
  };
}

function mountHouchangMap(stage: HTMLElement, steps: readonly StepItem[], choose: (step: StepItem) => void) {
  const map = element('div','houchang-map');
  map.setAttribute('role','group');
  map.setAttribute('aria-label','从黎平到乌江的行军图');
  const relief = photo('terrain');
  const svg = routeCanvas();
  const fallback = diagramPath('', 'houchang-trail');
  const ink = diagramPath('', 'houchang-ink');
  svg.append(fallback,ink);
  map.append(relief,svg);
  const points = route.slice(6,9).map(position);
  const left = Math.min(...points.map(p=>p[0]))-5;
  const top = Math.min(...points.map(p=>p[1]))-10;
  const width = Math.max(...points.map(p=>p[0]))+5-left;
  const height = Math.max(...points.map(p=>p[1]))+8-top;
  const anchors = points.map(([x,y]):Point=>[(x-left)*100/width,(y-top)*100/height]);
  relief.style.width = 10000/width + '%';
  relief.style.height = 10000/height + '%';
  relief.style.left = -left*100/width + '%';
  relief.style.top = -top*100/height + '%';
  fallback.setAttribute('d',routePath(anchors));
  const pins = steps.map((step,index) => {
    const pin = control('',()=>choose(step),'houchang-pin');
    pin.setAttribute('aria-label',step.title);
    pin.append(element('time','',step.date),element('strong','',step.title));
    pin.dataset.labelSide = ['center','below','above'][index];
    pin.style.left = anchors[index][0] + '%';
    pin.style.top = anchors[index][1] + '%';
    map.append(pin);
    return pin;
  });
  stage.append(map);
  return (id?: string) => {
    const selected = steps.findIndex(step=>step.id===id);
    map.dataset.stop = id ?? '';
    pins.forEach((pin,index)=>pin.setAttribute('aria-pressed', String(index===selected)));
    ink.setAttribute('d',selected > 0 ? routePath(anchors.slice(0,selected+1)) : '');
    if (selected > 0) drawLine(ink,0,480);
  };
}
