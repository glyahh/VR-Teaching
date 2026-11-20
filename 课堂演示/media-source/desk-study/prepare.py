"""准备会前桌景用到的扫描材质和自制纸面。"""

import argparse
import hashlib
import json
import math
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


HERE = Path(__file__).resolve().parent


def fetch(work, name, entry):
    target = work / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and hashlib.md5(target.read_bytes()).hexdigest() == entry["md5"]:
        return
    request = urllib.request.Request(entry["url"], headers={"User-Agent": "DeskMaterialStudy/1.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=35) as incoming:
                payload = incoming.read()
            if len(payload) != entry["size"] or hashlib.md5(payload).hexdigest() != entry["md5"]:
                raise ValueError("文件与发布者校验值不符")
            temporary = target.with_suffix(target.suffix + ".part")
            temporary.write_bytes(payload)
            temporary.replace(target)
            print(name, len(payload), flush=True)
            return
        except (OSError, ValueError) as error:
            if attempt == 2:
                raise RuntimeError(name + " 下载失败") from error
            time.sleep(1 + attempt)


def noise(rng, width, height, cells):
    image = Image.fromarray(rng.integers(0, 256, (cells, max(3, round(cells*width/height))), dtype="uint8"))
    return (np.asarray(image.resize((width, height), Image.Resampling.BICUBIC), dtype=np.float32)-128)/128


def paper(work, filename, base, seed, notebook):
    rng = np.random.default_rng(seed)
    width, height = 920, 1250
    rows, columns = np.indices((height, width), dtype="float32")
    macro = noise(rng, width, height, 8)
    speckle = noise(rng, width, height, 100)
    distance = np.minimum.reduce([columns, width-1-columns, rows, height-1-rows])
    edge = np.exp(-np.maximum(0, distance+9*speckle+8*macro)/27)
    flecks = rng.normal(0, 2.6, (height,width))
    stain_shape = np.hypot((columns-width*1.09)/.92,(rows-height*.86)*.78)+9*macro+4*speckle
    tide = np.exp(-((stain_shape-width*.36)/3.4)**2)*5 + np.clip((width*.36-stain_shape)/42,0,1)*5
    fold_line = height*.54+2.9*np.sin(columns/107)+1.5*macro
    folds = 7*np.exp(-((rows-fold_line)/2.1)**2)-6*np.exp(-((rows-fold_line-3)/2.8)**2)
    rubbed = 10*np.exp(-((columns-width*.58)/(width*.32))**2-((rows-height*.37)/(height*.28))**2)
    margin = 13*np.exp(-((columns-width*.073)/(width*.054))**2)*(.6+.4*np.cos(rows/115))
    variation = 15*macro + 6*speckle + flecks + rubbed - 42*edge - 1.6*tide - margin + folds
    original=Image.open(HERE.parents[1]/"assets"/"zunyi-documents.jpg").convert("L")
    patch=[(216,151),(197,286),(334,260),(332,149)] if notebook else [(497,151),(493,212),(611,209),(608,149)]
    sampling=tuple(value for horizontal,vertical in patch for value in (horizontal*original.width/840,vertical*original.height/473))
    rectified=original.transform((width,height),Image.Transform.QUAD,sampling,Image.Resampling.BICUBIC)
    density=np.asarray(rectified,dtype=float)
    lighting=np.asarray(rectified.filter(ImageFilter.GaussianBlur(86)),dtype=float)
    variation+=1.55*(density-lighting)+.32*(lighting-np.median(lighting))
    for index in range(19):
        spot_x=rng.choice([rng.uniform(15,.17*width),rng.uniform(.77*width,width-15)])
        spot_y=rng.choice([rng.uniform(12,.20*height),rng.uniform(.78*height,height-12)])
        span_x,span_y=rng.uniform(5,29),rng.uniform(5,23)
        stain=np.exp(-((columns-spot_x)/span_x)**2-((rows-spot_y)/span_y)**2)
        variation-=rng.uniform(6,26)*stain*np.clip(1+2.1*speckle,.08,2)
    colors = np.clip(np.array(base)[None,None,:]+variation[:,:,None],0,255).astype('uint8')
    image = Image.fromarray(colors)
    pen = ImageDraw.Draw(image,"RGBA")
    for index in range(18500):
        left, top = rng.integers(0, width), rng.integers(0, height)
        length = rng.uniform(1.3, 10)
        direction = rng.uniform(0, np.pi*2)
        shade = (83,63,40,int(rng.integers(9,45))) if index%3 else (244,229,196,38)
        pen.line((left,top,left+np.cos(direction)*length,top+np.sin(direction)*length),fill=shade,width=1)
    for index in range(180):
        left, top = rng.integers(0,width), rng.integers(0,height)
        radius = rng.uniform(.6,2.8)
        pen.ellipse((left-radius,top-radius,left+radius,top+radius),fill=(101,62,32,int(rng.integers(15,55))))
    if notebook:
        font = ImageFont.truetype("C:/Windows/Fonts/simkai.ttf", 48)
        for index, char in enumerate("随记"):
            pen.text((width*.76-index*2,height*.18+index*58),char,font=font,fill=(53,46,35,179))
        pen.line((width*.735,height*.168,width*.734,height*.30),fill=(86,70,46,65),width=2)
    image.save(work/filename,quality=94,subsampling=0)


def wear_map(work):
    rng=np.random.default_rng(3704)
    width,height=1700,950
    field=Image.new("L",(width,height),0)
    pen=ImageDraw.Draw(field)
    for index in range(1100):
        left=float(rng.uniform(0,width));top=float(rng.uniform(0,height))
        length=float(rng.uniform(2,42)**1.12)
        angle=rng.normal(.02,.5) if index%3 else rng.uniform(0,math.pi)
        if top>height*.86 or min(left,width-left)<100:
            value=int(rng.uniform(50,155))
        else:
            value=int(rng.uniform(16,78))
        pen.line((left,top,left+length*np.cos(angle),top+length*np.sin(angle)), fill=value,width=int(rng.choice([1,1,1,2])))
    for center_x,center_y,radius in [(.83,.34,49),(.165,.67,39)]:
        bounds=(width*center_x-radius,height*center_y-radius*.94,width*center_x+radius,height*center_y+radius*.94)
        pen.arc(bounds,28,109,fill=65,width=2)
        pen.arc(bounds,145,235,fill=40,width=2)
    rows,cols=np.indices((height,width))
    coast=noise(rng,width,height,180)
    edge=np.minimum.reduce([cols,width-1-cols,rows,height-1-rows])
    polish=95*np.exp(-edge/(2.5+3.5*(1+coast)))*np.clip(.68+noise(rng,width,height,14),0,1)
    Image.fromarray(np.clip(np.asarray(field,dtype=float)+polish,0,255).astype('uint8')).save(work/"wear.png")


def prepare(work):
    work.mkdir(parents=True,exist_ok=True)
    entries = json.loads((HERE/"assets.json").read_text(encoding="utf-8"))
    with ThreadPoolExecutor(max_workers=6) as pool:
        pending = [pool.submit(fetch, work, name, entry) for name,entry in entries.items()]
        for task in pending:
            task.result()
    paper(work,"notebook.jpg",(165,143,109),831,True)
    paper(work,"wrapper.jpg",(144,113,79),939,False)
    wear_map(work)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("work",type=Path)
    prepare(parser.parse_args().work)
