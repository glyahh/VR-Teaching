"""Compare the two real offline desk builds at the same poses and browser settings."""

import argparse
from hashlib import file_digest
import json
from math import ceil
from pathlib import Path
from shutil import copyfile
from statistics import median
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from support.course_checks import DESK, drag_desk, visible_motion


VIEWPORT = {'width': 1366, 'height': 768}


def scene(context, url, errors, requests):
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    context.on('request', lambda request: requests.append(request.url)
               if request.url.startswith(('http://', 'https://')) else None)
    page.goto(url+'#desk')
    frame = page.locator(DESK)
    expect(frame).to_have_attribute('data-space', 'ready', timeout=22000)
    expect(frame.locator('canvas')).to_be_visible()
    return page, frame


def poses(context, url, folder, changed):
    errors, requests = [], []
    page, frame = scene(context, url, errors, requests)
    frame.screenshot(path=folder/'01-正面.png')
    for _ in range(8):
        frame.press('ArrowUp')
    expect(frame).to_have_attribute('data-pitch','16.000')
    frame.screenshot(path=folder/'02-俯看.png')
    frame.press('Home')
    for _ in range(4):
        frame.press('ArrowRight')
    expect(frame).to_have_attribute('data-yaw','16.000')
    frame.press('+')
    expect(frame).to_have_attribute('data-zoom','1.1300')
    frame.screenshot(path=folder/'03-斜侧近看.png')

    frame.press('Home')
    drag_desk(page,'page-forward',-.071,hold=True)
    expect(frame).to_have_attribute('data-gesture','page')
    frame.screenshot(path=folder/'04-页片弯曲中.png')
    page.mouse.up()
    expect(frame).to_have_attribute('data-spread','1')
    frame.screenshot(path=folder/'05-落稳的书口.png')

    drag_desk(page,'map',-.069,dy=-.035,hold=True)
    expect(frame).to_have_attribute('data-gesture','map')
    frame.screenshot(path=folder/'06-折图展开中.png')
    page.mouse.up()
    expect(frame).to_have_attribute('data-map','original')
    drag_desk(page,'overlay',dy=-.23)
    expect(frame).to_have_attribute('data-map','both')
    frame.screenshot(path=folder/'07-桌上叠图.png')
    if changed:
        drag_desk(page,'overlay',.16,hold=True)
        expect(frame).to_have_attribute('data-gesture','map')
        frame.screenshot(path=folder/'08-折回中.png')
        page.mouse.up()
        expect(frame).to_have_attribute('data-map','stored')
        frame.screenshot(path=folder/'09-折回后.png')
    assert not errors, errors
    assert not requests, requests


def timed_flip(context, url):
    errors, requests = [], []
    page, frame = scene(context,url,errors,requests)
    frame.press(']')
    expect(frame).to_have_attribute('data-spread','1')
    frame.press('[')
    expect(frame).to_have_attribute('data-spread','0')
    page.evaluate("""() => {
      const frame=document.querySelector('.desk-live-frame');
      window.addEventListener('keydown', event => {
        if (event.key !== ']') return;
        const started=performance.now(), gaps=[];
        let last, loop, moved=false;
        function sample(now) {
          if (last!==undefined) gaps.push(now-last);
          last=now;
          loop=requestAnimationFrame(sample);
        }
        loop=requestAnimationFrame(sample);
        const observer=new MutationObserver(() => {
          moved ||= frame.dataset.gesture==='page' && Number(frame.dataset.progress)>0;
          if (frame.dataset.spread!=='1' || frame.dataset.gesture) return;
          cancelAnimationFrame(loop);
          observer.disconnect();
          window.deskFlipTiming={duration:performance.now()-started,moved,gaps};
        });
        observer.observe(frame,{attributes:true,attributeFilter:['data-progress','data-gesture','data-spread']});
      }, {capture:true,once:true});
    }""")
    frame.press(']')
    page.wait_for_function('window.deskFlipTiming !== undefined')
    reading=page.evaluate('window.deskFlipTiming')
    assert reading['moved'] and reading['gaps'], reading
    assert not errors and not requests, (errors,requests)
    details=frame.locator('canvas').evaluate("""canvas => {
      const gl=canvas.getContext('webgl2');
      const extension=gl.getExtension('WEBGL_debug_renderer_info');
      return {size:[canvas.width,canvas.height],
              renderer:extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null};
    }""")
    gaps=sorted(reading['gaps'])
    return {**details,'turn_ms':round(reading['duration'],1),'frame_samples':len(gaps),
            'frame_gap_p95_ms':round(gaps[ceil(len(gaps)*.95)-1],1)}


def lamp_motion(context, url, folder):
    errors, requests = [], []
    page, frame = scene(context,url,errors,requests)
    box=frame.bounding_box()
    clip={'x':box['x']+box['width']*.49,'y':box['y']+box['height']*.22,
          'width':box['width']*.072,'height':box['height']*.25}
    expect(frame).to_have_attribute('data-yaw','0.000')
    first=page.screenshot(clip=clip,path=folder/'灯火-首帧.png')
    differences=[]
    for _ in range(4):
        page.wait_for_timeout(130)
        second=page.screenshot(clip=clip)
        difference=visible_motion(first,second)
        differences.append(difference)
        if difference==max(differences):
            (folder/'灯火-下一帧.png').write_bytes(second)
    assert max(differences)>.02 and not errors and not requests, (differences,errors,requests)
    return round(max(differences),3)


def digest(path):
    with path.open('rb') as opened:
        return file_digest(opened,'sha256').hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before',type=Path,required=True)
    parser.add_argument('--after',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--rounds',type=int,default=5)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    reports={}
    with TemporaryDirectory(prefix='desk-art-pair-') as temporary, sync_playwright() as playwright:
        copies={}
        for label,source in (('before',args.before),('after',args.after)):
            dest=Path(temporary)/label
            dest.mkdir()
            html=dest/'lesson.html'
            copyfile(source,html)
            copies[label]=html.as_uri()
            reports[label]={'sha256':digest(source),'measurements':[]}
        with playwright.chromium.launch(channel='msedge',headless=True,args=['--enable-unsafe-swiftshader']) as browser:
            for label,url in copies.items():
                folder=args.output/label
                folder.mkdir(exist_ok=True)
                with browser.new_context(offline=True,viewport=VIEWPORT,service_workers='block',
                                         reduced_motion='reduce') as context:
                    poses(context,url,folder,changed=label=='after')
            print('同机位及实际纸件手势截图已保存。',flush=True)
            for index in range(args.rounds):
                for label in (('before','after') if index%2==0 else ('after','before')):
                    with browser.new_context(offline=True,viewport=VIEWPORT,service_workers='block') as context:
                        reports[label]['measurements'].append(timed_flip(context,copies[label]))
            for label,url in copies.items():
                with browser.new_context(offline=True,viewport=VIEWPORT,service_workers='block') as context:
                    reports[label]['lamp_region_rgb_difference']=lamp_motion(context,url,args.output/label)
            for report in reports.values():
                for field in ('turn_ms','frame_gap_p95_ms'):
                    values=[item[field] for item in report['measurements']]
                    if values:
                        report[field]={'median':median(values),'range':[min(values),max(values)]}
            result={'passed':True,'edge':browser.version,'viewport':VIEWPORT,'cases':reports}
    (args.output/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False),flush=True)


if __name__=='__main__':
    main()
