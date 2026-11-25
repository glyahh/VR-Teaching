import * as THREE from 'three';

export const routes = {
  title: '行军图',
  original: '原议北上湘西，与红二、红六军团会合，集中力量。',
  changed: '黎平会议决定改向黔北，绕开湘西的重兵，争取在遵义一带建立新的根据地。',
  compare: '湘江之后，部队减员严重。继续北上，还没与友军会合，就可能先遇上一场硬仗。',
};

export const stations = {
  '湘江': '中央红军渡过湘江后，由出发时的 8.6 万余人减至 3 万余人。下一步往哪走，必须先掂量部队还能承受多大代价。',
  '黎平': '1934 年 12 月 18 日，中央政治局在黎平权衡北上湘西和西进贵州两条路，决定改向黔北。',
  '猴场': '1935 年 1 月 1 日，猴场会议重申黎平决定，要求部队立刻向乌江推进。',
  '乌江': '强渡乌江后，部队顺利向黔北推进，最终抵达遵义。',
  '遵义': '1935 年 1 月 15 日至 17 日，中央政治局在遵义召开扩大会议，集中解决军事和组织问题。',
  '湘西北': '原定去湘西北与红二、红六军团会合。湘江一战后部队减员严重，继续北上还会迎头撞上敌军重兵。',
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
const bounds = { left: 105.83, right: 111.65, top: 29.49, bottom: 25.42 };
export const deskRouteMap = { bounds, places, original, revised: redirect, incoming, routes };

export function createRouteBoard(terrain) {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 546;
  const base = document.createElement('canvas');
  [base.width, base.height] = [canvas.width, canvas.height];
  const paper = base.getContext('2d');
  const box = { x: 31, y: 78, w: 898, h: 412 };
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
  function lineOn(target, path, style, weight, dash = []) {
    target.beginPath();
    path.forEach(([lon, lat], index) => target[index ? 'lineTo' : 'moveTo'](...xy(lon, lat)));
    target.setLineDash(dash);
    target.strokeStyle = style;
    target.lineWidth = weight;
    target.stroke();
  }
  function drawPlaces(target, list, { station = '', compared = false, highlight = '#f5e5bb', halo = '#efdfbb', ink = '#392f22' } = {}) {
    target.setLineDash([]);
    for (const [label, lon, lat, dx, dy] of list) {
      const [x, y] = xy(lon, lat);
      target.fillStyle = label === station ? '#9a3828' : highlight;
      target.strokeStyle = '#4e382a';
      target.lineWidth = 2.6;
      target.beginPath();
      target.arc(x, y, label === station ? 11 : label === '湘江' && compared ? 8 : 6, 0, 2 * Math.PI);
      target.fill();
      target.stroke();
      target.font = 'bold 22px Microsoft YaHei, sans-serif';
      target.lineWidth = 3.1;
      target.strokeStyle = halo;
      target.strokeText(label, x + dx, y + dy);
      target.fillStyle = ink;
      target.fillText(label, x + dx, y + dy);
    }
  }
  function paint(progress, compared = false, station = '') {
    ctx.drawImage(base, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    lineOn(ctx, incoming, compared ? '#624936' : '#72634eaa', compared ? 6 : 4);
    const oldAlpha = 0.28 + 0.72 * (1 - progress);
    const newAlpha = 0.28 + 0.72 * progress;
    lineOn(ctx, original, `rgba(49, 83, 93, ${oldAlpha})`, 5 + 4 * (1 - progress), [14, 12]);
    lineOn(ctx, redirect, `rgba(145, 49, 36, ${newAlpha})`, 5 + 4 * progress);
    drawPlaces(ctx, places, { station, compared });
    texture.needsUpdate = true;
  }
  function paintBase() {
    ctx.drawImage(base, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    lineOn(ctx, incoming, '#59412e', 5.5);
    lineOn(ctx, original, 'rgba(246, 236, 212, 0.72)', 13, [14, 12]);
    lineOn(ctx, original, 'rgba(34, 72, 88, 0.98)', 9.5, [14, 12]);
    drawPlaces(ctx, places.filter(([label]) => label === '湘江' || label === '黎平' || label === '湘西北'), { compared: true });
    texture.needsUpdate = true;
  }
  function paintRevised() {
    ctx.drawImage(base, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    lineOn(ctx, incoming, '#59412e', 5.5);
    lineOn(ctx, redirect, 'rgba(246, 236, 212, 0.85)', 15);
    lineOn(ctx, redirect, '#9e1f14', 9.5);
    drawPlaces(ctx, places.filter(([label]) => label !== '湘西北'), {compared:true});
    texture.needsUpdate = true;
  }
  function createOverlay() {
    const sheet = document.createElement('canvas');
    [sheet.width, sheet.height] = [canvas.width, canvas.height];
    const pen = sheet.getContext('2d');
    pen.fillStyle = 'rgba(250, 241, 220, 0.14)';
    pen.fillRect(0, 0, sheet.width, sheet.height);
    pen.strokeStyle = 'rgba(128, 98, 62, 0.45)';
    pen.lineWidth = 2.2;
    pen.strokeRect(box.x, box.y, box.w, box.h);
    pen.lineCap = 'round';
    pen.lineJoin = 'round';
    lineOn(pen, redirect, 'rgba(255, 246, 224, 0.88)', 16);
    lineOn(pen, redirect, '#9e1f14', 10.5);
    for (const [label, lon, lat, dx, dy] of places.filter(([name]) => name === '黎平' || name === '猴场' || name === '乌江' || name === '遵义')) {
      const [x, y] = xy(lon, lat);
      pen.fillStyle = '#b42619';
      pen.strokeStyle = '#fbf0d4';
      pen.lineWidth = 3;
      pen.beginPath();
      pen.arc(x, y, 8, 0, 2 * Math.PI);
      pen.fill();
      pen.stroke();
      pen.font = 'bold 25px Microsoft YaHei, sans-serif';
      pen.lineWidth = 4.2;
      pen.strokeStyle = 'rgba(252, 243, 222, 0.96)';
      pen.strokeText(label, x + dx, y + dy);
      pen.fillStyle = '#6b160d';
      pen.fillText(label, x + dx, y + dy);
    }
    pen.font = 'bold 24px Microsoft YaHei, sans-serif';
    pen.textAlign = 'right';
    pen.lineWidth = 3.6;
    pen.strokeStyle = 'rgba(252, 243, 222, 0.95)';
    pen.strokeText('改向黔北', 921, 523);
    pen.fillStyle = '#8b1c12';
    pen.fillText('改向黔北', 921, 523);
    const overlayTexture = new THREE.CanvasTexture(sheet);
    overlayTexture.colorSpace = THREE.SRGBColorSpace;
    overlayTexture.anisotropy = 4;
    return overlayTexture;
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
  return { canvas, texture, paint, paintBase, paintRevised, createOverlay, placeAt };
}
