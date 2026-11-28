/**
 * 《从于都到遵义》权威党史事实库与课件工具白名单定义。
 * 课堂模型使用以下事实及动作白名单。
 */

export const COURSE_ARCHIVE = [
  {
    id: 'src-yudu-bridge', station: '于都出发',
    fact: '1934 年 10 月中旬，中央红军从于都河 8 处主要渡口夜间渡河。因缺固定桥与制式桥材，当地群众送来木船与自家门板：木船在下承托纵梁，门板铺面连成平整通道，拂晓前迅速拆撤隐蔽以防敌机侦察。',
  },
  {
    id: 'src-xiang-troops', station: '湘江战役',
    fact: '中央红军 1934 年 10 月长征出发时 8.6 万余人；1934 年 11 月 27 日至 12 月 1 日在广西全州、兴安一带突破第四道封锁线渡过湘江后，主力锐减至 3 万余人。5 万余人的差额是从出发到渡过湘江全程（含前三道封锁线）的累计减员，不可简化为湘江单次战役伤亡。',
  },
  {
    id: 'src-xiang-crossing', station: '湘江战役',
    fact: '中央红军拼死突破第四道封锁线，战术上完成了过江突围，但付出极惨重代价，暴露出此前“左”倾教条主义军事指挥与搬家式转移难以为继。',
  },
  {
    id: 'src-liping-turn', station: '黎平会议',
    fact: '1934 年 12 月 18 日黎平会议召开。国民党军在湘西北通道至湘西一线布置重兵口袋阵堵截红军与红二、红六军团会合；中央政治局采纳毛泽东意见，果断放弃北上湘西北原计划，决定向敌军力量薄弱的贵州北部（黔北）进军。',
  },
  {
    id: 'src-houchang-wujiang', station: '黎平会议',
    fact: '1935 年 1 月 1 日猴场会议进一步明确先渡乌江北上，在遵义一带建立新根据地；随后红军突破乌江天险，为遵义会议召开赢得宝贵喘息空间。',
  },
  {
    id: 'src-zunyi-resolution', station: '遵义会议',
    fact: '1935 年 1 月 15 日至 17 日遵义会议集中解决当时最具决定意义的军事问题和组织问题：批评博古、李德在第五次反“围剿”和长征初期的错误军事指挥，增选毛泽东为中央政治局常委，取消长征前成立的“三人团”（随后于 3 月成立毛泽东、周恩来、王稼祥组成的新军事指挥小组），从机制上保障了正确军事主张的落地。',
  },
];

export const ARCHIVE_BY_ID = new Map(COURSE_ARCHIVE.map(item => [item.id, item]));

// 航点以城镇附近或课件河段为参照，精度保留到 0.01 度。
export const SANDBOX_LANDMARKS = [
  ['黎平', 109.14, 26.23],
  ['通道（县溪旧县城）', 109.63, 26.32],
  ['靖县（今靖州）', 109.69, 26.58],
  ['怀化', 110.00, 27.56],
  ['沅陵', 110.39, 28.45],
  ['永顺', 109.85, 29.00],
  ['桑植', 110.16, 29.40],
  ['锦屏', 109.20, 26.67],
  ['清水江（课件河段）', 108.95, 26.78],
  ['榕江', 108.52, 25.93],
  ['从江', 108.91, 25.75],
  ['镇远', 108.42, 27.05],
  ['施秉', 108.12, 27.03],
  ['黄平', 107.90, 26.90],
  ['凯里', 107.98, 26.58],
  ['独山', 107.54, 25.83],
  ['瓮安', 107.47, 27.07],
  ['猴场（瓮安草塘）', 107.56, 27.18],
  ['乌江（课件河段）', 107.47, 27.32],
  ['遵义', 106.93, 27.69],
  ['桂林', 110.29, 25.27],
  ['兴安', 110.67, 25.61],
  ['全州', 111.07, 25.93],
  ['湘江（全州至兴安课件河段）', 110.73, 25.83],
  ['于都（课前路线参照）', 115.41, 25.95],
];

export const COURSE_PAGES = [
  '于都集结', '岸边备桥', '浮桥近景', '夜渡于都河',
  '湘江河谷', '湘江渡口', '湘江留下的启示', '渡江之后',
  '黎平翘街', '进军方向', '猴场会议', '渡过乌江',
  '遵义会议室', '会议桌上的两份材料', '军事问题', '组织问题', '遵义会议的转折意义',
];

export const COURSE_HOTSPOTS = [
  'probe-farewell', 'probe-pack', 'probe-map', 'probe-door',
  'boat', 'plank', 'xiang-reflection',
];

export const ARCHIVE_MODALS = ['troop-records'];
export const DESK_OBJECTS = ['journal', 'dossier', 'map'];

export function archivePromptBlock() {
  return COURSE_ARCHIVE.map(item => `[${item.id}] ${item.station}：${item.fact}`).join('\n');
}

export function sanitizeDirectorActions(actions) {
  if (!Array.isArray(actions)) return [];
  const safe = [];
  for (const act of actions.slice(0, 4)) {
    if (!act || typeof act !== 'object') continue;
    if (act.type === 'navigate_page' && typeof act.pageTitle === 'string' && COURSE_PAGES.includes(act.pageTitle)) {
      safe.push({ type: 'navigate_page', pageTitle: act.pageTitle });
    } else if (act.type === 'focus_hotspot' && typeof act.key === 'string' && COURSE_HOTSPOTS.includes(act.key)) {
      safe.push({ type: 'focus_hotspot', key: act.key });
    } else if (act.type === 'compare_liping_routes' && (act.side === 'east' || act.side === 'west' || act.side === 'both')) {
      safe.push({ type: 'compare_liping_routes', side: act.side });
    } else if (act.type === 'open_archive' && typeof act.archiveId === 'string' && ARCHIVE_MODALS.includes(act.archiveId)) {
      safe.push({ type: 'open_archive', archiveId: act.archiveId });
    } else if (act.type === 'open_desk_object' && DESK_OBJECTS.includes(act.object)) {
      safe.push({ type: 'open_desk_object', object: act.object });
    } else if (act.type === 'open_review' && (!Object.hasOwn(act, 'conclusion') || typeof act.conclusion === 'boolean')) {
      safe.push({ type: 'open_review', conclusion: act.conclusion === true });
    }
  }
  return safe;
}
