"""在 Edge 中对照短片解码帧和课页画面。"""


MAX_JOIN_RGB_ERROR = 3


def video_frame_errors(page, video, entry, exit):
    return page.evaluate("""async ({video,entry,exit}) => {
      const leases = [];
      async function url(source) {
        if (typeof source !== 'string') return source.src;
        if (typeof acquireCourseAsset === 'undefined') return mediaAssets[source];
        const lease = await acquireCourseAsset(source);
        leases.push(lease);
        return lease.url;
      }
      const sample = document.createElement('video');
      sample.muted = true;
      sample.preload = 'auto';
      function waitFor(event) {
        return new Promise((resolve,reject) => {
          const finish = error => {
            clearTimeout(timer);
            sample.removeEventListener(event,ready);
            sample.removeEventListener('error',failed);
            if (error) reject(error);
            else resolve();
          };
          const ready = () => finish();
          const failed = () => finish(new Error('无法解码视频'));
          const timer = setTimeout(() => finish(new Error('等待视频' + event + '超时')),10000);
          sample.addEventListener(event,ready,{once:true});
          sample.addEventListener('error',failed,{once:true});
        });
      }
      const canvas = document.createElement('canvas');
      const brush = canvas.getContext('2d',{willReadFrequently:true});
      function pixels(image) {
        brush.clearRect(0,0,canvas.width,canvas.height);
        const width = image.videoWidth ?? image.naturalWidth;
        const height = image.videoHeight ?? image.naturalHeight;
        const scale = Math.max(canvas.width / width, canvas.height / height);
        const scaledWidth = width * scale, scaledHeight = height * scale;
        brush.drawImage(image,(canvas.width-scaledWidth)/2,(canvas.height-scaledHeight)/2,scaledWidth,scaledHeight);
        return brush.getImageData(0,0,canvas.width,canvas.height).data;
      }
      async function difference(anchor) {
        const still = new Image();
        still.src = await url(anchor);
        await still.decode();
        const image = pixels(still), frame = pixels(sample);
        if (frame[3] !== 255) throw new Error('视频还未完成解码');
        let sum = 0;
        for (let i=0;i<image.length;i++) if (i%4!==3) sum += Math.abs(image[i]-frame[i]);
        return sum/(canvas.width*canvas.height*3);
      }
      async function seek(time) {
        const seeked = waitFor('seeked');
        sample.currentTime = time;
        await seeked;
      }
      try {
        sample.src = await url(video);
        if (sample.readyState < 2) await waitFor('loadeddata');
        canvas.width = sample.videoWidth;
        canvas.height = sample.videoHeight;
        await seek(.01);
        const first = await difference(entry);
        await seek(sample.duration-.01);
        return [first,await difference(exit)];
      } finally {
        sample.removeAttribute('src');
        sample.load();
        for (const lease of leases) lease.release();
      }
    }""", {"video": video, "entry": entry, "exit": exit})

