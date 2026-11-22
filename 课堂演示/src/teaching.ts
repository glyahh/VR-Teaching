let teachingPace: TeachingPace = 40;

type ScheduledBeat = { start: number; end: number; beat: TeachingBeat };

function lessonSchedule(pace: TeachingPace) {
  const column = teachingPaces.indexOf(pace);
  let end = 0;
  function schedule(beat: TeachingBeat): ScheduledBeat {
    const start = end;
    end += beat.seconds[column];
    return {start, end, beat};
  }
  const map = schedule(mapBeat);
  const chapters = events.map(event => event.pages.map(schedule));
  const review = reviewBeats.map(schedule);
  return {map, chapters, scenes: chapters.flat(), review};
}

function teachingTime(seconds: number) {
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2,'0');
}

function teachingRange(first: ScheduledBeat, last = first) {
  return teachingTime(first.start) + '–' + teachingTime(last.end);
}

function pacePicker(id: string, change: () => void) {
  const label = element('label','teaching-pace','授课时长');
  const picker = element('select');
  picker.id = id;
  for (const pace of teachingPaces) {
    const option = element('option','',pace+' 分钟');
    option.value = String(pace);
    picker.append(option);
  }
  picker.value = String(teachingPace);
  picker.addEventListener('change',()=>{
    const pace = teachingPaces.find(value => String(value) === picker.value);
    if (pace === undefined) return;
    teachingPace = pace;
    document.querySelectorAll<HTMLSelectElement>('.teaching-pace select').forEach(input => { input.value = picker.value; });
    change();
  });
  label.append(picker);
  return label;
}

function lessonClock() {
  const row = element('div','lesson-clock');
  const time = element('time','','0:00');
  time.setAttribute('aria-label','已授课时间');
  let startedAt: number | undefined;
  function update() {
    if (startedAt !== undefined) time.textContent = teachingTime(Math.floor((performance.now()-startedAt)/1000));
  }
  const timer = control('开始计时',()=>{
    if (startedAt === undefined) {
      startedAt = performance.now();
      update();
      setButtonContent(timer,'停止计时');
    } else {
      update();
      startedAt = undefined;
      setButtonContent(timer,'重新计时');
    }
  });
  row.append(time,timer);
  return { row, update };
}

function beatCopy(beat: TeachingBeat, practice?: PracticeId) {
  const lines = [beat.notes];
  if (practice) {
    const task = practices[practice];
    if (teachingPace >= task.from) lines.push(task.teacher);
  }
  if (teachingPace === 50 && beat.extension) lines.push(beat.extension);
  return lines;
}
