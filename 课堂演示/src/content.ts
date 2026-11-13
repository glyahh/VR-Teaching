export const history = 'https://www.dswxyjy.org.cn/GB/427277/462086/index.html';
export const chronology = 'https://www.dswxyjy.org.cn/n1/2021/0628/c423712-32142078.html';
export const bridgeSource = 'https://www.yudu.gov.cn/yudu/ydly/202102/83a2c09d070f4bf6adf83d49e91e8b3d.shtml';
export const xiangSource = 'https://www.dswxyjy.org.cn/n1/2020/0305/c219021-31618260.html';
export const lipingSource = 'https://www.dswxyjy.org.cn/GB/434461/434473/434996/index.html';
export const zunyiSource = 'https://www.dswxyjy.org.cn/GB/434461/434462/434832/index.html';
export const terrainSource = 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md';

export const lessonQuestion = '遵义会议为什么成为长征的转折点？';
export const lessonConclusion = '长征初期严重受挫后，黎平会议调整进军方向，遵义会议集中解决军事和组织问题，开启了党独立自主解决中国革命实际问题的新阶段。';
export const reviewQuestion = '哪份材料能说明遵义会议为什么成为转折点？';

export const zunyiMaterials = [
  { title: '会前形势', lines: ['第五次反“围剿”失败，长征初期又遭严重挫折。', '湘江战役损失重大，黎平会议决定改变进军方向。'] },
  { title: '会议讨论', lines: ['会议总结第五次反“围剿”失败和长征初期受挫的经验教训。', '会议集中解决当时具有决定意义的军事和组织问题。'] },
];

export const houchangSource = 'https://www.dswxyjy.org.cn/GB/434461/434462/434818/index.html';

type LessonPage = {
  image: string;
  title: string;
  line: string;
  minutes: number;
  notes: string;
  question?: string;
  activity?: 'bridge' | 'crossing' | 'troops' | 'directions' | 'military' | 'organization' | 'materials' | 'result';
  video?: string;
};

export const events: {
  id: string; name: string; place: string; date: string; timeline: string;
  lon: number; lat: number; routeEnd: number; review: string; pages: LessonPage[];
}[] = [
  {
    id: 'yudu', name: '于都出发', place: '江西于都', date: '1934 年 10 月', timeline: '1934.10',
    lon: 115.41, lat: 25.95, routeEnd: 0, review: '集结出发',
    pages: [
      { image: 'yudu-assembly', title: '于都集结', line: '第五次反“围剿”失败后，中央红军开始战略转移。', question: '大部队从集结到渡河，需要做哪些准备？', minutes: 2,
        notes: '先让学员在地图上找到江西于都。交代中央根据地面临的局面和战略转移的背景。追问大部队从集结走到渡河，中间需要哪些准备。' },
      { image: 'yudu-bank', title: '岸边备桥', line: '于都群众送来木料，帮助架设浮桥。', question: '渡河前，于都群众送来了什么？', minutes: 2,
        notes: '请一位学员指出画面里的木板与船，再请另一位补充人手和物资。结合纪念园讲解资料，讲当地群众出力架桥、送来木料的事例。' },
      { image: 'yudu-bridge', title: '浮桥近景', line: '浮桥由船体和桥板组成。', question: '桥面靠什么托住？', minutes: 2, activity: 'bridge',
        notes: '先给学员观察，再分两次点船体和桥板。请学员用一句话讲清两种材料各有什么作用，然后把画面与上一页的群众支援连起来。' },
      { image: 'yudu', title: '夜渡于都河', line: '1934 年 10 月中旬，中央红军从于都河沿岸多个渡口踏上长征路。', question: '从集结到夜渡，哪一步最能看出群众的作用？', minutes: 2, video: 'yudu',
        notes: '可播放夜渡短片。请学员回顾集结、备桥、渡河三个步骤，并指出哪一步最能说明当地群众的作用。随后把问题转向长征初期遇到的困难。' },
    ],
  },
  {
    id: 'xiang', name: '湘江战役', place: '广西湘江上游', date: '1934 年 11 月 27 日—12 月 1 日', timeline: '1934.11–12',
    lon: 110.73, lat: 25.83, routeEnd: 4, review: '渡江受挫',
    pages: [
      { image: 'xiang', title: '湘江河谷', line: '中央红军渡过湘江，突破第四道封锁线，遭受重大损失。', question: '渡过湘江，为什么仍是一次重大挫折？', minutes: 2, video: 'xiang',
        notes: '先让学员看河谷，交代战役发生在 11 月 27 日至 12 月 1 日。可手动播放短片。把“渡过湘江”和“遭受重大损失”作为接下来要解释的两个事实。' },
      { image: 'xiang-ford', title: '湘江渡口', line: '中央红军在广西全州、兴安之间渡过湘江。', question: '渡过湘江意味着突破了第几道封锁线？', minutes: 2, activity: 'crossing',
        notes: '打开渡江区域示意。指出全州、兴安之间的渡江区域，结合灌阳也在战役涉及范围内讲清区域与渡江点的区别。请学员先说突破的是第几道封锁线。' },
      { image: 'xiang-ford', title: '兵力对照', line: '两组兵力数据分别记录长征出发时和渡过湘江后的情况。', question: '两组数字分别对应什么时点？', minutes: 3, activity: 'troops',
        notes: '依次揭示长征出发时的 8.6 万余人和渡过湘江后的 3 万余人。让学员读出时点，再用图说明减员差额覆盖两个时点之间的行程。请学员用“结果”和“代价”各说一句。' },
      { image: 'xiang-aftermath', title: '渡江之后', line: '突破封锁线后，中央红军面临重大损失。', question: '渡江之后，为什么还需要重新考虑进军方向？', minutes: 2,
        notes: '复述结果与代价，请学员说说为什么渡江后还需要重新考虑进军方向。收束到军事形势变了，原来的计划需要重新讨论，转入黎平。' },
    ],
  },
  {
    id: 'liping', name: '黎平会议', place: '贵州黎平', date: '1934 年 12 月 18 日', timeline: '1934.12.18',
    lon: 109.14, lat: 26.23, routeEnd: 6, review: '改变方向',
    pages: [
      { image: 'liping-street', title: '黎平翘街', line: '渡过湘江后，中央红军重新讨论进军方向。', question: '渡过湘江后，中央红军下一步往哪里走？', minutes: 2,
        notes: '交代中共中央政治局于 12 月 18 日在黎平召开会议。联系上一站的损失，让学员说出进军方向为何成为此时要讨论的问题。' },
      { image: 'liping-table', title: '进军方向', line: '黎平会议重新确定了进军方向。', question: '黎平会议怎样调整了进军方向？', minutes: 2, activity: 'directions',
        notes: '先揭示原计划赴湘西北与红二、红六军团会合，再揭示会议决定改向贵州北部。请学员对着示意图复述变化，再问这个决定怎样落实。' },
      { image: 'liping-table', title: '猴场会议', line: '猴场会议重申黎平会议的战略方针。', question: '黎平会议和猴场会议分别做了什么？', minutes: 2,
        notes: '时间来到 1935 年 1 月 1 日，地点为贵州瓮安猴场。会议重申战略方针，并要求抢渡乌江、攻占遵义。让学员用“决定方向、重申方针”区分两次会议。桌面画面为教学示意。' },
      { image: 'wujiang', title: '渡过乌江', line: '1935 年 1 月初，中央红军渡过乌江，进入黔北。', question: '从黎平到渡过乌江，哪些决定变成了行动？', minutes: 2,
        notes: '让学员按黎平、猴场、乌江的顺序复述从决定到行动的过程。联系地图点出遵义，并为下一段提出新问题，即抵达遵义后还要解决什么。' },
    ],
  },
  {
    id: 'zunyi', name: '遵义会议', place: '贵州遵义', date: '1935 年 1 月 15 日—17 日', timeline: '1935.01',
    lon: 106.93, lat: 27.69, routeEnd: 8, review: '总结与调整',
    pages: [
      { image: 'zunyi', title: '遵义会议室', line: '长征初期严重受挫后，中共中央政治局在遵义召开扩大会议。', question: '经历严重挫折后，会议最需要解决什么？', minutes: 2, video: 'zunyi',
        notes: '交代中共中央政治局扩大会议的时间。请学员分别用湘江和黎平的事实概括会前处境与已经作出的改变，再听一位学员猜测会议的重点。' },
      { image: 'zunyi-documents', title: '会议桌上的两份材料', line: '两份材料分别介绍会前形势和会议讨论。', question: '从两份材料里，能找出会议集中解决的哪两类问题？', minutes: 2, activity: 'materials',
        notes: '逐一打开两份摘要，再并排投影。请学员指出材料里哪些是会前形势，哪些是会议议题。两份材料为教学摘要，桌面物件为情境示意。' },
      { image: 'zunyi-documents', title: '军事问题', line: '会议总结了第五次反“围剿”失败和长征初期受挫的教训。', question: '会议怎样总结第五次反“围剿”和长征初期受挫的教训？', minutes: 2, activity: 'military',
        notes: '展开军事问题图解。请学员从前面的材料找出会议回顾的两段经历，讲清会议批评此前军事领导上的错误，并肯定毛泽东等提出的作战基本原则。' },
      { image: 'zunyi-documents', title: '组织问题', line: '会议调整了中央领导机构和军事指挥安排。', question: '会议怎样调整中央领导机构？', minutes: 2, activity: 'organization',
        notes: '展开组织问题图解。讲会议选举毛泽东为中央政治局常委，调整军事指挥安排。结合史料解释“事实上确立”的含义，请学员说出这与总结军事教训的关系。' },
      { image: 'zunyi-dawn', title: '遵义会议的转折意义', line: '遵义会议集中解决了当时的军事和组织问题。', question: '哪些变化使遵义会议成为转折点？', minutes: 2, activity: 'result',
        notes: '先听学员用一份材料回答，再揭示结论。结合会前挫折、军事与组织调整，说明会议开启了党独立自主解决中国革命实际问题的新阶段。' },
    ],
  },
];
