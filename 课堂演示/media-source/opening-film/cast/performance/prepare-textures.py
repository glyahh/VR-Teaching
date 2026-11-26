"""Prepare the offline performance wardrobe from the CC0 system asset pack."""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

parser=argparse.ArgumentParser()
parser.add_argument("pack",type=Path)
parser.add_argument("linen",type=Path)
parser.add_argument("output",type=Path)
args=parser.parse_args()
args.output.mkdir(parents=True,exist_ok=True)
def resized(path,side):
    im=Image.open(args.pack/path)
    im.thumbnail((side,side),Image.Resampling.LANCZOS)
    return im
for kind,src in (("young","young_asian_male/young_lightskinned_male_diffuse3.png"),
                 ("middle","middleage_asian_male/middleage_lightskinned_male_diffuse2.png")):
    image=resized("skins/"+src,1536).convert("RGB")
    image.save(args.output/f"skin-{kind}.jpg",quality=92,subsampling=0)
for base,name,side in (("eyes/materials/brown_eye.png","eye.png",512),
                       ("hair/short01/short01_diffuse.png","hair.png",1024),
                       ("eyebrows/eyebrow007/eyebrow007.png","brows.png",512),
                       ("clothes/shoes04/shoes04_diffuse.png","shoe.jpg",768),
                       ("clothes/shoes04/shoes04_normal.png","shoe-n.jpg",768)):
    image=resized(base,side)
    if name=="shoe.jpg":
        image=ImageOps.colorize(image.convert("L"),(21,21,19),(140,132,115))
    if name.endswith(".jpg"):
        image.convert("RGB").save(args.output/name,quality=92)
    else:
        image.save(args.output/name)
folder=Path("clothes/male_casualsuit03")
normal=resized(folder/"male_casualsuit03_normal.png",1024)
normal.convert("RGB").save(args.output/"workshirt-normal.jpg",quality=95,subsampling=0)
ao=np.asarray(resized(folder/"male_casualsuit03_ao.png",1024).convert("L"),dtype=float)/255
linen=Image.open(args.linen).convert("L").resize((344,344),Image.Resampling.LANCZOS)
grain=np.tile(np.asarray(linen,dtype=float),(3,3))[:1024,:1024]
grain-=np.median(grain)
diff=np.asarray(resized(folder/"male_casualsuit03_diffuse.png",1024).convert("RGB"),dtype=float)
# Keep the original shirt buttons and seam marks while replacing the coloured stripe weave.
neutral=np.max(diff,axis=2)-np.min(diff,axis=2)
buttons=np.clip((np.mean(diff,axis=2)-110)/80,0,1)*np.clip(1-neutral/34,0,1)
field=149+65*ao+np.clip(grain*.75,-33,29)-30*buttons
cloth=np.stack((field*1.012,field,field*.979),axis=2)
Image.fromarray(np.clip(cloth,0,255).astype('uint8')).save(args.output/"workshirt-shading.jpg",quality=94)
