// Round Robin Visualizer
// Author: provided as a single-page interactive tool.

document.addEventListener('DOMContentLoaded', () => {
  // DOM refs
  const procBody = document.getElementById('proc-body');
  const addBtn = document.getElementById('add-process');
  const clearBtn = document.getElementById('clear-processes');
  const buildBtn = document.getElementById('build');
  const playBtn = document.getElementById('play');
  const pauseBtn = document.getElementById('pause');
  const stepBtn = document.getElementById('step');
  const resetBtn = document.getElementById('reset');
  const quantumInput = document.getElementById('quantum');
  const gantt = document.getElementById('gantt');
  const timeScale = document.getElementById('time-scale');
  const eventLog = document.getElementById('event-log');
  const avgWaitEl = document.getElementById('avg-wait');
  const avgTurnEl = document.getElementById('avg-turn');
  const currentInfo = document.getElementById('current-info');

  let rows = []; // {id, pidInput, arrivalInput, burstInput, priorityInput}
  let schedule = []; // segments: {pid, start, end}
  let processes = []; // original process object list
  let playTimer = null;
  let playIndex = 0;
  let isPlaying = false;

  // helpers
  function addRow(defaultPid = `P${rows.length + 1}`, arrival = 0, burst = 1, priority = '') {
    const tr = document.createElement('tr');

    const pidTd = document.createElement('td');
    const pidInput = document.createElement('input');
    pidInput.type = 'text';
    pidInput.value = defaultPid;
    pidTd.appendChild(pidInput);

    const arrTd = document.createElement('td');
    const arrInput = document.createElement('input');
    arrInput.type = 'number';
    arrInput.min = '0';
    arrInput.value = arrival;
    arrTd.appendChild(arrInput);

    const burstTd = document.createElement('td');
    const burstInput = document.createElement('input');
    burstInput.type = 'number';
    burstInput.min = '0';
    burstInput.value = burst;
    burstTd.appendChild(burstInput);

    const priTd = document.createElement('td');
    const priInput = document.createElement('input');
    priInput.type = 'number';
    priInput.value = priority;
    priTd.appendChild(priInput);

    const actionsTd = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.textContent = '✖';
    delBtn.className = 'btn';
    delBtn.style.padding = '4px 6px';
    delBtn.addEventListener('click', () => {
      procBody.removeChild(tr);
      rows = rows.filter(r => r.tr !== tr);
      refreshRowPlaceholders();
    });
    actionsTd.appendChild(delBtn);

    tr.appendChild(pidTd);
    tr.appendChild(arrTd);
    tr.appendChild(burstTd);
    tr.appendChild(priTd);
    tr.appendChild(actionsTd);

    procBody.appendChild(tr);
    rows.push({tr, pidInput, arrInput, burstInput, priInput});
    refreshRowPlaceholders();
  }

  function refreshRowPlaceholders() {
    rows.forEach((r, i) => {
      if (!r.pidInput.value) r.pidInput.value = `P${i+1}`;
    });
  }

  function clearProcesses() {
    procBody.innerHTML = '';
    rows = [];
    schedule = [];
    processes = [];
    gantt.innerHTML = '';
    timeScale.textContent = '';
    eventLog.innerHTML = '';
    avgWaitEl.textContent = '—';
    avgTurnEl.textContent = '—';
    currentInfo.textContent = 'No schedule';
    stopPlay();
  }

  function readProcessesFromTable() {
    const procs = [];
    for (const r of rows) {
      const pid = r.pidInput.value.trim() || `P${Math.random().toString(36).slice(2,5)}`;
      const arrival = Number(r.arrInput.value) || 0;
      const burst = Number(r.burstInput.value) || 0;
      const priority = r.priInput.value;
      if (burst <= 0) continue; // ignore zero-burst processes
      procs.push({pid, arrival, burst, remaining: burst, priority: priority, originalBurst: burst});
    }
    return procs;
  }

  // Round Robin scheduler
  function buildScheduleRR(quantum, procsInput) {
    // We'll simulate time, maintain a ready queue (FIFO), add processes as they arrive.
    const procs = procsInput.map(p => ({...p})); // copy
    // Sort by arrival for adding to queue
    procs.sort((a,b) => a.arrival - b.arrival || a.pid.localeCompare(b.pid));
    const segments = [];
    let time = 0;
    const ready = [];
    let pi = 0; // index to add new arrivals

    function enqueueArrivals() {
      while (pi < procs.length && procs[pi].arrival <= time) {
        ready.push(procs[pi]);
        pi++;
      }
    }

    // Start by moving time to first arrival if nothing available
    if (procs.length === 0) return segments;
    time = Math.max(time, procs[0].arrival);
    enqueueArrivals();

    while (ready.length > 0 || pi < procs.length) {
      if (ready.length === 0) {
        // jump to next arrival
        time = Math.max(time, procs[pi].arrival);
        enqueueArrivals();
        continue;
      }

      const p = ready.shift();
      const execStart = Math.max(time, p.arrival);
      const slice = Math.min(quantum, p.remaining);
      const execEnd = execStart + slice;
      segments.push({pid: p.pid, start: execStart, end: execEnd});
      p.remaining -= slice;
      time = execEnd;

      // new arrivals during execution
      enqueueArrivals();

      if (p.remaining > 0) {
        // put at end of queue
        ready.push(p);
      } else {
        // finished; record completion implicitly by last segment end
      }
    }

    return segments;
  }

  // compute statistics: for each process, find completion time (last segment end)
  function computeStats(segments, procsInput) {
    const comp = {}; // pid -> completion time
    const burstMap = {};
    const arrivalMap = {};
    for (const p of procsInput) {
      burstMap[p.pid] = p.originalBurst || p.burst || p.remaining || 0;
      arrivalMap[p.pid] = Number(p.arrival) || 0;
    }
    for (const s of segments) {
      comp[s.pid] = Math.max(comp[s.pid] || 0, s.end);
    }
    const results = [];
    for (const pid in burstMap) {
      if (!(pid in comp)) {
        // process had zero burst or wasn't scheduled - treat completion as arrival maybe
        comp[pid] = arrivalMap[pid];
      }
      const turnaround = comp[pid] - arrivalMap[pid];
      const waiting = turnaround - burstMap[pid];
      results.push({pid, arrival: arrivalMap[pid], burst: burstMap[pid], completion: comp[pid], turnaround, waiting});
    }
    const avgWait = results.reduce((a,b)=>a+b.waiting,0)/results.length || 0;
    const avgTurn = results.reduce((a,b)=>a+b.turnaround,0)/results.length || 0;
    return {results, avgWait, avgTurn};
  }

  // Render Gantt chart visually
  function renderGantt(segments) {
    gantt.innerHTML = '';
    timeScale.textContent = '';
    if (!segments || segments.length === 0) return;
    // build map of pid to CSS class
    const pidClasses = {};
    let colorIndex = 0;
    for (const s of segments) {
      if (!pidClasses[s.pid]) {
        pidClasses[s.pid] = `seg-${s.pid.replace(/\s+/g,'')}`;
      }
    }
    // compute time span
    const startTime = Math.min(...segments.map(s=>s.start));
    const endTime = Math.max(...segments.map(s=>s.end));
    const total = endTime - startTime || 1;

    // create scale ticks every 1 unit if total small, else every Math.ceil(total/10)
    let tick = 1;
    if (total > 20) tick = Math.ceil(total / 20);

    for (const s of segments) {
      const wPercent = ((s.end - s.start) / total) * 100;
      const seg = document.createElement('div');
      seg.className = 'segment ' + (s.pid.startsWith('P') ? `seg-${s.pid}`: 'seg-other');
      seg.dataset.pid = s.pid;
      seg.dataset.start = s.start;
      seg.dataset.end = s.end;
      seg.style.minWidth = Math.max(40, wPercent * 8) + 'px'; // ensure visible
      seg.style.flex = `0 0 ${((s.end - s.start)/total) * 100}%`;
      seg.textContent = `${s.pid} (${s.start}-${s.end})`;
      gantt.appendChild(seg);
    }

    // time scale text
    const ticks = [];
    for (let t = startTime; t <= endTime; t += tick) {
      ticks.push(t);
    }
    timeScale.textContent = ticks.join(' — ');
  }

  function logEvent(msg) {
    const li = document.createElement('li');
    li.textContent = msg;
    eventLog.appendChild(li);
    // scroll last into view
    li.scrollIntoView({behavior:'smooth', block:'end'});
  }

  // Build schedule button handler
  buildBtn.addEventListener('click', () => {
    stopPlay();
    eventLog.innerHTML = '';
    schedule = [];
    processes = readProcessesFromTable();
    if (processes.length === 0) {
      alert('Add at least one process with positive burst time.');
      return;
    }
    const q = Math.max(1, Number(quantumInput.value) || 1);

    // ensure originalBurst preserved
    processes.forEach(p => p.originalBurst = Number(p.burst) || Number(p.originalBurst) || p.remaining);

    schedule = buildScheduleRR(q, processes);
    renderGantt(schedule);
    const stats = computeStats(schedule, processes);
    avgWaitEl.textContent = stats.avgWait.toFixed(2);
    avgTurnEl.textContent = stats.avgTurn.toFixed(2);
    currentInfo.textContent = `Built — ${schedule.length} segments`;
    // initial event log (list segments)
    if (schedule.length === 0) {
      logEvent('No segments produced (check bursts).');
    } else {
      logEvent(`Schedule built with quantum = ${q}.`);
      // show first few events
      for (const s of schedule.slice(0,5)) {
        logEvent(`${s.pid} runs from ${s.start} to ${s.end}`);
      }
      if (schedule.length > 5) logEvent(`... ${schedule.length - 5} more segments`);
    }
    playIndex = 0;
  });

  // Play animation: highlight segments sequentially
  function startPlay() {
    if (!schedule || schedule.length === 0) { alert('Build schedule first'); return; }
    stopPlay();
    isPlaying = true;
    currentInfo.textContent = `Playing`;
    // set interval depending on display speed: map time units to ms; keep small so user sees animation.
    const displayMsPerUnit = 350; // you can change speed here
    playTimer = setInterval(()=> {
      if (playIndex >= schedule.length) {
        stopPlay();
        currentInfo.textContent = 'Finished';
        logEvent('Playback finished');
        return;
      }
      highlightSegment(playIndex);
      playIndex++;
    }, displayMsPerUnit);
  }

  function stopPlay() {
    isPlaying = false;
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
  }

  function highlightSegment(index) {
    // un-highlight all first
    const segs = Array.from(gantt.children);
    segs.forEach(s => s.style.opacity = '0.35');
    if (!schedule[index]) return;
    const pid = schedule[index].pid;
    // find the matching segment element with same start/end
    const segEl = segs.find(s => s.dataset.pid === pid && Number(s.dataset.start) === schedule[index].start && Number(s.dataset.end) === schedule[index].end);
    if (segEl) {
      segEl.style.opacity = '1';
      segEl.style.boxShadow = '0 6px 24px rgba(0,0,0,0.6)';
      segEl.scrollIntoView({behavior:'smooth', inline: 'center'});
      logEvent(`${pid} runs from ${schedule[index].start} to ${schedule[index].end}`);
      currentInfo.textContent = `${pid} (${schedule[index].start} → ${schedule[index].end})`;
    } else {
      logEvent(`Playing ${pid} ${schedule[index].start}-${schedule[index].end}`);
    }
  }

  // Pause / Play / Step / Reset handlers
  playBtn.addEventListener('click', () => {
    if (!schedule || schedule.length === 0) { alert('Build schedule first'); return; }
    if (isPlaying) return; // already playing
    startPlay();
  });
  pauseBtn.addEventListener('click', () => {
    stopPlay();
    currentInfo.textContent = 'Paused';
  });
  stepBtn.addEventListener('click', () => {
    if (!schedule || schedule.length === 0) { alert('Build schedule first'); return; }
    stopPlay();
    if (playIndex < schedule.length) {
      highlightSegment(playIndex);
      playIndex++;
    } else {
      currentInfo.textContent = 'Finished';
    }
  });
  resetBtn.addEventListener('click', () => {
    stopPlay();
    playIndex = 0;
    // clear highlights
    Array.from(gantt.children).forEach(s => { s.style.opacity='0.9'; s.style.boxShadow='none';});
    eventLog.innerHTML = '';
    currentInfo.textContent = 'Reset';
  });

  addBtn.addEventListener('click', () => addRow());
  clearBtn.addEventListener('click', clearProcesses);

  // init with 3 rows similar to screenshot defaults
  clearProcesses();
  addRow('P1', 0, 1, 3);
  addRow('P2', 1, 4, 1);
  addRow('P3', 2, 6, 4);
});
