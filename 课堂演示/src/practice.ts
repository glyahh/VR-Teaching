type PracticeId = 'bridge-parts' | 'troop-dates' | 'crossing-evidence' | 'turn-evidence' | 'zunyi-issues';
type PracticeQuestion = {
  prompt: string;
  options: [string, string];
  answer: 0 | 1;
  retry: string;
  evidence: string;
  focus?: 'plank'|'boat'|'before'|'after'|'dates'|'routes';
  column?: string;
};
type Practice = {
  title: string;
  from: TeachingPace;
  teacher: string;
  questions: [PracticeQuestion, ...PracticeQuestion[]];
};

const practices: Record<PracticeId, Practice> = {
  'bridge-parts': {
    title: '浮桥结构与应急协作', from: 30,
    teacher: '留 2 分钟。让学员从工程制约角度分析门板与渔船的分工，并追问天亮前拆桥的战术原因。',
    questions: [
      { prompt: '河宽缺桥材，乡亲卸下的门板最先补上哪块工程短板？', options: ['连片桥面通道','水下抗流承托'], answer: 0, focus: 'plank',
        retry: '看亮起的上方铺面。没有平整连续的桥面，夜行重装队伍无法通行。', evidence: '门板铺在纵梁上连成平整通道，解决了大部队夜间快速通过的桥面短板。' },
      { prompt: '桥下排开的渔船，在力学与战术上起什么关键作用？', options: ['仅作岸边摆渡备船','承托纵梁并便于拂晓前拆撤'], answer: 1, focus: 'boat',
        retry: '看亮起的下方船身。纵梁和桥板的全部重量压在谁身上，天亮前又怎么隐蔽？', evidence: '一排木船在下方托住纵梁与桥面，过河后还能在拂晓前迅速拆撤隐蔽。' },
    ],
  },
  'troop-dates': {
    title: '史料口径与归因辨析', from: 30,
    teacher: '留 2 分钟。先核对两组数字的精确时点，再辨析“湘江一战牺牲五万多人”是否严谨。',
    questions: [
      { prompt: '史料中的「8.6 万余人」锚定在哪个时间点？', options: ['湘江开战前夕','1934 年 10 月长征出发时'], answer: 1, focus: 'before',
        retry: '核对两行日期。8.6 万余人对应的是于都出发时的总兵力。', evidence: '8.6 万余人对应 1934 年 10 月长征出发时。' },
      { prompt: '「3 万余人」对应哪一时点的兵力统计？', options: ['1934 年 12 月渡过湘江后','突破第一道封锁线后'], answer: 0, focus: 'after',
        retry: '核对第二组时点标签，它记录的是渡过湘江之后的主力余部。', evidence: '3 万余人对应 1934 年 12 月渡过湘江后。' },
      { prompt: '若有人说“湘江一战牺牲了五万多人”，这一说法严谨吗？', options: ['不严谨，差额覆盖出发至渡江后的全程累计减员','严谨，两数之差就是湘江单次战役伤亡'], answer: 0, focus: 'dates',
        retry: '回看最早一组时间标签：10 月出发到 12 月渡江之间，还包含前三道封锁线沿途损耗。', evidence: '不严谨。从 8.6 万余人到 3 万余人是从出发到渡过湘江全程的累计减员，不只发生在湘江一战。' },
    ],
  },
  'crossing-evidence': {
    title: '战术结果与战略代价', from: 40,
    teacher: '留 2 分钟。两组分别挑出支撑“突围结果”与“战略代价”的依据，说明为什么不能只看单一指标。',
    questions: [
      { prompt: '哪条史料直接证明“主力完成了战术突围”？', options: ['两个时点的兵力对照','全州、兴安一带的渡江记录'], answer: 1, column: '渡江结果',
        retry: '找直接写明红军在哪里过江、突破第四道封锁线的作战记录。', evidence: '全州、兴安一带渡江记录证明，中央红军拼死突破了第四道封锁线。' },
      { prompt: '哪条史料能说明“战术过江后战略上已难以为继”？', options: ['两个时点的兵力对照','全州、兴安一带的渡江记录'], answer: 0, column: '付出代价',
        retry: '仅看渡江地点看不出损耗，需找同时记录出发与渡江后人数的兵力对照。', evidence: '兵力由出发时 8.6 万余人减至渡江后 3 万余人，说明再按原打法硬拼已撑不住。' },
    ],
  },
  'turn-evidence': {
    title: '逆境中的路线权衡', from: 40,
    teacher: '留 2 分钟。对照原定路线与敌我态势，请学员说明为什么既定方案与现场实情冲突时必须及时转轨。',
    questions: [
      { prompt: '面对湘西北重兵堵截与减员过半，黎平会议决定转向哪里？', options: ['敌军防守薄弱的贵州北部','按原计划硬闯湘西北会合'], answer: 0, focus: 'routes',
        retry: '看舆图上的「原计划」与「会议决定」，哪条方向避开了重兵口袋阵？', evidence: '黎平会议放弃北上湘西北，果断改向敌军力量薄弱的贵州北部。' },
      { prompt: '在会议争论中，哪类依据最能说服多数同志放弃原定路线？', options: ['原定文件已写明会合目标','渡江后兵力锐减与前方重兵堵截的现实对比'], answer: 1,
        retry: '脱离现场实情照本宣科代价太大，找能直接证明硬闯风险的现实依据。', evidence: '兵力锐减与前方重兵堵截的现实对比表明，必须立足实际及时转轨。' },
    ],
  },
  'zunyi-issues': {
    title: '治标纠偏与机制落地', from: 30,
    teacher: '留 2 分钟。结合桌上两册材料，区分“怎么打”的军事纠偏与“由谁指挥”的组织保障。',
    questions: [
      { prompt: '黎平已改对了方向，遵义仍集中追查此前受挫教训，归入哪类核心问题？', options: ['军事问题：不纠偏错误指挥原则，换了路还会吃亏','组织问题：只需更换行军路线图即可'], answer: 0,
        retry: '看摘要里的两段受挫经历，会议追查的是脱离实际的军事领导与作战原则。', evidence: '属于军事问题。会议集中总结第五次反“围剿”和长征初期的军事指挥教训。' },
      { prompt: '增选毛泽东为政治局常委并取消原“三人团”，解决的是哪类根本问题？', options: ['军事问题：仅调整单次战役的兵力编组','组织问题：用领导机制调整保障正确主张落地'], answer: 1,
        retry: '留意“调整中央领导机构”，改组领导核心是为了让正确军事原则能真正执行。', evidence: '属于组织问题。会议调整中央领导机构，选举毛泽东为政治局常委，从机制上保障纠偏落地。' },
    ],
  },
};

type PracticeState = { question: number; shown: number[]; retry: boolean } | null;
let currentPractice: ReturnType<typeof mountPractice> | undefined;
const completedPractices = new Set<PracticeId>();

function mountPractice(id: PracticeId, scene: HTMLElement, caption: HTMLElement,
  first: () => string, showReference?: (focus: PracticeQuestion['focus']) => void) {
  const practice = practices[id];
  let state: PracticeState = null;
  let choice: number | undefined;
  const panel = element('section','practice');
  panel.hidden = true;
  const head = element('div','practice-head');
  const heading = element('h2','practice-title',practice.title);
  heading.tabIndex = -1;
  const counter = element('span','practice-step');
  counter.setAttribute('aria-hidden','true');
  head.append(heading,counter);
  const prompt = element('p','practice-prompt');
  const options = element('div','practice-options');
  const feedback = element('p','practice-feedback');
  feedback.setAttribute('role','status');
  const board = element('div','practice-board');
  panel.append(head,prompt,options,feedback,board);

  const entry = control('展开练习',()=>{
    if (state) {
      showPractice(null);
      return;
    }
    const selected = practice.questions.findIndex(item=>item.focus === first());
    showPractice({question:Math.max(0,selected),shown:[],retry:false});
    heading.focus({preventScroll:true});
  },'practice-entry');
  entry.setAttribute('aria-label','展开练习 · '+practice.title);
  entry.setAttribute('aria-expanded','false');
  const confirm = control('核对',()=>{
    if (!state || choice === undefined) return;
    if (choice === practice.questions[state.question].answer) {
      showAnswer();
    } else {
      showPractice({...state,retry:true});
      options.querySelector('button')?.focus({preventScroll:true});
    }
  },'primary');
  const reveal = control('揭示答案',showAnswer);
  const advance = control('下一题',()=>{
    if (!state) return;
    const allDone = state.shown.length >= practice.questions.length;
    if (allDone) {
      recordLessonProgress(completedPractices,id);
      soundscape.playSfx('complete');
      showPractice(null);
      return;
    }
    // 优先跳转到下一道尚未核对的题目，避免死循环
    let nextQ = (state.question + 1) % practice.questions.length;
    for (let step = 1; step <= practice.questions.length; step++) {
      const candidate = (state.question + step) % practice.questions.length;
      if (!state.shown.includes(candidate)) {
        nextQ = candidate;
        break;
      }
    }
    showPractice({...state,question:nextQ,retry:false});
    heading.focus({preventScroll:true});
  });
  const actions = element('div','practice-actions');
  actions.append(confirm,reveal,advance);
  panel.append(actions);

  function showAnswer() {
    if (state && !state.shown.includes(state.question)) {
      const nextShown = [...state.shown,state.question];
      if (nextShown.length >= practice.questions.length) {
        recordLessonProgress(completedPractices,id);
        soundscape.playSfx('complete');
      } else {
        soundscape.playSfx('confirm');
      }
      showPractice({...state,shown:nextShown,retry:false});
      advance.focus({preventScroll:true});
    }
  }

  function showPractice(next: PracticeState) {
    const wasOpen = Boolean(state);
    state = next;
    const item = state ? practice.questions[state.question] : undefined;
    const answered = Boolean(state?.shown.includes(state.question));
    const allDone = Boolean(state && state.shown.length >= practice.questions.length);
    choice = undefined;
    panel.hidden = !state;
    caption.hidden = Boolean(state);
    entry.textContent = state ? '返回' : '展开练习';
    entry.setAttribute('aria-label',state ? '返回原页' : '展开练习 · '+practice.title);
    entry.setAttribute('aria-expanded',String(Boolean(state)));
    scene.dataset.practicing = String(Boolean(state));
    scene.dataset.practiceFocus = item?.focus ?? '';
    showReference?.(state?.retry || answered ? item?.focus : undefined);
    window.dispatchEvent(new Event('lesson-reading'));
    if (!state || !item) {
      if (wasOpen) entry.focus({preventScroll:true});
      return;
    }
    counter.textContent = (state.question + 1) + ' / ' + practice.questions.length;
    counter.hidden = practice.questions.length < 2;
    prompt.textContent = item.prompt;
    options.replaceChildren(...item.options.map((value,index)=>{
      const correct = answered && index === item.answer;
      const option = control(value,()=>{
        choice = index;
        Array.from(options.children).forEach((node,i)=>node.setAttribute('aria-pressed',String(i===index)));
        confirm.disabled = false;
      },'practice-option',correct ? 'check' : undefined);
      option.disabled = answered;
      option.dataset.correct = String(correct);
      option.setAttribute('aria-pressed','false');
      return option;
    }));
    feedback.hidden = !(state.retry || (answered && !item.column));
    feedback.dataset.retry = String(state.retry);
    if (state.retry) feedback.replaceChildren(svgIcon('info'),element('span','',item.retry));
    else if (answered && !item.column) feedback.replaceChildren(svgIcon('check'),element('span','',item.evidence));
    else feedback.replaceChildren();
    board.replaceChildren(...practice.questions.flatMap(({column,evidence},index)=>{
      if (!column) return [];
      const cell = element('div','practice-evidence');
      cell.append(element('strong','',column));
      if (state?.shown.includes(index)) cell.append(element('p','',evidence));
      return [cell];
    }));
    board.hidden = !board.childElementCount;
    confirm.hidden = reveal.hidden = answered;
    confirm.disabled = true;
    advance.hidden = !allDone && practice.questions.length < 2;
    advance.classList.toggle('primary', allDone);
    if (allDone) setButtonContent(advance, '完成练习', 'check');
    else setButtonContent(advance, '下一题', 'arrowRight', true);
  }

  return {panel, entry, close:()=>{
    if (!state) return false;
    showPractice(null);
    return true;
  }};
}
