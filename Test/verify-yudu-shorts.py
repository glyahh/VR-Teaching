"""End-to-end offline Yudu short-video checks at the classroom entry point."""
import argparse,json,os,shutil,tempfile
from pathlib import Path
from playwright.sync_api import expect,sync_playwright
root=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('html',type=Path)
parser.add_argument('--fixture',action='store_true',help=argparse.SUPPRESS)
parser.add_argument('--browser',default=os.environ.get('COURSE_BROWSER'),help='Path to Chrome or Edge executable; default uses the installed Edge channel.')
args=parser.parse_args()
steps=['到桥头','看桥下','看架桥','看夜渡','看收桥']
voice_lines=list(json.loads((root.parent/'课堂演示/media-source/yudu-voice-captions.json').read_text()).values())
with tempfile.TemporaryDirectory() as tmp,sync_playwright() as p:
 doc=Path(tmp)/'lesson.html';shutil.copyfile(args.html,doc)
 launcher = {'executable_path':args.browser} if args.browser else {'channel':'msedge'}
 b=p.chromium.launch(**launcher,headless=True,args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'])
 report=[]
 for width,height in ([(1366,768)] if args.fixture else [(1366,768),(1920,1080)]):
  ctx=b.new_context(viewport={'width':width,'height':height},offline=True,device_scale_factor=1,service_workers='block')
  page=ctx.new_page(); errors=[]; requests=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  ctx.on('request',lambda r:requests.append(r.url.split('?')[0]) if r.url.startswith(('https:','http:')) else None)
  page.goto(doc.as_uri(),timeout=35000,wait_until='domcontentloaded')
  page.get_by_role('button',name='开始授课',exact=True).click(timeout=12000)
  page.get_by_role('button',name='进入课堂',exact=True).click(timeout=12000)
  for title in ['岸边备桥','浮桥近景']:
   page.get_by_role('button',name='下一页',exact=True).click(timeout=12000)
   expect(page.locator('.scene-head h1')).to_have_text(title,timeout=12000)
  enter=page.get_by_role('button',name='于都河岸',exact=True)
  enter.click(timeout=12000)
  stage=page.locator('.lesson-exploration[data-scene="yudu-river"]')
  expect(stage).to_have_attribute('data-ready','',timeout=45000)
  video=stage.locator('video.river-short');transport=stage.locator('#river-tools')
  action=stage.locator('#river-action')
  for i,step in enumerate(steps[:1] if args.fixture else steps):
   expect(action).to_have_attribute('aria-label',step,timeout=25000)
   print(f'Checking {width}×{height} {step}',flush=True)
   page.evaluate("""(line)=>{
      clearInterval(window.riverSampleTimer);
      window.riverMediaSamples=[];
      window.riverMediaVerified=false;
      window.riverSampleTimer=setInterval(()=>{
        const v=document.querySelector('video.river-short'), el=document.querySelector('#river-instruction');
        if (!v || !el) return;
        const a=el.getBoundingClientRect(), b=el.closest('.lesson-exploration').getBoundingClientRect();
        const centered=Math.abs(a.left+a.width/2-b.left-b.width/2)<3 && a.top>b.top+b.height*.68;
        const record=[v.currentTime,v.readyState,v.paused,v.muted,v.webkitAudioDecodedByteCount,
          v.style.opacity,v.src.startsWith('data:video/mp4'),el.textContent,centered,v.error?.message];
        window.riverMediaSamples.push(record);
        if(!v.paused && !v.muted && v.webkitAudioDecodedByteCount && v.currentTime>.12 &&
            v.style.opacity==='1' && record[6] && el.textContent===line && centered) window.riverMediaVerified=true;
      },60);
   }""",voice_lines[i])
   action.press('Enter',timeout=22000)
   try:
    page.wait_for_function('() => window.riverMediaVerified',polling=50,timeout=16000)
   except Exception:
    print('Media trace:',page.evaluate('window.riverMediaSamples.filter((r,i)=>i===0 || i%4===0).slice(-30)'),flush=True)
    raise
   finally:
    page.evaluate('clearInterval(window.riverSampleTimer)')
   assert not stage.locator('.river-short-credit').count()
   if i==0:
    stage.evaluate("()=>window.__lessonSound.setMuted(true)")
    assert video.evaluate("(v)=>v.muted")
    stage.evaluate("()=>window.__lessonSound.setMuted(false)")
    assert not video.evaluate("(v)=>v.muted")
    action.evaluate('(el)=>el.click()')
    expect(transport).to_have_attribute('data-playback','paused',timeout=12000)
    t=video.evaluate('(v)=>v.currentTime')
    page.wait_for_timeout(400)
    assert abs(video.evaluate('(v)=>v.currentTime')-t)<.08
    back=page.get_by_role('button',name='返回浮桥',exact=True)
    expect(back).to_be_visible(timeout=25000)
    back.evaluate('(el)=>el.click()')
    expect(enter).to_be_visible(timeout=25000)
    enter.evaluate('(el)=>el.click()')
    expect(transport).to_have_attribute('data-playback','paused',timeout=20000)
    assert abs(video.evaluate('(v)=>v.currentTime')-t)<.08
    action.evaluate('(el)=>el.click()')
    page.wait_for_function("(t) => document.querySelector('video.river-short').currentTime>t+.10",arg=t,timeout=8000)
   expect(transport).to_have_attribute('data-playback','finished' if i==4 else 'waiting',timeout=35000)
   assert stage.get_attribute('data-river-short-visible') == ''
   backdrop=stage.locator('.river-short-backdrop')
   assert backdrop.evaluate("(el)=>el.style.backgroundImage.startsWith('url(')")
   assert video.evaluate('(el)=>el.paused && el.style.opacity === "0"')
   if i in (1,2):
    inspect=stage.locator('#river-inspect')
    inspect.evaluate('(el)=>el.click()')
    assert stage.get_attribute('data-river-short-visible') is None
    stage.locator('#river-parts [data-part="beam"]').evaluate('(el)=>el.click()')
    stage.locator('#river-inspect-close').evaluate('(el)=>el.click()')
    assert stage.get_attribute('data-river-short-visible') == ''
   assert stage.locator('#view').is_visible()
  if not args.fixture:
   expect(stage.locator('#river-compare')).to_be_visible()
   stage.locator('#river-history').evaluate('(el)=>el.click()')
   stage.locator('button[data-recall="night"]').evaluate('(el)=>el.click()')
   assert '不同渡口' in stage.locator('#river-instruction').inner_text()
   assert stage.get_attribute('data-river-short-visible') == ''
   stage.locator('#river-history').evaluate('(el)=>el.click()')
   stage.locator('button[data-recall="dawn"]').evaluate('(el)=>el.click()')
   assert '拂晓前撤桥' in stage.locator('#river-instruction').inner_text()
   stage.locator('#river-compare').evaluate('(el)=>el.click()')
   expect(stage.locator('#river-allocation')).to_be_visible()
   assert stage.get_attribute('data-river-short-visible') is None
   allocation=stage.locator('#river-allocation')
   allocation.evaluate("(el)=>{el.value='6';el.dispatchEvent(new Event('input',{bubbles:true}))}")
   expect(stage.locator('#river-allocated')).to_have_text('6 组')
   stage.locator('#river-run-comparison').evaluate('(el)=>el.click()')
   expect(transport).to_have_attribute('data-playback','playing')
   stage.locator('#river-run-comparison').evaluate('(el)=>el.click()')
   expect(transport).to_have_attribute('data-playback','paused')
   stage.locator('#river-close-comparison').evaluate('(el)=>el.click()')
   assert stage.get_attribute('data-river-short-visible') == ''
  assert not errors,errors
  assert not requests,requests
  assert not requests  # The context is offline and the single file is isolated in a fresh directory.
  print(f"OK {width}×{height}: {len(steps[:1] if args.fixture else steps)} clips",flush=True)
  report.append({'viewport':[width,height],'clips':steps[:1] if args.fixture else steps,'paused_resumed_after_scene_switch':True,'no_network':True})
  ctx.close()
 b.close()
 print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
