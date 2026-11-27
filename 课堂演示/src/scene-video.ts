type VideoState = {mode:'static'|'paused'|'playing'; time:number; at?:number};

function attachVideo(clip: LessonClip, image: string, media: HTMLElement, tools: HTMLElement,
  {align, advance}: {align?: () => void; advance?: () => void} = {}) {
  const background = clip.mode === 'loop';
  const video = element('video');
  video.src = mediaAssets[clip.key+'-video'];
  video.poster = mediaAssets[image];
  video.preload = 'auto';
  video.muted = clip.mode !== 'opening';
  video.playsInline = true;
  video.loop = background;
  video.hidden = true;
  media.querySelector('.scene-spotlight')!.before(video);
  let generation = 0;
  let intent: VideoState = {mode:'static',time:0};
  let posterFade: Animation | undefined;
  const startLabel = clip.mode === 'transition' ? '播放备桥短片' : '播放短片';
  const cutLabel = clip.mode === 'transition' ? element('span','scene-shot-label',clip.caption.text) : undefined;
  if (cutLabel && clip.mode === 'transition') {
    cutLabel.hidden = true;
    media.append(cutLabel);
    const {start,end} = clip.caption;
    video.addEventListener('timeupdate',()=>{
      cutLabel.hidden = video.hidden || video.currentTime < start || video.currentTime >= end;
    });
  }
  function targetTimeOf(state: VideoState) {
    if (state.mode !== 'playing' || typeof state.at !== 'number' || !Number.isFinite(state.at)) return state.time;
    const raw = state.time + Math.max(0, (sceneNow() - state.at) / 1000);
    if (Number.isFinite(video.duration) && video.duration > 0) {
      return background ? raw % video.duration : Math.min(video.duration, raw);
    }
    return raw;
  }
  function waitMediaEvent(name: 'loadeddata' | 'seeked', timeoutMs = 350) {
    return new Promise<void>(resolve => {
      const done = () => {
        clearTimeout(timer);
        video.removeEventListener(name, done);
        video.removeEventListener('error', done);
        resolve();
      };
      const timer = window.setTimeout(done, timeoutMs);
      video.addEventListener(name, done, { once: true });
      video.addEventListener('error', done, { once: true });
    });
  }
  const play = background ? undefined : lessonControl('video-playback','',()=>{
    const playing = !(intent.mode === 'playing' && !video.ended);
    const time = intent.mode === 'static' || video.hidden || video.ended ? 0 : video.currentTime;
    const state: VideoState = playing ? {mode:'playing',time,at:sceneNow()} : {mode:'paused',time};
    void setVideo(state);
  });
  async function setVideo(state: VideoState) {
    if (background && reducedMotion.matches) state = {mode:'static',time:0};
    const request = ++generation;
    intent = state;
    video.playbackRate = 1;
    if (state.mode === 'static') { showPoster(clip.key === 'xiang'); return; }
    if (posterFade) {
      video.hidden = true;
      video.classList.remove('is-visible');
      posterFade.cancel();
      posterFade = undefined;
    }
    const entering = video.hidden;
    if (still) still.disabled = false;
    if (play) {
      if (clip.mode === 'transition') {
        play.classList.remove('icon-button');
        setButtonContent(play, state.mode === 'paused' ? '继续播放' : '暂停短片', state.mode === 'paused' ? 'play' : 'pause');
      } else {
        setIconButton(play,state.mode === 'paused' ? '继续播放' : '暂停短片',state.mode === 'paused' ? 'play' : 'pause');
      }
    }
    if (clip.mode === 'opening') soundscape.setVideoDuck(state.mode === 'playing');
    if (entering && clip.mode === 'transition') {
      align?.();
      getComputedStyle(media).transform;
      await Promise.allSettled(media.getAnimations().map(animation=>animation.finished));
      if (request !== generation || !video.isConnected) return;
    }
    video.hidden = false;
    if (state.mode === 'paused') {
      video.pause();
      if (entering && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await waitMediaEvent('loadeddata', 350);
        if (request !== generation || !video.isConnected) return;
      }
      const needSeek = entering ? video.currentTime !== state.time : Math.abs(video.currentTime - state.time) > .02;
      if (needSeek) {
        const sought = entering ? waitMediaEvent('seeked', 350) : undefined;
        video.currentTime = state.time;
        if (sought) {
          await sought;
          if (request !== generation || !video.isConnected) return;
        }
      }
      video.classList.add('is-visible');
      return;
    }
    try {
      if (entering && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        // The original image stays on screen while the frame decodes.
        await waitMediaEvent('loadeddata', 4000);
        if (request !== generation || !video.isConnected) return;
      }
      const target = clip.mode === 'transition' ? state.time : targetTimeOf(state);
      const shouldSeek = entering ? Math.abs(video.currentTime - target) > .04 : Math.abs(video.currentTime - target) > .12;
      if (shouldSeek) {
        const sought = entering && target > .04 ? waitMediaEvent('seeked', 350) : undefined;
        video.currentTime = target;
        if (sought) {
          await sought;
          if (request !== generation || !video.isConnected) return;
        }
      }
      if (entering && clip.mode === 'transition') video.classList.add('is-visible');
      await video.play();
      if (request === generation && video.isConnected && !video.hidden && !video.paused) {
        video.classList.add('is-visible');
      }
      if (!video.isConnected) video.pause();
    } catch {
      if (request === generation && video.isConnected) showPoster();
    }
  }
  const still = clip.mode === 'transition' ? lessonControl('video-still','',()=>{
    const state:VideoState = {mode:'static',time:0};
    void setVideo(state);
  }) : undefined;
  function resumeBackground() {
    if (!background || reducedMotion.matches || !video.isConnected || intent.mode === 'playing' ||
      dialog.open || video.closest('[data-exploration]')) return;
    void setVideo({mode:'playing',time:intent.mode === 'paused' ? intent.time : 0,at:sceneNow()});
  }
  const player = {element: video, set: setVideo, read: (): VideoState => {
    const time = video.hidden || intent.mode === 'static' ? intent.time : video.currentTime;
    return intent.mode === 'playing' ? {mode:'playing',time,at:sceneNow()} : {mode:intent.mode,time};
  },
    pause() {
      if (intent.mode !== 'playing') return;
      void setVideo({mode:'paused',time:video.currentTime});
    },
    resumeBackground,
    dispose() {
      generation++;
      posterFade?.cancel();
      video.pause();
    },
    applyMotionPreference() {
      if (!background || !video.isConnected) return;
      if (reducedMotion.matches) void setVideo({mode:'static',time:0});
      else resumeBackground();
    },
  };
  video.addEventListener('ended',()=>{
    if (!video.isConnected || !video.ended || intent.mode!=='playing') return;
    if (clip.mode==='transition') advance?.();
    if (clip.mode==='opening') {
      intent = {mode:'paused',time:video.currentTime};
      if (play) setIconButton(play,'重播','reset');
      soundscape.setVideoDuck(false);
    }
  });
  video.addEventListener('error',()=>showPoster());
  if (play) {
    if (clip.mode === 'transition') {
      play.classList.add('primary');
      setButtonContent(play, startLabel, 'play');
    } else {
      setIconButton(play,startLabel,'play');
    }
    tools.append(play);
  }
  if (still) {
    setIconButton(still,'静态画面','image');
    still.disabled = true;
    tools.append(still);
  }
  function showPoster(fade = false) {
    const request = ++generation;
    intent = {mode:'static',time:0};
    video.playbackRate = 1;
    video.pause();
    if (clip.mode === 'opening') soundscape.setVideoDuck(false);
    if (cutLabel) cutLabel.hidden = true;
    if (still) {
      if (document.activeElement === still) play?.focus({preventScroll:true});
      still.disabled = true;
    }
    if (play) {
      if (clip.mode === 'transition') {
        play.classList.remove('icon-button');
        setButtonContent(play, startLabel, 'play');
      } else {
        setIconButton(play,startLabel,'play');
      }
    }
    const finish = () => {
      if (request !== generation) return;
      video.hidden = true;
      video.classList.remove('is-visible');
      posterFade?.cancel();
      posterFade = undefined;
      if (video.readyState) video.currentTime = 0;
    };
    if (fade && !reducedMotion.matches && !video.hidden && video.classList.contains('is-visible')) {
      const opacity = getComputedStyle(video).opacity;
      posterFade?.cancel();
      posterFade = video.animate([{opacity}, {opacity: 0}], {duration: 160, easing: 'ease-out', fill: 'forwards'});
      void posterFade.finished.then(finish, () => {});
    } else finish();
  }
  if (background && !reducedMotion.matches) void setVideo({mode:'playing',time:0,at:sceneNow()});
  return player;
}
