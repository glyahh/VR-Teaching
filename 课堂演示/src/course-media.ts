type CourseAssetLease = {url: string; release: () => void};
type CourseAssetLoad = {users: number; url: Promise<string>};

const activeCourseAssets = new Map<string, CourseAssetLoad>();
const waitingCourseAssets = new Set<() => void>();
let courseAssetParser: MutationObserver | undefined;

function checkCourseAssetArrivals() {
  for (const check of waitingCourseAssets) check();
  if (waitingCourseAssets.size) return;
  courseAssetParser?.disconnect();
  courseAssetParser = undefined;
  document.removeEventListener('DOMContentLoaded', checkCourseAssetArrivals);
}

function waitForCourseAsset(key: string): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    function check() {
      const end = document.getElementById(`course-end-${key}`);
      if (end) resolve(end);
      else if (document.readyState === 'loading') return;
      else reject(new Error(`课件资源不完整：${key}`));
      waitingCourseAssets.delete(check);
    }
    waitingCourseAssets.add(check);
    check();
    if (waitingCourseAssets.has(check) && !courseAssetParser) {
      courseAssetParser = new MutationObserver(checkCourseAssetArrivals);
      courseAssetParser.observe(document.body, {childList: true});
      document.addEventListener('DOMContentLoaded', checkCourseAssetArrivals);
    }
  });
}

function decodeCourseChunk(base64: string): BlobPart {
  if ('fromBase64' in Uint8Array && typeof Uint8Array.fromBase64 === 'function') {
    return Uint8Array.fromBase64(base64);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function makeCourseAssetUrl(key: string) {
  const end = await waitForCourseAsset(key);
  const parts: BlobPart[] = [];
  for (let chunk: Element | null = document.getElementById(`course-data-${key}`); chunk !== end; chunk = chunk.nextElementSibling) {
    if (!(chunk instanceof HTMLScriptElement) || chunk.type !== 'application/x-course-asset') {
      throw new Error(`课件资源不完整：${key}`);
    }
    parts.push(decodeCourseChunk(chunk.text));
  }
  return URL.createObjectURL(new Blob(parts, {type: courseMediaTypes[key]}));
}

async function acquireCourseAsset(key: string): Promise<CourseAssetLease> {
  if (Object.hasOwn(mediaAssets, key)) return {url: mediaAssets[key], release() {}};
  if (!Object.hasOwn(courseMediaTypes, key)) throw new Error(`课件资源不存在：${key}`);
  let entry = activeCourseAssets.get(key);
  if (!entry) {
    entry = {users: 0, url: makeCourseAssetUrl(key)};
    activeCourseAssets.set(key, entry);
  }
  const load = entry;
  load.users++;
  let released = false;
  function release() {
    if (released) return;
    released = true;
    if (--load.users) return;
    activeCourseAssets.delete(key);
    void load.url.then(url => URL.revokeObjectURL(url), () => {});
  }
  try {
    return {url: await load.url, release};
  } catch (error) {
    release();
    throw error;
  }
}

async function withCourseAssetGroup<T>(group: keyof typeof courseAssetGroups,
  use: (assets: Readonly<Record<string, string>>) => Promise<T>) {
  const keys = courseAssetGroups[group];
  const results = await Promise.allSettled(keys.map(acquireCourseAsset));
  const assets = {...mediaAssets};
  try {
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') throw result.reason;
      assets[keys[index]] = result.value.url;
    }
    return await use(assets);
  } finally {
    for (const result of results) if (result.status === 'fulfilled') result.value.release();
  }
}

function mountCourseVideoSource(video: HTMLVideoElement, key: string) {
  let pending: Promise<boolean> | undefined;
  let lease: CourseAssetLease | undefined;
  let released = false;
  function prepare() {
    if (released) return Promise.resolve(false);
    return pending ??= acquireCourseAsset(key).then(asset => {
      if (released) {
        asset.release();
        return false;
      }
      lease = asset;
      video.src = asset.url;
      return true;
    }, () => {
      pending = undefined;
      return false;
    });
  }
  void prepare();
  return {
    prepare,
    dispose() {
      if (released) return;
      released = true;
      unloadVideo(video);
      lease?.release();
    },
  };
}
