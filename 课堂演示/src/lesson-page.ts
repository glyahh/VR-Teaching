function sceneSoundOf(eventId: string, page: LessonPage): SoundScene {
  if (page.activity === 'materials') return 'desk';
  if (page.image === 'wujiang') return 'wujiang';
  if (eventId === 'yudu') return 'yudu';
  if (eventId === 'xiang') return 'xiang';
  if (eventId === 'liping') return 'liping';
  return 'zunyi-room';
}

function chapterNav(current: number, jump: (index: number) => void) {
  const nav = element('nav','chapter-nav chapter-rail chapter-rail--tabs');
  nav.setAttribute('aria-label','章节导航');
  events.forEach((event, index) => {
    const button = lessonControl('chapter-'+index,event.name, () => jump(index),'chapter-link');
    if (index === current) button.setAttribute('aria-current','step');
    nav.append(button);
  });
  return nav;
}

function openScene(position: number, variant: LessonMode = 'lesson', returnToReview?: () => void,
  handoff?: HTMLImageElement | SceneTourEnd) {
  const matchedFrame = handoff instanceof HTMLImageElement ? handoff : undefined;
  const filmEnd = handoff instanceof HTMLImageElement ? undefined : handoff;
  const departingPage = currentView.kind === 'scene' ? chapterPages[currentView.position]?.page : null;
  const arriving = chapterPages[position].page;
  const spatial = departingPage ? findSpatialJourney(departingPage.title, arriving.title) : undefined;
  const deskDeparture = arriving.activity === 'materials' && departingPage?.video?.key === 'zunyi'
    ? captureDeskDeparture() : undefined;
  const riverHandoff = arriving.image === 'yudu' ? captureExplorationView('yudu-river') : undefined;
  releaseCurrentPage({keepDeskPrewarm: arriving.activity === 'materials'});
  const priorImage = app.querySelector<HTMLImageElement>('.scene-media img');
  const priorChapter = app.querySelector<HTMLElement>('.classroom-slide')?.dataset.chapter;
  const { event, chapter, page } = chapterPages[position];
  selectedChapter = chapter;
  lastViewed.set(chapter,position);
  courseHarness.recordVisit(page.title);
  soundscape.setScene(sceneSoundOf(event.id, page), 0.85);

  const liveDesk = page.activity === 'materials';
  const xiangTour = page.activity === 'crossing';
  const scene = element('section','scene classroom-slide');
  if (liveDesk) scene.classList.add('desk-live-page');
  scene.dataset.chapter = String(chapter);
  if (page.activity) scene.dataset.activity = page.activity;

  const stage = element('div','scene-stage');
  const media = element('div','scene-media');
  const camera = element('div','scene-camera');
  const spotlight = element('div','scene-spotlight');
  spotlight.setAttribute('aria-hidden','true');
  const shade = element('div','scene-shade');
  const picture = matchedFrame ?? (liveDesk ? element('img') : photo(page.image,page.title));
  const captionText = element('div','caption-copy');
  const lesson = currentSceneLesson = mountSceneLesson(scene,captionText,page);
  if (!liveDesk) {
    camera.append(picture,spotlight);
    if (page.video?.mode !== 'loop' && !xiangTour) attachCinemagraph(page.image, picture);
    media.append(camera,shade);
  }

  const registerDismiss = (fn: () => void) => {
    const prev = onStageDismiss;
    onStageDismiss = () => {
      activeSceneCue = undefined;
      prev?.();
      fn();
    };
  };
  let pauseVideo = () => {};
  const tools = element('div','scene-actions');
  const tour = xiangTour ? mountSceneTour({id: 'xiang', scene, stage, tools, signal: lesson.signal,
    onEnded: end => {
      recordLessonProgress(revealed,'xiang-tour');
      turn(1,end);
    }})
    : page.exploration === 'yudu-river'
      ? mountSceneTour({id: 'yudu-river', scene, stage, tools, signal: lesson.signal})
      : undefined;
  if (tour) pauseVideo = tour.pause;
  if (page.video) {
    let movieAdvance: HTMLButtonElement | undefined;
    if (page.video.mode === 'transition') {
      const destination = chapterPages[position+1].page;
      const landing = photo(destination.image,destination.title);
      const decoded = landing.decode().then(()=>landing,()=>undefined);
      movieAdvance = lessonControl('clip-next','',async()=>{
        const frame = await decoded;
        if (movieAdvance?.isConnected && currentVideo?.read().mode === 'playing') turn(1,frame);
      });
      movieAdvance.hidden = true;
      tools.append(movieAdvance);
    }
    currentVideo = attachVideo(page.video,page.image,camera,tools,{
      align: () => lesson.dismissPoint(),
      advance: () => movieAdvance?.click(),
    });
    pauseVideo = currentVideo.pause;
  }
  if (page.video?.key==='zunyi') {
    camera.append(lessonControl('visit-meeting-desk','进入会议桌实景',()=>{
      pauseVideo();
      openScene(position+1,variant,returnToReview);
    },'desk-scene-link','layers'));
  }

  const leave = ()=>{
    pauseVideo();
    if (returnToReview) returnToReview();
    else renderMap(true);
  };
  const jump = (index: number)=>{
    pauseVideo();
    openChapter(index,variant,returnToReview);
  };
  const heading = element('header','scene-head');
  const identity = element('div','scene-identity');
  const title = element('h1','course-title',page.title);
  title.tabIndex = -1;
  const location = page.title === '猴场会议' ? '贵州瓮安 · 1935 年 1 月 1 日'
    : page.image === 'wujiang' ? '贵州乌江 · 1935 年 1 月初' : event.place+' · '+event.date;
  identity.append(title,element('p','scene-date',location));
  const back = lessonControl('map',returnToReview ? '返回回顾' : '地图',leave,'','arrowLeft');
  if (!returnToReview) setIconButton(back,'地图','map');
  tools.append(soundButton());
  tools.append(fullscreenButton(),back);
  mountCourseDeveloperButton(tools);
  heading.append(identity,tools);

  let practiceFocus = '';
  let showPracticeReference: ((focus: PracticeQuestion['focus']) => void) | undefined;
  let openTroopRecords: (() => boolean) | undefined;
  let compareLipingRoutes: ((side: 'east' | 'west' | 'both') => boolean) | undefined;
  let disposeSandbox: (() => void) | undefined;
  const directorBanner = courseHarness.mountDirectorBanner(stage);
  const disposeDirectorTrigger = courseHarness.mountDirectorTrigger(scene, tools);

  function setCamera(fx = 50, fy = 50, scale = 1, spot = false) {
    const tx = Math.min(0, Math.max(100 * (1 - scale), 50 - fx * scale));
    const ty = Math.min(0, Math.max(100 * (1 - scale), 48 - fy * scale));
    camera.style.transform = `translate(${tx}%, ${ty}%) scale(${scale})`;
    spotlight.style.setProperty('--spot-x', fx + '%');
    spotlight.style.setProperty('--spot-y', fy + '%');
    spotlight.classList.toggle('is-active', spot);
  }

  if (page.camera) {
    setCamera(page.camera.x, page.camera.y, page.camera.scale, true);
  }

  for (const probe of page.probes ?? []) {
    addHotspot(`${probe.label}：${probe.title}`, probe.id, [probe.x,probe.y], {
      text: probe.detail,
      enter: () => setCamera(probe.x, probe.y, probe.zoom ?? 1.38, true),
    }, 'probe-pin');
  }

  // ---- 2. Bridge structural outlines (浮桥近景) ----
  if (page.activity === 'bridge') {
    const outlines = document.createElementNS(svgNamespace,'svg');
    outlines.setAttribute('class','bridge-outlines');
    outlines.setAttribute('viewBox','0 0 100 100');
    outlines.setAttribute('preserveAspectRatio','none');
    outlines.setAttribute('aria-hidden','true');
    camera.append(outlines);
    const parts: [string,string,Point,string,string][] = [
      ['船体','boat',[28,65],'M 9 42 Q 11 57 32 59 L 57 61 Q 49 78 39 84 Q 13 79 9 54 Z','木船托住桥面。船舷上的纵梁把船和桥板连在一起。'],
      ['桥板','plank',[73,46],'M 41 39 L 97 36 L 99 57 Q 70 49 45 45 Z','木板铺成通道。乡亲们送来的门板和木料就用在桥面上。'],
    ];
    parts.forEach(([label,key,point,shape,text])=>{
      const outline = diagramPath(shape,'bridge-outline');
      outline.dataset.part = key;
      outline.classList.toggle('is-drawn',revealed.has(key));
      outlines.append(outline);
      addHotspot(label,key,point,{
        text,
        enter(animate) {
          practiceFocus = key;
          outline.classList.add('is-drawn');
          setCamera(point[0], point[1], 1.14, true);
          if (animate) drawLine(outline,0,450);
        },
      });
    });
  }

  if (page.activity === 'troops') {
    const approach = photo('xiang-ford');
    approach.className = 'story-shot';
    spotlight.before(approach);
    const returnToBank = lessonControl('xiang-reflect', '回望渡口', () => {
      if (!lesson.dismissPoint()) lesson.explain('xiang-reflection');
    }, 'journey-control');
    lesson.addCue('xiang-reflection', {
      text: '有人留在险处，把过江的时间让给战友。渡江以后，红军要带着这些教训继续往前走。',
      enter() {
        approach.classList.add('is-current');
        returnToBank.setAttribute('aria-pressed','true');
        setButtonContent(returnToBank,'回到岸上');
        soundscape.playSfx('route');
      },
      leave() {
        approach.classList.remove('is-current');
        returnToBank.setAttribute('aria-pressed','false');
        setButtonContent(returnToBank,'回望渡口');
      },
    });
    returnToBank.setAttribute('aria-pressed','false');
    const records = lessonControl('xiang-records','查兵力记录', () => {
      const dates = element('dl','xiang-records');
      for (const {date,label,amount} of troopRecords) {
        const row = element('div');
        row.append(element('dt','',date+' · '+label),element('dd','',amount));
        dates.append(row);
      }
      modal('长征出发与渡过湘江后的兵力', dates,
        element('p','','两组数字跨越从出发到渡江后的整段行程。其间的累计减员包含湘江战役前的损失。'));
    },'journey-control');
    tools.prepend(returnToBank, records);
    openTroopRecords = () => {
      records.click();
      return dialog.open && Boolean(dialog.querySelector('dl.xiang-records'));
    };
  }

  // ---- 5. Liping Tabletop Perspective Map (进军方向) ----
  if (page.activity === 'directions') {
    const paper = element('div','tabletop-paper');
    const svg = document.createElementNS(svgNamespace,'svg');
    svg.setAttribute('viewBox','0 0 100 100');
    svg.setAttribute('preserveAspectRatio','none');
    svg.setAttribute('aria-hidden','true');
    const eastLine = diagramPath('M 50 84 Q 65 73 82 26 L 76 30 M 82 26 L 84 34','paper-line east');
    const westLine = diagramPath('M 50 84 Q 35 73 19 26 L 17 34 M 19 26 L 25 30','paper-line west');
    svg.append(eastLine, westLine);
    const guideEast = diagramPath('M 50 84 Q 65 73 82 26','paper-guide');
    const guideWest = diagramPath('M 50 84 Q 35 73 19 26','paper-guide');
    svg.append(guideEast,guideWest);
    const marker = element('button','march-marker');
    marker.type = 'button';
    marker.append(element('span','march-marker-arrow'));
    marker.setAttribute('role','slider');
    marker.setAttribute('aria-label','行军标记');
    marker.setAttribute('aria-valuemin','-100');
    marker.setAttribute('aria-valuemax','100');

    const originNode = element('span','paper-node origin','黎平');
    const eastNode = element('span','paper-node east');
    eastNode.innerHTML = '<em>原计划</em><strong>湘西北（险）</strong>';
    const westNode = element('span','paper-node west');
    westNode.innerHTML = '<em>会议决定</em><strong>贵州北部</strong>';

    let comparing = false;
    function paintRoutes() {
      const east = comparing || revealed.has('direction-east');
      const west = comparing || revealed.has('direction-west');
      eastLine.classList.toggle('is-drawn',east);
      westLine.classList.toggle('is-drawn',west);
      eastNode.hidden = !east;
      westNode.hidden = !west;
    }
    showPracticeReference = cue=>{
      comparing = cue === 'routes';
      paintRoutes();
    };
    paintRoutes();

    paper.append(svg, originNode, eastNode, westNode,marker);
    camera.append(paper);

    const deck = element('div','tabletop-deck');
    lesson.addCue('direction-east', {text: '原计划去湘西北与红二、红六军团会合，沿途有敌军重兵堵截。'});
    lesson.addCue('direction-west', {text: '会议决定转向敌军力量较弱的贵州北部，争取主动。'});
    lesson.addCue('directions-both', {text: '原计划北上会合，黎平会议决定改向贵州北部。'});
    const directionNote = (key: string) => lesson.explain(
      revealed.has('direction-west') && revealed.has('direction-east') ? 'directions-both' : key);
    const btnEast = lessonControl('direction-east','推演原计划 · 湘西北',()=>{
      recordLessonProgress(revealed,'direction-east');
      updateMarch(100);
      paintRoutes();
      btnEast.setAttribute('aria-pressed','true');
      btnWest.setAttribute('aria-pressed','false');
      drawLine(eastLine,0,480);
      appear(eastNode,350,240);
      directionNote('direction-east');
    },'deck-btn','compass');
    const btnWest = lessonControl('direction-west','推演新方向 · 贵州北部',()=>{
      recordLessonProgress(revealed,'direction-west');
      updateMarch(-100);
      paintRoutes();
      btnWest.setAttribute('aria-pressed','true');
      btnEast.setAttribute('aria-pressed','false');
      drawLine(westLine,0,480);
      appear(westNode,350,240);
      directionNote('direction-west');
    },'deck-btn is-gold','compass');
    btnEast.setAttribute('aria-pressed', String(routeOffset > 0));
    btnWest.setAttribute('aria-pressed', String(routeOffset < 0));
    deck.append(btnEast,btnWest);
    stage.append(deck);
    disposeSandbox = courseHarness.mountLipingSandbox({
      stage,
      paper,
      svg,
      deck,
      onRestoreRealRoute: () => {
        btnWest.click();
        return btnWest.getAttribute('aria-pressed') === 'true';
      },
    });
    compareLipingRoutes = side => {
      if (side === 'east') { btnEast.click(); return btnEast.getAttribute('aria-pressed') === 'true'; }
      if (side === 'west') { btnWest.click(); return btnWest.getAttribute('aria-pressed') === 'true'; }
      recordLessonProgress(revealed, 'direction-east');
      recordLessonProgress(revealed, 'direction-west');
      comparing = true;
      paintRoutes();
      drawLine(eastLine, 0, 480);
      drawLine(westLine, 120, 480);
      appear(eastNode, 260, 240);
      appear(westNode, 340, 240);
      directionNote('directions-both');
      return comparing;
    };

    function updateMarch(progress: number, broadcast = false) {
      routeOffset = Math.round(Math.max(-100, Math.min(100,progress)));
      const east = routeOffset > 0;
      const direction = east ? '原计划 · 湘西北' : '会议决定 · 黔北';
      marker.setAttribute('aria-valuenow',String(routeOffset));
      marker.setAttribute('aria-valuetext',routeOffset ? direction : '黎平');
      if (routeOffset) recordLessonProgress(revealed,east ? 'direction-east' : 'direction-west');
      paintRoutes();
      const guide = east ? guideEast : guideWest;
      const track = guide.getTotalLength();
      const step = guide.getPointAtLength(track*Math.abs(routeOffset)/100);
      marker.style.left = step.x + '%';
      marker.style.top = step.y + '%';
      marker.dataset.side = routeOffset === 0 ? 'origin' : east ? 'east' : 'west';
    }
    updateMarch(routeOffset);

    {
      let pointer: {id:number, x:number, initial:number, span:number} | undefined;
      marker.addEventListener('pointerdown',event=>{
        if (!event.isPrimary || event.button!==0) return;
        pointer = {id:event.pointerId, x:event.clientX, initial:routeOffset, span:Math.max(52,paper.getBoundingClientRect().width*.32)};
        marker.setPointerCapture(event.pointerId);
      });
      marker.addEventListener('pointermove',event=>{
        if (pointer?.id === event.pointerId) updateMarch(pointer.initial+(event.clientX-pointer.x)*100/pointer.span,true);
      });
      for (const name of ['pointerup','pointercancel','lostpointercapture']) {
        marker.addEventListener(name,event=>{ if ((event as PointerEvent).pointerId===pointer?.id) pointer=undefined; });
      }
      marker.addEventListener('keydown',event=>{
        const values: Record<string,number> = {ArrowLeft:routeOffset-10, ArrowRight:routeOffset+10, Home:0};
        if (!Object.hasOwn(values,event.key)) return;
        event.preventDefault();
        updateMarch(values[event.key],true);
      });
    }
    registerDismiss(()=>{
      btnEast.setAttribute('aria-pressed', 'false');
      btnWest.setAttribute('aria-pressed', 'false');
    });
  }

  if (liveDesk) {
    currentDesk = mountDesk(stage,position,deskDeparture);
    registerDismiss(()=>currentDesk?.dismiss());
  }

  if (page.activity === 'wujiang-view') mountWujiangView(stage,tools,near=>{
    if (near) setCamera(59,73,1.32,true);
    else setCamera();
  });

  if (page.activity === 'military' || page.activity === 'result') {
    lesson.mountItems(stage,page,mountStoryShots(camera,spotlight,page.steps));
  }
  if (page.activity === 'organization') {
    const showFolder = mountOrganizationFolder(stage,()=>selectItem(page.steps[0].id));
    const selectItem = lesson.mountItems(stage,page,showFolder);
  }
  if (page.activity === 'houchang') {
    const showStop = mountHouchangMap(stage,page.steps,step=>lesson.explain(step.id));
    for (const step of page.steps) lesson.addCue(step.id,{
      text: step.detail,
      enter() {
        activeSceneCue = step.id;
        recordLessonProgress(revealed,step.id);
        showStop(step.id);
      },
      leave() {
        activeSceneCue = undefined;
        showStop();
      },
    });
  }

  const navigation = element('div','scene-navigation');
  const previous = lessonControl('previous','上一页',()=>turn(-1),'','arrowLeft');
  setIconButton(previous,'上一页','arrowLeft');
  const finalPage = position === chapterPages.length-1;
  const lastInChapter = chapterPages[position+1]?.chapter !== chapter;
  previous.disabled = variant !== 'lesson' && position === chapterStarts[chapter];
  const nextLabel = variant === 'revisit' && lastInChapter ? '返回回顾'
    : finalPage ? '课堂回顾' : '下一页';
  const next = lessonControl('next',nextLabel,()=>turn(1),'primary','arrowRight',true);
  if (nextLabel === '下一页') setIconButton(next,nextLabel,'arrowRight');
  navigation.append(previous);
  navigation.append(next);

  if (liveDesk) {
    stage.setAttribute('aria-label','遵义会议桌实景');
  } else {
    stage.append(media);
  }

  const bottom = element('section','slide-caption');
  const footer = element('footer','lesson-footer');
  const caption = liveDesk && currentDesk ? currentDesk.transport : captionText;
  bottom.append(caption);
  if (page.practice) {
    currentPractice = mountPractice(page.practice,scene,caption,()=>practiceFocus,showPracticeReference);
    bottom.append(currentPractice.panel);
    navigation.insertBefore(currentPractice.entry,next);
  }
  const rail = element('div','bottom-rail lesson-bottom-rail');
  if (variant === 'lesson') rail.append(chapterNav(chapter,jump));
  rail.append(navigation);
  if (tour) footer.append(tour.caption);
  footer.append(bottom,rail);
  scene.append(stage, heading, footer);
  app.replaceChildren(scene);
  courseHarness.setActiveScene({
    pageTitle: page.title,
    focusHotspot: key => lesson.explain(key),
    compareLiping: compareLipingRoutes,
    openTroopRecords,
    showDirectorBanner: text => directorBanner.show(text),
  });
  lesson.signal.addEventListener('abort', () => {
    disposeDirectorTrigger();
    directorBanner.dispose();
    disposeSandbox?.();
    courseHarness.setActiveScene(undefined);
  }, { once: true });
  syncCinemagraphReading();
  if (page.exploration) {
    const backdrop = page.video?.mode === 'loop' ? undefined : {key: page.image, image: picture};
    const openDesk = page.exploration === 'zunyi-hall' && chapterPages[position+1]?.page.activity === 'materials'
      ? () => openScene(position+1,variant,returnToReview)
      : undefined;
    mountExplorationPage({id: page.exploration, scene, stage, tools, bottom:footer,
      pauseMedia: pauseVideo, backdrop, openDesk});
  }
  displayView({kind:'scene',position,variant});

  const sizeMedia = ()=>{
    media.style.width = Math.max(stage.clientWidth,stage.clientHeight*16/9)+'px';
    const clearance = footer.offsetHeight ? stage.getBoundingClientRect().bottom - footer.getBoundingClientRect().top : 0;
    stage.style.setProperty('--story-bottom',Math.max(16,clearance + 12)+'px');
  };
  if (!liveDesk) {
    pageResize = new ResizeObserver(sizeMedia);
    pageResize.observe(stage);
    pageResize.observe(footer);
    sizeMedia();
  }
  pageButtons = {previous,next};
  title.focus({preventScroll:true});
  const filmExit = filmEnd && playSceneTourExit(filmEnd,stage,picture,lesson.signal);
  if (riverHandoff) playRiverExit(scene,riverHandoff);
  else if (!filmEnd && !spatial && !matchedFrame && !liveDesk && priorImage?.complete && priorImage.naturalWidth && priorImage.getAttribute('src') !== picture.getAttribute('src') && !reducedMotion.matches) {
    const old = element('img','outgoing-image');
    old.src = priorImage.src;
    old.alt = '';
    old.setAttribute('aria-hidden','true');
    spotlight.before(old);
    const fade = animatePart(old,[{opacity:1},{opacity:0}],380);
    const remove = ()=>old.remove();
    if (fade) fade.finished.then(remove,remove);
    else remove();
  } else if (!filmEnd && !spatial && !matchedFrame && !liveDesk && priorImage?.getAttribute('src') !== picture.getAttribute('src')) {
    animatePart(picture,[{opacity:.62},{opacity:1}],340);
  }
  if (!liveDesk) {
    camera.querySelectorAll('.hotspot,.probe-pin').forEach((spot,index)=>appear(spot,220+index*75,260));
    const activeChapter = footer.querySelector('[aria-current="step"]');
    if (activeChapter && priorChapter !== String(chapter)) {
      animatePart(activeChapter,[{backgroundColor:'#e8c48552'},{backgroundColor:'#e8c48514'}],380,220);
    }
  }
  const entranceImage = liveDesk ? stage.querySelector<HTMLImageElement>('.desk-live-still') ?? undefined : picture;
  lesson.enter(journey => {
    const finished = journey && playSpatialJourney(scene, journey, lesson.signal);
    startPageEntry(scene, [[identity,'left'],[tools,'right'],[footer,'bottom']],entranceImage,
      {after: filmExit ?? finished, onLayoutReady: () => {
        lesson.start();
        if (page.video?.key === 'zunyi') prewarmDesk(stage,position+1);
      }});
  }, spatial && !reducedMotion.matches ? { id: spatial, startedAt: sceneNow() } : undefined);

  function addHotspot(label: string, key: string, [x,y]: Point, cue: Pick<SceneCue,'text'|'enter'>, className = 'hotspot') {
    const spot = explorationStage.markScenePoint(control('',()=>lesson.explain(key),className),label);
    spot.dataset.lessonCue = key;
    lesson.addCue(key,{
      text: cue.text,
      enter(animate) {
        recordLessonProgress(revealed,key);
        spot.dataset.visited = 'true';
        spot.dataset.active = 'true';
        spot.dataset.dismissed = 'true';
        cue.enter?.(animate);
      },
      leave() {
        spot.dataset.active = 'false';
        spot.dataset.dismissed = 'false';
        const {x = 50, y = 50, scale = 1} = page.camera ?? {};
        setCamera(x,y,scale,!!page.camera);
      },
    });
    spot.style.left = x+'%';
    spot.style.top = y+'%';
    spot.dataset.visited = String(revealed.has(key));
    spot.dataset.active = 'false';
    camera.append(spot);
  }

  function turn(direction: number, frame?: HTMLImageElement | SceneTourEnd) {
    if (direction < 0 && previous.disabled) return;
    pauseVideo();
    if (position+direction < 0 || (direction > 0 && variant === 'revisit' && lastInChapter)) leave();
    else if (direction > 0 && finalPage) openReview();
    else openScene(position+direction,variant,returnToReview,frame);
  }
}
