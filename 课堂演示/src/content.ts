const lessonQuestion = '遵义会议为什么成为长征的转折点？';
const lessonConclusion = '长征初期严重受挫后，黎平会议调整进军方向，遵义会议集中解决军事和组织问题，开启了党独立自主解决中国革命实际问题的新阶段。';
const reviewQuestion = '哪份材料能说明遵义会议为什么成为转折点？';

const troopRecords = [
  { date: '1934.10', label: '长征出发', amount: '8.6 万余人' },
  { date: '1934.12', label: '渡过湘江', amount: '3 万余人' },
] as const;

const zunyiMaterials = [
  { title: '会前形势', lines: ['第五次反“围剿”失败，长征初期又遭严重挫折。', '湘江战役损失重大，黎平会议决定改变进军方向。'] },
  { title: '会议讨论', lines: ['会议总结第五次反“围剿”失败和长征初期受挫的经验教训。', '会议集中解决当时具有决定意义的军事和组织问题。'] },
];

const teachingPaces = [18, 30, 40, 50] as const;
type TeachingPace = typeof teachingPaces[number];
type TeachingBeat = {
  seconds: [quick: number, short: number, full: number, extended: number];
  notes: string;
  question?: string;
  extension?: string;
};

const mapBeat: TeachingBeat = {
  seconds: [45, 90, 120, 180],
  question: lessonQuestion,
  notes: '拖动地形换角度，滚轮拉近，或切到俯视。请学员依次指出于都、湘江、黎平和遵义。把路线留在屏幕上，让他们带着两个问题入场：沿途遇到了什么，为什么会调整？',
  extension: '多留 1 分钟。请一位学员选最想追问的一站，说出初步判断。记下原话，留到结尾核对。',
};

const reviewBeats: [TeachingBeat, TeachingBeat] = [
  {
    seconds: [75, 105, 165, 165],
    notes: '先请学员按地图顺序说四站各发生了什么。请另一位用三句话复述：遇到的困难、作出的调整、支持这句话的材料。必要时点「回看」找证据。',
    question: '哪一站的证据能补全刚才的解释？',
  },
  {
    seconds: [45, 75, 105, 165],
    notes: '先听学员引用两站证据，再揭示结论。只纠正一个关键遗漏，让学员把修改过的一句再说一遍。',
    question: reviewQuestion,
    extension: '多留 1 分钟。复述开场记下的原判断，请学员用来自两个地点的证据说清哪一步需要修正。',
  },
];

type ProbePoint = {
  id: string;
  label: string;
  x: number;
  y: number;
  title: string;
  detail: string;
  zoom?: number;
};

type StepItem = {
  id: string;
  date?: string;
  title: string;
  detail: string;
};

type LessonClip = { mode:'loop'; key:'yudu'|'xiang'|'zunyi' }
  | { mode:'opening'; key:'opening' }
  | { mode:'transition'; key:'yudu-preparation'; caption:{start:number; end:number; text:string} };

type NonEmptyList<T> = readonly [T, ...T[]];
type InlineStoryPage =
  | { activity: 'military' | 'organization'; steps: NonEmptyList<StepItem>; conclusion?: never }
  | { activity: 'result'; steps: readonly [StepItem, StepItem, StepItem]; conclusion: string };
type StoryPage = InlineStoryPage | { activity: 'houchang'; steps: NonEmptyList<StepItem>; conclusion?: never };

type LessonPage = TeachingBeat & {
  image: string;
  title: string;
  narration: NonEmptyList<string>;
  camera?: { x: number; y: number; scale: number };
  probes?: ProbePoint[];
  exploration?: ExplorationId;
  practice?: PracticeId;
  video?: LessonClip;
} & (StoryPage | {
  activity?: 'bridge' | 'crossing' | 'troops' | 'directions' | 'wujiang-view' | 'materials';
  steps?: never;
  conclusion?: never;
});

type RouteStop = { point: Point; name?: string; side?: 'left' | 'bottom' };
const routeStops: readonly RouteStop[] = [
  { point: [115.41,25.95], name: '于都' },
  { point: [114.94,25.39] }, { point: [113.95,25.55] }, { point: [112.95,25.40] },
  { point: [110.73,25.83], name: '湘江', side: 'bottom' },
  { point: [109.6258,26.31679], name: '通道' },
  { point: [109.14,26.23], name: '黎平' },
  { point: [107.47,27.07], name: '猴场', side: 'bottom' },
  { point: [107.47,27.32], name: '乌江' },
  { point: [106.93,27.69], name: '遵义', side: 'left' },
];
const route = routeStops.map(stop => stop.point);

const events: {
  id: string; name: string; place: string; date: string; timeline: string;
  routeEnd: number; review: string; pages: LessonPage[];
}[] = [
  {
    id: 'yudu', name: '于都出发', place: '江西于都', date: '1934 年 10 月', timeline: '1934.10',
    routeEnd: 0, review: '集结出发',
    pages: [
      {
        image: 'yudu-assembly', title: '于都集结',
        narration: [
          '第五次反“围剿”失败后，中央红军开始战略转移。',
          '各路队伍在于都集结。出发前，得先渡过于都河。',
          '河上没有固定桥，这么多人怎么在夜里渡过去？',
        ],
        question: '大部队从集结到渡河，需要做哪些准备？',
        seconds: [35, 35, 45, 45],
        probes: [
          { id: 'probe-farewell', label: '群众送别', x: 19, y: 47, title: '军民依依告别', detail: '夜幕降临时，驻地群众点起灯火送别即将远行的红军战士。', zoom: 1.38 },
          { id: 'probe-pack', label: '整理行装', x: 18, y: 74, title: '缝补被服与打背囊', detail: '战士抓紧出发前的最后时间缝补衣物、捆扎干粮与背囊。', zoom: 1.42 },
          { id: 'probe-map', label: '研判路线', x: 46, y: 66, title: '核对渡口与集结路线', detail: '干部围坐在灯下对照行军草图，明确部队按序列向各渡口集中。', zoom: 1.44 },
        ],
        notes: '结合地图交代中央根据地面临的局面和战略转移的背景。让学员从画面中选一项准备工作，指出看得见的细节，再请同伴补一项。'
      },
      {
        image: 'yudu-bank', title: '岸边备桥',
        narration: ['于都群众送来木料，帮助架设浮桥。', '缺铺桥面的木板，乡亲们就卸下自家的门板，抬到岸边。'],
        question: '渡河前，于都群众送来了什么？',
        seconds: [45, 70, 105, 105],
        video: {mode:'transition', key:'yudu-preparation', caption:{start:2.75,end:4.75,text:'架成后的浮桥'}},
        probes: [
          { id: 'probe-door', label: '抬送门板', x: 43, y: 58, title: '群众捐出自家门板', detail: '渡江缺乏桥面木板，群众自发卸下门板抬到岸边铺设浮桥。', zoom: 1.42 },
        ],
        notes: '请一位学员指出木板与船。讲纪念园记录的群众捐门板和出力架桥的事例。点「播放备桥短片」看搬运接识桥，用静态画面也可直接进入下一页。到桥边确认岸上的物件各起什么作用。'
      },
      {
        image: 'yudu-bridge', title: '浮桥近景',
        narration: ['浮桥由船体和桥板组成。', '先看桥下面的船，再看铺在上面的木板。', '木船托住纵梁和桥板，队伍从连成一片的桥面上通过。'],
        question: '桥面靠什么托住？',
        seconds: [55, 195, 225, 345], activity: 'bridge', practice: 'bridge-parts', exploration: 'yudu-river',
        notes: '让学员先指上方铺面，再找下方船体。点「于都河岸」可换角度看船、梁和门板，演示每段停下后再讲。请学员用一句话说明乡亲送来的材料怎样帮上夜渡。',
        extension: '多留 2 分钟。看完五段后打开「分流对照」，在同一时长内分别试一处通行、两处分流。请学员看剩在岸上的队伍，结合桥板、纵梁或船体说出当地群众怎样帮上渡河。',
      },
      {
        image: 'yudu', title: '夜渡于都河',
        narration: ['1934 年 10 月中旬，中央红军从于都河沿岸多个渡口踏上长征路。', '等最后一批人过了河，架桥的人还要趁天亮前把桥撤掉。'],
        question: '从集结到夜渡，哪一步最能看出群众的作用？',
        seconds: [30, 30, 45, 45], video: {mode:'loop',key:'yudu'},
        notes: '结合夜渡画面，请学员回顾集结、备桥、渡河三个步骤，并指出哪一步最能说明当地群众的作用。随后把问题转向长征初期遇到的困难。'
      },
    ],
  },
  {
    id: 'xiang', name: '湘江战役', place: '广西湘江上游', date: '1934 年 11 月 27 日—12 月 1 日', timeline: '1934.11–12',
    routeEnd: 4, review: '渡江受挫',
    pages: [
      {
        image: 'xiang', title: '湘江河谷',
        narration: ['中央红军渡过湘江，突破第四道封锁线，遭受重大损失。', '渡过湘江以后，队伍比出发时少了许多人。', '这样的情况下，还能沿原定方向走下去吗？'],
        question: '渡过湘江，为什么仍是一次重大挫折？',
        seconds: [45, 45, 45, 45], video: {mode:'loop',key:'xiang'},
        notes: '先让学员看河谷，交代战役发生在 11 月 27 日至 12 月 1 日。把“渡过湘江”和“遭受重大损失”作为接下来要解释的两个事实。'
      },
      {
        image: 'xiang-ford', title: '湘江渡口',
        narration: ['中央红军在广西全州、兴安之间渡过湘江。', '第四道封锁线被突破了。接下来，看看这支部队付出了多大代价。'],
        question: '渡过湘江意味着突破了第几道封锁线？',
        seconds: [45, 45, 45, 45], activity: 'crossing',
        notes: '打开渡江区域示意。指出全州、兴安之间的渡江区域，结合灌阳也在战役涉及范围内讲清区域与渡江点的区别。请学员先说突破的是第几道封锁线。'
      },
      {
        image: 'xiang-ford', title: '兵力对照',
        narration: ['把出发时的人数和渡过湘江后的人数放在一起看。', '两数的差额涵盖从出发到渡过湘江这段行程中的减员。'],
        question: '两组数字分别对应什么时点？',
        seconds: [65, 185, 185, 185], activity: 'troops', practice: 'troop-dates',
        notes: '依次揭示长征出发时的 8.6 万余人和渡过湘江后的 3 万余人。让学员读出时点，再用图说明减员差额覆盖两个时点之间的行程。请学员用“结果”和“代价”各说一句。'
      },
      {
        image: 'xiang-aftermath', title: '渡江之后',
        narration: ['突破封锁线后，中央红军面临重大损失。', '队伍需要休整，原定方向上还有重兵。', '继续往湘西北走，还是换一个方向？'],
        question: '渡江之后，为什么还需要重新考虑进军方向？',
        seconds: [55, 55, 175, 295], practice: 'crossing-evidence',
        probes: [
          { id: 'probe-survivors', label: '休整队伍', x: 25, y: 67, title: '剧烈减员后的困境', detail: '连日苦战后部队急需喘息与整编，已难以按原计划硬闯湘西北重兵防线。', zoom: 1.32 },
        ],
        notes: '让学员分别说出渡江的结果和付出的代价。指出两类材料各能支持哪一句，再讨论继续按原计划行进为什么值得重新评估。',
        extension: '多留 2 分钟。请另一组指出两类材料各自还缺什么。渡口记录没有报告兵力损失，两个时点的兵力也没有逐项交代减员发生在哪一段。',
      },
    ],
  },
  {
    id: 'liping', name: '黎平会议', place: '贵州黎平', date: '1934 年 12 月 18 日', timeline: '1934.12.18',
    routeEnd: 6, review: '改变方向',
    pages: [
      {
        image: 'liping-street', title: '黎平翘街',
        narration: ['渡过湘江后，中央红军经通道来到黎平。', '北上会合的计划还要不要继续？政治局在这里开会讨论。'],
        question: '渡过湘江后，中央红军下一步往哪里走？',
        seconds: [50, 50, 50, 50],
        probes: [
          { id: 'probe-hall', label: '会址灯火', x: 16, y: 42, title: '黎平翘街会议会址', detail: '1934 年 12 月 18 日，中共中央政治局在此召开会议，争论集中于战略去向。', zoom: 1.38 },
          { id: 'probe-march', label: '部队宿营', x: 56, y: 68, title: '从湖南通道转入黎平', detail: '面对国民党军在湘西北设下的重兵口袋，急需在黎平做出新的方向抉择。', zoom: 1.35 },
        ],
        notes: '交代中共中央政治局于 12 月 18 日在黎平召开会议。联系上一站的损失，让学员说出进军方向为何成为此时要讨论的问题。'
      },
      {
        image: 'liping-table', title: '进军方向',
        narration: ['原计划是去湘西北，与红二、红六军团会合。', '黎平会议决定改变进军方向，向贵州北部进军。'],
        question: '黎平会议怎样调整了进军方向？',
        seconds: [70, 130, 250, 250], activity: 'directions', practice: 'turn-evidence',
        camera: { x: 52, y: 61, scale: 1.15 },
        notes: '沿桌图拖动行军标记，对照原计划赴湘西北与红二、红六军团会合、会议决定改向贵州北部。展开「兵力对照」，请学员结合两个时点的差异说说为什么重新讨论方向。',
      },
      {
        image: 'liping-table', title: '猴场会议',
        narration: ['猴场会议重申了黎平会议定下的进军方向。', '部队要继续向黔北推进，眼前得先过乌江。'],
        question: '黎平会议和猴场会议分别做了什么？',
        seconds: [60, 105, 105, 165], activity: 'houchang',
        camera: { x: 28, y: 60, scale: 1.24 },
        steps: [
          { id: 'hc-1', date: '1934.12.18 · 黎平', title: '改向黔北', detail: '放弃北上湘西北与红二、六军团会合的危险原计划，避实击虚转向黔北。' },
          { id: 'hc-2', date: '1935.01.01 · 猴场', title: '重申北进方针', detail: '中共中央政治局在贵州瓮安猴场重申黎平会议战略方针，要求立即付诸行动。' },
          { id: 'hc-3', date: '1935.01 · 乌江', title: '抢渡乌江', detail: '明确部队向以遵义为中心的黔北地区挺进，为即将召开的遵义会议奠定基础。' },
        ],
        notes: '时间来到 1935 年 1 月 1 日，地点为贵州瓮安猴场。会议重申战略方针，并要求抢渡乌江、攻占遵义。让学员用“决定方向、重申方针”区分两次会议。',
        extension: '多留 1 分钟。先口头排“黎平决定、猴场重申、乌江落实”，再逐条揭示。问原计划应放在时间链哪里，保留为当时曾讨论的方向。',
      },
      {
        image: 'wujiang', title: '渡过乌江',
        narration: ['1935 年 1 月初，中央红军渡过乌江，进入黔北。', '部队继续向遵义推进。几次受挫的原因，也要在接下来的会上讨论。'],
        question: '从黎平到渡过乌江，哪些决定变成了行动？',
        seconds: [60, 75, 75, 135], activity: 'wujiang-view',
        notes: '在地形上对照乌江的俯视和斜视，回到江岸。让学员说出黎平决定和猴场重申怎样变成渡过乌江的行动，再沿路线找到遵义。',
        extension: '多留 1 分钟。请同伴把乌江图与猴场的行动要求对上。回指原计划和实际经过，请学员各用一个词给路线图上的两条线命名。',
      },
    ],
  },
  {
    id: 'zunyi', name: '遵义会议', place: '贵州遵义', date: '1935 年 1 月 15 日—17 日', timeline: '1935.01',
    routeEnd: 9, review: '总结与调整',
    pages: [
      {
        image: 'zunyi', title: '遵义会议室',
        narration: ['1935 年 1 月，中共中央政治局在遵义召开扩大会议。', '与会者回顾长征初期的受挫经历，着手解决军事和组织问题。'],
        question: '经历严重挫折后，会议最需要解决什么？',
        seconds: [45, 45, 150, 210], video: {mode:'loop',key:'zunyi'}, exploration: 'zunyi-hall',
        notes: '交代中共中央政治局扩大会议的时间。快讲可直接进入会议桌。40 或 50 分钟路径请一位学员进入材料厅，自选先查行军图或手记。请学员用两处证据说明黎平为什么改向，以及遵义开会前还有什么问题要解决。',
        extension: '可多留 1 分钟，让另一位学员按相反顺序查证，补上一条前一位没有用到的依据。',
      },
      {
        image: 'desk-front', title: '会议桌上的两份材料',
        narration: ['两份材料分别介绍会前形势和会议讨论。'],
        question: '从两份材料里，能找出会议集中解决的哪两类问题？',
        seconds: [110, 200, 170, 230], activity: 'materials',
        notes: '请学员带着刚在材料厅查到的行军图或手记到桌边。可以先翻左册，也可以先解开右册的绳结、揭封并抽纸。把两份证据放到一起，请学员指出会前面临的一处困难和会议讨论的一项议题。',
        extension: '可多留 1 分钟。请另一组按相反顺序查两册，补第一组遗漏的一类证据。',
      },
      {
        image: 'desk-front', title: '军事问题',
        narration: ['会议回顾了第五次反“围剿”失败和长征初期受挫的经过。', '与会者讨论此前指挥出了什么问题，以及接下来该怎样打。'],
        question: '会议怎样总结第五次反“围剿”和长征初期受挫的教训？',
        seconds: [45, 45, 45, 45], activity: 'military',
        camera: { x: 33, y: 56, scale: 1.38 },
        steps: [
          { id: 'mil-1', title: '回顾两段受挫经历', detail: '正视第五次反“围剿”失败与长征初期湘江惨痛损失的客观事实。' },
          { id: 'mil-2', title: '批评军事领导错误', detail: '严肃批评博古、李德等人在军事指挥上的教条主义与错误判断。' },
          { id: 'mil-3', title: '肯定正确作战原则', detail: '充分肯定毛泽东等提出的符合中国革命战争实际的战略战术原则。' },
        ],
        notes: '请学员从材料中找出会议回顾的两段经历，逐项讨论此前军事指挥的错误以及会议肯定的作战原则。'
      },
      {
        image: 'desk-front', title: '组织问题',
        narration: ['会议调整了中央领导机构。', '此后，红军的军事指挥安排也有了调整。'],
        question: '会议怎样调整中央领导机构？',
        seconds: [45, 165, 165, 165], activity: 'organization', practice: 'zunyi-issues',
        camera: { x: 63, y: 55, scale: 1.38 },
        steps: [
          { id: 'org-1', title: '调整中央领导机构', detail: '改组中央最高核心领导层，从组织上保证正确军事路线的贯彻。' },
          { id: 'org-2', title: '选举毛泽东为政治局常委', detail: '增选毛泽东为中央政治局常委，实际上开始形成新的中央领导核心。' },
          { id: 'org-3', title: '调整军事指挥安排', detail: '随后成立三人军事指挥小组，统一高效指挥红军机动突破重围。' },
        ],
        notes: '逐项讲会议选举毛泽东为中央政治局常委及随后对军事指挥的调整。结合史料解释“事实上确立”的含义，请学员说出这与总结军事教训的关系。'
      },
      {
        image: 'zunyi-dawn', title: '遵义会议的转折意义',
        narration: ['从湘江受挫到遵义开会，一路上发生了哪些变化？', '回想前面看过的材料，找出能解释这次转折的依据。'],
        question: '哪些变化使遵义会议成为转折点？',
        seconds: [55, 55, 130, 130], activity: 'result',
        steps: [
          { id:'res-ev-1', title:'湘江受挫', detail:'长征初期遭受严重损失，暴露错误军事指挥代价' },
          { id:'res-ev-2', title:'黎平转向', detail:'改向贵州北部并强渡乌江，打开进驻遵义的空间' },
          { id:'res-ev-3', title:'遵义调整', detail:'集中解决军事和组织问题，确立新的正确领导' },
        ],
        conclusion: '会议事实上确立了毛泽东在党中央和红军的领导地位，开启了党独立自主解决中国革命实际问题的新阶段。',
        notes: '先听学员分别举一条军事和组织证据。让他们把会前遇到的困难与会上作出的改变连起来。逐项核对三条依据，再读本页结论。',
      },
    ],
  },
];

