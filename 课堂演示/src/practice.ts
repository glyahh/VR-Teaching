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
  source: string;
  questions: [PracticeQuestion, ...PracticeQuestion[]];
};

const practices: Record<PracticeId, Practice> = {
  'bridge-parts': {
    title: '木板和船各做什么', from: 30,
    teacher: '留 2 分钟。让学员指着浮桥选一个部件，先说作用，再为他点选、核对。随后换看另一件。',
    source: '教学摘要 · 中央红军长征出发纪念园讲解词',
    questions: [
      { prompt: '桥板在浮桥上起什么作用？', options: ['铺成通道','托住桥面'], answer: 0, focus: 'plank',
        retry: '看亮起的上方铺面。部队从哪一层通过？', evidence: '木板铺成通道。于都群众捐出门板等木料。' },
      { prompt: '船体在浮桥上起什么作用？', options: ['铺成通道','托住桥面'], answer: 1, focus: 'boat',
        retry: '看亮起的下方船身。桥板下面是什么？', evidence: '木船在桥板下，为浮桥提供承托。' },
    ],
  },
  'troop-dates': {
    title: '两个数字能说明什么', from: 30,
    teacher: '留 2 分钟。先让学员配对时点，再解释两数的差额覆盖哪段行程。误答时请他读出画面里的日期。',
    source: '教学摘要 · 《中国共产党简史》',
    questions: [
      { prompt: '8.6 万余人对应哪个时点？', options: ['渡过湘江后','长征出发时'], answer: 1, focus: 'before',
        retry: '比较两行的日期，找更早的一个时点。', evidence: '8.6 万余人对应长征出发时。' },
      { prompt: '3 万余人对应哪个时点？', options: ['渡过湘江后','长征出发时'], answer: 0, focus: 'after',
        retry: '比较两行的日期，找渡过湘江后的记录。', evidence: '3 万余人对应渡过湘江后。' },
      { prompt: '这两组数字的差额涵盖哪个范围？', options: ['出发至渡过湘江之间','仅湘江战役期间'], answer: 0, focus: 'dates',
        retry: '回看最早一组数字。它的时点早于湘江战役。', evidence: '差额涵盖两个记录时点之间的行程和多种减员。' },
    ],
  },
  'crossing-evidence': {
    title: '结果与代价怎样同时成立', from: 40,
    teacher: '留 2 分钟。让两组分别选证据，回答时要求说清出处和时点。依次核对，两条证据都保留在画面上。',
    source: '教学摘要 · 党史和文献研究院《红军长征过广西》及《中国共产党简史》',
    questions: [
      { prompt: '哪条材料支持“渡过湘江”？', options: ['两个时点的兵力对照','全州、兴安一带的渡江记录'], answer: 1, column: '渡江结果',
        retry: '找一条直接记录渡江地点和行动结果的材料。', evidence: '渡江记录表明，中央红军渡过湘江，突破第四道封锁线。' },
      { prompt: '哪条材料能看出出发后到渡江后的兵力变化？', options: ['两个时点的兵力对照','全州、兴安一带的渡江记录'], answer: 0, column: '付出代价',
        retry: '找一条同时记录出发时和渡江后人数的材料。', evidence: '兵力从长征出发时的 8.6 万余人减至渡过湘江后的 3 万余人。' },
    ],
  },
  'turn-evidence': {
    title: '哪条证据能解释改向', from: 40,
    teacher: '留 2 分钟。请学员先指路线怎么改，再回想湘江站的材料，解释为何重新考虑方向。核对后请他用自己的话补上两者的关系。',
    source: '教学摘要 · 党史和文献研究院《中央红军长征在贵州》及《中国共产党简史》',
    questions: [
      { prompt: '黎平会议决定改向哪里？', options: ['贵州北部','湘西北'], answer: 0, focus: 'routes',
        retry: '看舆图上的「原计划」和「会议决定」，找会议决定所指的方向。', evidence: '原计划赴湘西北会合，黎平会议决定改向贵州北部。' },
      { prompt: '哪条材料有助于解释为何重新讨论方向？', options: ['两条路线的终点','渡江后兵力和行军处境'], answer: 1,
        retry: '找能说明部队当时面临什么困难的材料。', evidence: '渡江后兵力锐减，原定会合方向又有重兵堵截，需要重新研判去向。' },
    ],
  },
  'zunyi-issues': {
    title: '两类问题怎么分', from: 30,
    teacher: '留 2 分钟。回想桌上两册材料，让学员从每条摘要里指出一个能判断类别的词，再归类。',
    source: '教学摘要 · 党史和文献研究院《遵义会议决议》解读',
    questions: [
      { prompt: '总结第五次反“围剿”失败与长征初期受挫的教训，归入哪类？', options: ['军事','组织'], answer: 0,
        retry: '找出摘要里的两段受挫经历，想想会议总结的是哪类指挥教训。', evidence: '这是军事问题。会议针对两段受挫总结军事领导与指挥上的教训。' },
      { prompt: '调整中央领导机构，归入哪类？', options: ['军事','组织'], answer: 1,
        retry: '圈出关键对象“中央领导机构”，再选一次。', evidence: '这是组织问题。会议调整中央领导机构，选举毛泽东为中央政治局常委。' },
    ],
  },
};

type PracticeState = { question: number; shown: number[]; retry: boolean } | null;
let currentPractice: ReturnType<typeof mountPractice> | undefined;

function mountPractice(id: PracticeId, position: number, scene: HTMLElement, caption: HTMLElement,
  first: () => string, showReference?: (focus: PracticeQuestion['focus']) => void) {
  const practice = practices[id];
  let state: PracticeState = null;
  let choice: number | undefined;
  const panel = element('section','practice');
  panel.hidden = true;
  const heading = element('h2','practice-title',practice.title);
  heading.tabIndex = -1;
  const prompt = element('p','practice-prompt');
  const options = element('div','practice-options');
  const feedback = element('p','practice-feedback');
  feedback.setAttribute('role','status');
  const board = element('div','practice-board');
  const source = element('p','practice-source',practice.source);
  panel.append(heading,prompt,options,feedback,board,source);

  const entry = control('展开练习',()=>{
    if (state) {
      publish(null);
      return;
    }
    const selected = practice.questions.findIndex(item=>item.focus === first());
    publish({question:Math.max(0,selected),shown:[],retry:false});
    heading.focus({preventScroll:true});
  },'practice-entry');
  entry.setAttribute('aria-label','展开练习 · '+practice.title);
  entry.setAttribute('aria-expanded','false');
  const confirm = control('核对',()=>{
    if (!state || choice === undefined) return;
    if (choice === practice.questions[state.question].answer) showAnswer();
    else {
      publish({...state,retry:true});
      options.querySelector('button')?.focus({preventScroll:true});
    }
  },'primary');
  const reveal = control('揭示答案',showAnswer);
  const advance = control('下一题',()=>{
    if (!state) return;
    publish({...state,question:(state.question+1)%practice.questions.length,retry:false});
    heading.focus({preventScroll:true});
  });
  if (!projectionMode) {
    const actions = element('div','practice-actions');
    actions.append(confirm,reveal,advance);
    panel.append(actions);
  }

  function showAnswer() {
    if (state && !state.shown.includes(state.question)) {
      publish({...state,shown:[...state.shown,state.question],retry:false});
      advance.focus({preventScroll:true});
    }
  }

  function restore(next: PracticeState) {
    const wasOpen = Boolean(state);
    state = next;
    const item = state ? practice.questions[state.question] : undefined;
    const answered = Boolean(state?.shown.includes(state.question));
    choice = undefined;
    panel.hidden = !state;
    caption.hidden = Boolean(state);
    entry.textContent = state ? '返回' : '展开练习';
    entry.setAttribute('aria-label',state ? '返回原页' : '展开练习 · '+practice.title);
    entry.setAttribute('aria-expanded',String(Boolean(state)));
    scene.dataset.practicing = String(Boolean(state));
    scene.dataset.practiceFocus = item?.focus ?? '';
    showReference?.(state?.retry || answered ? item?.focus : undefined);
    if (!state || !item) {
      if (wasOpen && !projectionMode) entry.focus({preventScroll:true});
      return;
    }
    prompt.textContent = item.prompt;
    options.replaceChildren(...item.options.map((value,index)=>{
      if (projectionMode) {
        const option = element('span','practice-option',value);
        option.dataset.correct = String(answered && index === item.answer);
        return option;
      }
      const option = control(value,()=>{
        choice = index;
        Array.from(options.children).forEach((node,i)=>node.setAttribute('aria-pressed',String(i===index)));
        confirm.disabled = false;
      },'practice-option');
      option.disabled = answered;
      option.dataset.correct = String(answered && index === item.answer);
      option.setAttribute('aria-pressed','false');
      return option;
    }));
    feedback.hidden = !(state.retry || (answered && !item.column));
    feedback.dataset.retry = String(state.retry);
    feedback.textContent = state.retry ? item.retry : answered ? item.evidence : '';
    source.hidden = !state.shown.length;
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
    advance.hidden = practice.questions.length < 2;
  }

  function publish(next: PracticeState) {
    restore(next);
    sendProjection({type:'practice',position,state:next});
  }

  return {panel, entry, restore, read:()=>state, close:()=>{
    if (!state) return false;
    publish(null);
    return true;
  }};
}
