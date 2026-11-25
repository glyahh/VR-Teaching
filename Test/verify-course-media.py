from argparse import ArgumentParser
from pathlib import Path

from course_cli import COURSE, launch


def video_frame_errors(video, entry, exit):
    return video.evaluate("""async (video, {entry,exit}) => {
      const sample = document.createElement('video');
      sample.muted = true;
      sample.src = video.src;
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
      async function difference(key) {
        const still = new Image();
        still.src = mediaAssets[key];
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
    }""", {"entry": entry, "exit": exit})


def verify_asset_join(html, clip, entry, exit):
    with launch(html, {"width": 1920, "height": 1080}) as (context, lesson_url, _, _):
        page = context.new_page()
        page.goto(lesson_url)
        video_key = clip + "-video"
        missing = page.evaluate("""keys => keys.filter(key => !mediaAssets[key])""", [video_key, entry, exit])
        if missing:
            raise SystemExit("成品中找不到资源 " + "、".join(missing))
        page.evaluate("""key => {
          const video = document.createElement('video');
          video.src = mediaAssets[key];
          video.hidden = true;
          video.dataset.joinCheck = '';
          document.body.append(video);
        }""", video_key)
        first, last = video_frame_errors(page.locator("video[data-join-check]"), entry, exit)
        print(f"{clip} 与 {entry}、{exit} 平均 RGB 差 {first:.2f}、{last:.2f}/255", flush=True)
        if max(first, last) > 3:
            raise SystemExit("首尾帧有偏差。核对实际出入片画面的机位、裁切、亮度和物件状态。")


if __name__ == '__main__':
    parser = ArgumentParser()
    parser.add_argument('--html', type=Path, default=COURSE)
    parser.add_argument('--check-join', nargs=3, required=True, metavar=('CLIP', 'ENTRY', 'EXIT'))
    args = parser.parse_args()
    verify_asset_join(args.html, *args.check_join)
