import * as THREE from 'three';

export const routes = {
  title: '行军图',
  original: '原议北上湘西，与红二、红六军团会合，集中力量。',
  changed: '黎平会议决定改向黔北，绕开湘西的重兵，争取在遵义一带建立新的根据地。',
  compare: '湘江之后，部队减员严重。继续北上，还没与友军会合，就可能先遇上一场硬仗。',
};

export const stations = {
  '湘江': '中央红军渡过湘江后，由出发时的 8.6 万余人减至 3 万余人。新的进军方向必须考虑部队还能承受的损失。',
  '黎平': '1934 年 12 月 18 日，中央政治局讨论原议湘西与西进贵州两条方向，决定改向黔北。',
  '猴场': '猴场会议重申黎平决定，明确接下来向乌江推进。',
  '乌江': '突破乌江，使部队得以继续向黔北推进，抵达遵义。',
  '遵义': '1935 年 1 月 15 日至 17 日，中央政治局在遵义召开扩大会议，集中解决军事和组织问题。',
  '湘西北': '原定在湘西与红二、红六军团会合。湘江作战后，部队减员，沿原方向又会遇到已集结的重兵。',
};

const places = [
  ['湘江', 110.73, 25.83, 13, -14],
  ['黎平', 109.14, 26.23, 14, 26],
  ['猴场', 107.47, 27.07, -62, 26],
  ['乌江', 107.42, 27.32, 16, 0],
  ['遵义', 106.93, 27.69, -65, -16],
  ['湘西北', 110.41, 28.76, 14, -4],
];
const redirect = [[109.14, 26.23], [108.54, 26.58], [107.47, 27.07], [107.42, 27.32], [106.93, 27.69]];
const original = [[109.14, 26.23], [109.48, 27.10], [110.41, 28.76]];
const incoming = [[110.73, 25.83], [109.67, 26.16], [109.14, 26.23]];

export function createRouteBoard(terrain) {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 546;
  const base = document.createElement('canvas');
  [base.width, base.height] = [canvas.width, canvas.height];
  const paper = base.getContext('2d');
  const box = { x: 31, y: 78, w: 898, h: 412 };
  const bounds = { left: 105.83, right: 111.65, top: 29.49, bottom: 25.42 };
  const xy = (lon, lat) => [
    box.x + (lon - bounds.left) / (bounds.right - bounds.left) * box.w,
    box.y + (bounds.top - lat) / (bounds.top - bounds.bottom) * box.h,
  ];
  const relief = terrain.image;
  paper.fillStyle = '#d6c198';
  paper.fillRect(0, 0, base.width, base.height);
  paper.filter = 'grayscale(90%) sepia(36%) contrast(82%) brightness(113%)';
  paper.drawImage(relief, (bounds.left - 104.5) / 14 * relief.width,
    (30.65 - bounds.top) / 6.8 * relief.height,
    (bounds.right - bounds.left) / 14 * relief.width,
    (bounds.top - bounds.bottom) / 6.8 * relief.height, box.x, box.y, box.w, box.h);
  paper.filter = 'none';
  paper.fillStyle = '#e1c99a48';
  paper.fillRect(box.x, box.y, box.w, box.h);
  paper.strokeStyle = '#746044';
  paper.lineWidth = 1.4;
  paper.strokeRect(box.x, box.y, box.w, box.h);
  paper.fillStyle = '#37291d';
  paper.font = 'bold 31px SimSun, serif';
  paper.fillText('黎平至遵义 · 行军方向', 31, 53);
  paper.font = '21px Microsoft YaHei, sans-serif';
  paper.fillText('原议湘西', 37, 523);
  paper.textAlign = 'right';
  paper.fillText('改向黔北', 921, 523);
  paper.textAlign = 'left';

  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  function line(path, style, weight, dash = []) {
    ctx.beginPath();
    path.forEach(([lon, lat], index) => ctx[index ? 'lineTo' : 'moveTo'](...xy(lon, lat)));
    ctx.setLineDash(dash);
    ctx.strokeStyle = style;
    ctx.lineWidth = weight;
    ctx.stroke();
  }
  function paint(progress, compared = false, station = '') {
    ctx.drawImage(base, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    line(incoming, compared ? '#624936' : '#72634eaa', compared ? 6 : 4);
    const oldAlpha = 0.28 + 0.72 * (1 - progress);
    const newAlpha = 0.28 + 0.72 * progress;
    line(original, `rgba(49, 83, 93, ${oldAlpha})`, 5 + 4 * (1 - progress), [14, 12]);
    line(redirect, `rgba(145, 49, 36, ${newAlpha})`, 5 + 4 * progress);
    ctx.setLineDash([]);
    for (const [label, lon, lat, dx, dy] of places) {
      const [x, y] = xy(lon, lat);
      ctx.fillStyle = label === station ? '#9a3828' : '#f5e5bb';
      ctx.strokeStyle = '#4e382a';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(x, y, label === station ? 11 : label === '湘江' && compared ? 8 : 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      ctx.font = 'bold 22px Microsoft YaHei, sans-serif';
      ctx.lineWidth = 3.1;
      ctx.strokeStyle = '#efdfbb';
      ctx.strokeText(label, x + dx, y + dy);
      ctx.fillStyle = '#392f22';
      ctx.fillText(label, x + dx, y + dy);
    }
    texture.needsUpdate = true;
  }
  paint(0);
  function placeAt(uv) {
    const x = uv.x * canvas.width;
    const y = (1 - uv.y) * canvas.height;
    let closest = '';
    let distance = 29;
    for (const [name, lon, lat, dx, dy] of places) {
      const [px, py] = xy(lon, lat);
      const labelX = px + dx + name.length * 8.4;
      const d = Math.min(Math.hypot(px - x, py - y), Math.hypot(labelX - x, py + dy - 8 - y));
      if (d < distance) {
        distance = d;
        closest = name;
      }
    }
    return closest;
  }
  return { canvas, texture, paint, placeAt };
}
