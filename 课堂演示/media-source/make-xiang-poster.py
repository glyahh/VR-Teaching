"""从正式短片的 Edge 解码首帧生成湘江河谷的入片静图。"""

import base64
from pathlib import Path
import tempfile

from playwright.sync_api import sync_playwright


ASSETS = Path(__file__).resolve().parents[1] / "assets"


def main():
    source = "data:video/mp4;base64," + base64.b64encode((ASSETS / "xiang.mp4").read_bytes()).decode()
    with sync_playwright() as playwright:
        with playwright.chromium.launch(channel="msedge", headless=True) as browser:
            page = browser.new_page(offline=True)
            poster = page.evaluate("""async source => {
              const video = document.createElement('video');
              video.muted = true;
              video.preload = 'auto';
              const loaded = new Promise((resolve, reject) => {
                video.addEventListener('loadeddata', resolve, {once: true});
                video.addEventListener('error', () => reject(new Error('湘江短片解码失败')), {once: true});
              });
              video.src = source;
              await loaded;
              const seeked = new Promise(resolve => video.addEventListener('seeked', resolve, {once: true}));
              video.currentTime = 0.001;
              await seeked;
              const canvas = document.createElement('canvas');
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(video, 0, 0);
              if (ctx.getImageData(0, 0, 1, 1).data[3] !== 255) throw new Error('湘江首帧为空');
              return canvas.toDataURL('image/png').split(',')[1];
            }""", source)
    with tempfile.NamedTemporaryFile(dir=ASSETS, suffix=".png", delete=False) as staging:
        staging.write(base64.b64decode(poster, validate=True))
        target = Path(staging.name)
    try:
        target.replace(ASSETS / "xiang.png")
    finally:
        target.unlink(missing_ok=True)
    print("已更新湘江河谷的 Edge 首帧静图")


if __name__ == "__main__":
    main()
