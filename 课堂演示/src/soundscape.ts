type SoundScene =
  | 'silent' | 'map' | 'yudu' | 'xiang' | 'liping'
  | 'wujiang' | 'zunyi-yard' | 'zunyi-room' | 'desk' | 'recap';

type SoundEffect =
  | 'point' | 'route' | 'step-stone' | 'step-wood'
  | 'paper-turn' | 'paper-slide' | 'rope-untie' | 'confirm' | 'complete';

type AmbientMix = { river: number; riverHz: number; wind: number; windHz: number; rain: number; hearth: number };

const ambientProfiles: Record<SoundScene, AmbientMix> = {
  silent: { river: 0, riverHz: 900, wind: 0, windHz: 320, rain: 0, hearth: 0 },
  map: { river: 0, riverHz: 900, wind: 0.045, windHz: 290, rain: 0, hearth: 0 },
  yudu: { river: 0.16, riverHz: 1150, wind: 0.055, windHz: 340, rain: 0, hearth: 0 },
  xiang: { river: 0.21, riverHz: 1450, wind: 0.075, windHz: 420, rain: 0.065, hearth: 0 },
  liping: { river: 0, riverHz: 800, wind: 0.025, windHz: 260, rain: 0.058, hearth: 0.045 },
  wujiang: { river: 0.25, riverHz: 1750, wind: 0.085, windHz: 460, rain: 0.02, hearth: 0 },
  'zunyi-yard': { river: 0, riverHz: 800, wind: 0.04, windHz: 310, rain: 0.032, hearth: 0.015 },
  'zunyi-room': { river: 0, riverHz: 700, wind: 0.01, windHz: 220, rain: 0.014, hearth: 0.065 },
  desk: { river: 0, riverHz: 700, wind: 0.008, windHz: 210, rain: 0.012, hearth: 0.072 },
  recap: { river: 0, riverHz: 900, wind: 0.035, windHz: 280, rain: 0, hearth: 0.02 },
};

const soundscape = (() => {
  const isProjectionWindow = () => /^#projection=([a-f0-9]{32})$/.test(location.hash);
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let envMaster: GainNode | null = null;
  let riverGain: GainNode | null = null;
  let riverFilter: BiquadFilterNode | null = null;
  let windGain: GainNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  let rainGain: GainNode | null = null;
  let hearthGain: GainNode | null = null;
  let finaleAudio: { source: AudioBufferSourceNode; gain: GainNode } | undefined;
  let finaleRequest = 0;
  let noiseBuffer: AudioBuffer | null = null;
  let riverBuffer: AudioBuffer | null = null;
  let celloBuffer: Promise<AudioBuffer | undefined> | undefined;
  let riverStarted = false;
  let crackleTimer: number | undefined;
  let currentScene: SoundScene = 'silent';
  let muted = false;
  let ducked = false;
  let initialized = false;
  const listeners = new Set<(isMuted: boolean) => void>();

  function dataUriToArrayBuffer(uri: string) {
    const base64 = uri.slice(uri.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function createNoiseBuffer(audio: AudioContext) {
    const length = audio.sampleRate * 4;
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
      b6 = white * 0.115926;
    }
    return buffer;
  }

  function startRiverLoop() {
    if (!ctx || !riverFilter || !riverBuffer || riverStarted) return;
    riverStarted = true;
    const source = ctx.createBufferSource();
    source.buffer = riverBuffer;
    source.loop = true;
    source.connect(riverFilter);
    source.start();
  }

  function scheduleCrackle() {
    if (crackleTimer !== undefined) return;
    crackleTimer = window.setInterval(() => {
      if (!ctx || !hearthGain || !noiseBuffer || muted || ducked || document.hidden || ctx.state !== 'running') return;
      const mix = ambientProfiles[currentScene];
      if (mix.hearth < 0.03 || Math.random() > 0.36) return;
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1900 + Math.random() * 2100;
      band.Q.value = 3.2;
      const env = ctx.createGain();
      const peak = (0.008 + Math.random() * 0.012) * (mix.hearth / 0.07);
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(peak, now + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.032 + Math.random() * 0.025);
      src.connect(band).connect(env).connect(envMaster!);
      src.start(now, Math.random() * 3.5, 0.07);
    }, 620);
  }

  function ensureContext() {
    if (isProjectionWindow()) return null;
    if (ctx) return ctx;
    const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    try {
      ctx = new AudioCtor();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);

    envMaster = ctx.createGain();
    envMaster.gain.value = ducked || document.hidden ? 0 : 1;
    envMaster.connect(master);

    noiseBuffer = createNoiseBuffer(ctx);

    riverFilter = ctx.createBiquadFilter();
    riverFilter.type = 'lowpass';
    riverFilter.frequency.value = 1100;
    riverGain = ctx.createGain();
    riverGain.gain.value = 0;
    riverFilter.connect(riverGain).connect(envMaster);

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuffer;
    windSrc.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 320;
    windFilter.Q.value = 1.4;
    const windLfo = ctx.createOscillator();
    const windDepth = ctx.createGain();
    windLfo.frequency.value = 0.11;
    windDepth.gain.value = 95;
    windLfo.connect(windDepth).connect(windFilter.frequency);
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter).connect(windGain).connect(envMaster);
    windSrc.start();
    windLfo.start();

    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = noiseBuffer;
    rainSrc.loop = true;
    const rainHigh = ctx.createBiquadFilter();
    rainHigh.type = 'highpass';
    rainHigh.frequency.value = 1350;
    const rainLow = ctx.createBiquadFilter();
    rainLow.type = 'lowpass';
    rainLow.frequency.value = 4600;
    rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    rainSrc.connect(rainHigh).connect(rainLow).connect(rainGain).connect(envMaster);
    rainSrc.start(0, 1.3);

    const hearthSrc = ctx.createBufferSource();
    hearthSrc.buffer = noiseBuffer;
    hearthSrc.loop = true;
    const hearthLow = ctx.createBiquadFilter();
    hearthLow.type = 'lowpass';
    hearthLow.frequency.value = 190;
    hearthGain = ctx.createGain();
    hearthGain.gain.value = 0;
    hearthSrc.connect(hearthLow).connect(hearthGain).connect(envMaster);
    hearthSrc.start(0, 2.4);

    if (mediaAssets['ambient-river']) {
      void ctx.decodeAudioData(dataUriToArrayBuffer(mediaAssets['ambient-river'])).then(buf => {
        riverBuffer = buf;
        startRiverLoop();
      }).catch(() => {});
    }
    if (mediaAssets['recap-cello']) {
      celloBuffer = ctx.decodeAudioData(dataUriToArrayBuffer(mediaAssets['recap-cello'])).catch(() => undefined);
    }

    scheduleCrackle();
    applyMix(0.8);
    return ctx;
  }

  function applyMix(fadeSeconds = 0.85) {
    if (!ctx || !riverGain || !riverFilter || !windGain || !windFilter || !rainGain || !hearthGain) return;
    const now = ctx.currentTime;
    const target = ambientProfiles[currentScene];
    const t = Math.max(0.08, fadeSeconds);
    riverGain.gain.setTargetAtTime(target.river, now, t * 0.35);
    riverFilter.frequency.setTargetAtTime(target.riverHz, now, t * 0.35);
    windGain.gain.setTargetAtTime(target.wind, now, t * 0.35);
    windFilter.frequency.setTargetAtTime(target.windHz, now, t * 0.35);
    rainGain.gain.setTargetAtTime(target.rain, now, t * 0.35);
    hearthGain.gain.setTargetAtTime(target.hearth, now, t * 0.35);
  }

  function updateMasterGain() {
    if (!ctx || !master || !envMaster) return;
    const now = ctx.currentTime;
    master.gain.setTargetAtTime(muted ? 0 : 1, now, 0.08);
    envMaster.gain.setTargetAtTime(ducked || document.hidden ? 0 : 1, now, 0.14);
  }

  function unlock() {
    if (isProjectionWindow()) return;
    const audio = ensureContext();
    if (audio && audio.state === 'suspended') void audio.resume().catch(() => {});
  }

  if (!isProjectionWindow() && !initialized) {
    initialized = true;
    const wake = () => unlock();
    window.addEventListener('pointerdown', wake, { capture: true, passive: true });
    window.addEventListener('keydown', wake, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => updateMasterGain());
  }

  function setScene(scene: SoundScene, fadeSeconds = 0.85) {
    if (isProjectionWindow()) return;
    currentScene = scene;
    if (scene !== 'recap') stopFinale();
    applyMix(fadeSeconds);
  }

  function setVideoDuck(active: boolean) {
    if (isProjectionWindow()) return;
    ducked = active;
    updateMasterGain();
  }

  function setMuted(next: boolean) {
    if (isProjectionWindow()) return;
    muted = next;
    if (!muted) unlock();
    updateMasterGain();
    listeners.forEach(fn => fn(muted));
  }

  function toggleMuted() {
    setMuted(!muted);
    return muted;
  }

  function stopFinale() {
    finaleRequest++;
    if (!finaleAudio || !ctx) return;
    const now = ctx.currentTime;
    const { source, gain } = finaleAudio;
    finaleAudio = undefined;
    gain.gain.cancelAndHoldAtTime(now);
    gain.gain.linearRampToValueAtTime(0, now + 0.12);
    source.stop(now + 0.12);
  }

  function playFinale(offset: number, duration: number) {
    const audio = ensureContext();
    const destination = envMaster;
    if (!audio || !destination || !celloBuffer) return;
    stopFinale();
    const request = finaleRequest;
    const requestedAt = performance.now();
    if (audio.state === 'suspended') void audio.resume().catch(() => {});
    void celloBuffer.then(buffer => {
      if (!buffer || request !== finaleRequest) return;
      const position = offset + (performance.now() - requestedAt) / 1000;
      const remaining = Math.min(buffer.duration, duration) - position;
      if (remaining < 0.15) return;
      const source = audio.createBufferSource();
      const gain = audio.createGain();
      const now = audio.currentTime;
      const fadeIn = Math.min(offset === 0 ? 1.4 : 0.15, remaining / 2);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.28, now + fadeIn);
      gain.gain.setValueAtTime(0.28, now + Math.max(fadeIn, remaining - 1.1));
      gain.gain.linearRampToValueAtTime(0, now + remaining);
      source.buffer = buffer;
      source.connect(gain).connect(destination);
      finaleAudio = { source, gain };
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        if (finaleAudio?.source === source) finaleAudio = undefined;
      };
      source.start(now, position, remaining);
    });
  }

  function playSfx(kind: SoundEffect) {
    if (isProjectionWindow() || muted || document.hidden) return;
    const audio = ensureContext();
    if (!audio || !master || !noiseBuffer) return;
    if (audio.state === 'suspended') {
      void audio.resume().catch(() => {});
      return;
    }
    const now = audio.currentTime;
    if (kind === 'point' || kind === 'confirm' || kind === 'complete') {
      const notes = kind === 'point' ? [523.25] : kind === 'confirm' ? [440, 587.33] : [392, 493.88, 587.33];
      notes.forEach((freq, i) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const start = now + i * 0.085;
        const dur = kind === 'point' ? 0.14 : 0.26;
        const peak = kind === 'point' ? 0.045 : 0.06;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(gain).connect(master!);
        osc.start(start);
        osc.stop(start + dur + 0.02);
      });
      return;
    }
    if (kind === 'route') {
      const src = audio.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = audio.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(260, now);
      filter.frequency.exponentialRampToValueAtTime(760, now + 0.45);
      filter.frequency.exponentialRampToValueAtTime(320, now + 1.1);
      filter.Q.value = 1.6;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
      src.connect(filter).connect(gain).connect(master);
      src.start(now, Math.random() * 2, 1.2);
      return;
    }
    const src = audio.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    if (kind === 'paper-turn' || kind === 'paper-slide') {
      filter.type = 'bandpass';
      filter.frequency.value = kind === 'paper-turn' ? 2100 : 1550;
      filter.Q.value = 1.2;
      const dur = kind === 'paper-turn' ? 0.18 : 0.14;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.075, now + 0.035);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(filter).connect(gain).connect(master);
      src.start(now, Math.random() * 2.8, dur + 0.02);
    } else if (kind === 'rope-untie') {
      filter.type = 'bandpass';
      filter.frequency.value = 980;
      filter.Q.value = 2.0;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
      src.connect(filter).connect(gain).connect(master);
      src.start(now, Math.random() * 2.8, 0.18);
    } else {
      // step-stone / step-wood
      const wood = kind === 'step-wood';
      filter.type = wood ? 'lowpass' : 'bandpass';
      filter.frequency.value = wood ? 320 + Math.random() * 80 : 920 + Math.random() * 240;
      filter.Q.value = wood ? 1.1 : 1.6;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(wood ? 0.12 : 0.07, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.095);
      src.connect(filter).connect(gain).connect(master);
      src.start(now, Math.random() * 3.2, 0.11);
    }
  }

  return {
    setScene,
    setVideoDuck,
    setMuted,
    toggleMuted,
    isMuted: () => muted,
    onMuteChange(fn: (isMuted: boolean) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    playSfx,
    playFinale,
    stopFinale,
  };
})();

(window as unknown as { __lessonSound?: typeof soundscape }).__lessonSound = soundscape;
