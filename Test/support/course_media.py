"""在 Edge 中对照短片解码帧和课页画面。"""


MAX_JOIN_RGB_ERROR = 3


def video_frame_errors(page, video, entry, exit):
    return page.evaluate("""async ({video,entry,exit}) => {
      const url = source => typeof source === 'string' ? mediaAssets[source] : source.src;
      const sample = document.createElement('video');
      sample.muted = true;
      sample.src = url(video);
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
      if (sample.readyState < 2) await waitFor('loadeddata');
      const canvas = document.createElement('canvas');
      canvas.width = sample.videoWidth;
      canvas.height = sample.videoHeight;
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
        still.src = url(anchor);
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
      await seek(.01);
      const first = await difference(entry);
      await seek(sample.duration-.01);
      return [first,await difference(exit)];
    }""", {"video": video, "entry": entry, "exit": exit})

