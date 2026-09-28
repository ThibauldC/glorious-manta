/* Spark UI Detective - application logic
 *
 * No framework, no build step, no browser storage. Everything lives in memory,
 * so a refresh restarts the game.
 *
 * This file knows nothing about Spark specifics. It renders whatever cases.js
 * hands it, which means you can rewrite a case without touching this file.
 */

(function () {
  "use strict";

  /* ------------------------------------------------------------- state */

  var state = {
    screen: "intro",       // intro | brief | investigate | accuse | verdict | debrief
    caseIndex: 0,
    tab: "jobs",
    view: null,            // {name:"stage", id:1} | {name:"sql", id:0} | null
    diagTab: "dataSkew",
    sort: null,            // {key:"duration", dir:-1}
    open: {},              // collapsible id -> bool
    showStageTask: false,  // SQL graph: show where each max metric came from
    selected: null,
    answers: [],           // {caseId, chosen, correct}
    visited: []            // array of objects: {jobs:true, ...} per case
  };

  CASES.forEach(function () { state.visited.push({}); });

  var TABS = [
    { id: "jobs", label: "Jobs" },
    { id: "stages", label: "Stages" },
    { id: "storage", label: "Storage" },
    { id: "environment", label: "Environment" },
    { id: "executors", label: "Executors" },
    { id: "sql", label: "SQL / DataFrame" },
    { id: "diagnosis", label: "Diagnosis" }
  ];

  function current() { return CASES[state.caseIndex]; }

  /* --------------------------------------------------------- formatting */

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bytes(n) {
    if (!n) return "0.0 B";
    var units = ["B", "KiB", "MiB", "GiB", "TiB"], i = 0, v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(1) + " " + units[i];
  }

  function dur(ms) {
    if (ms === 0 || ms === undefined || ms === null) return "0 ms";
    if (ms < 1000) return Math.round(ms) + " ms";
    if (ms < 60000) return (ms / 1000).toFixed(1).replace(/\.0$/, "") + " s";
    if (ms < 3600000) return (ms / 60000).toFixed(1) + " min";
    return (ms / 3600000).toFixed(1) + " h";
  }

  function num(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function sizeRecords(size, records) {
    if (!size && !records) return "";
    return bytes(size) + " / " + num(records);
  }

  /* ----------------------------------------------------------- plumbing */

  function render() {
    var root = document.getElementById("root");
    var html;
    if (state.screen === "intro") html = viewIntro();
    else if (state.screen === "brief") html = viewBrief();
    else if (state.screen === "investigate") html = viewInvestigate();
    else if (state.screen === "accuse") html = viewAccuse();
    else if (state.screen === "verdict") html = viewVerdict();
    else html = viewDebrief();
    root.innerHTML = html;
    layoutPlanGraph();
    window.scrollTo(0, 0);
  }

  function go(screen) {
    state.screen = screen;
    render();
  }

  document.addEventListener("click", function (event) {
    var target = event.target.closest("[data-act]");
    if (!target) return;
    var act = target.getAttribute("data-act");
    var value = target.getAttribute("data-value");

    if (act === "start") { state.screen = "brief"; }
    else if (act === "investigate") {
      state.screen = "investigate";
      state.tab = "jobs";
      state.view = null;
      state.sort = null;
      state.visited[state.caseIndex].jobs = true;
    }
    else if (act === "tab") {
      state.tab = value;
      state.view = null;
      state.sort = null;
      state.visited[state.caseIndex][value] = true;
    }
    else if (act === "stage") { state.view = { name: "stage", id: Number(value) }; state.sort = null; }
    else if (act === "sql") { state.view = { name: "sql", id: Number(value) }; }
    else if (act === "back") { state.view = null; state.sort = null; }
    else if (act === "diagtab") { state.diagTab = value; }
    else if (act === "toggle") { state.open[value] = !state.open[value]; }
    else if (act === "stagetask") {
      // Relayout in place: a full render would jump the page back to the top.
      state.showStageTask = target.checked;
      layoutPlanGraph();
      return;
    }
    else if (act === "sort") {
      if (state.sort && state.sort.key === value) state.sort.dir *= -1;
      else state.sort = { key: value, dir: -1 };
    }
    else if (act === "accuse") { state.selected = null; state.screen = "accuse"; }
    else if (act === "select") { state.selected = value; }
    else if (act === "resume") { state.screen = "investigate"; }
    else if (act === "lockin") {
      if (!state.selected) return;
      var c = current();
      state.answers[state.caseIndex] = {
        caseId: c.id,
        chosen: state.selected,
        correct: state.selected === c.answer
      };
      state.screen = "verdict";
    }
    else if (act === "next") {
      if (state.caseIndex < CASES.length - 1) {
        state.caseIndex += 1;
        state.screen = "brief";
        state.tab = "jobs";
        state.view = null;
        state.selected = null;
        state.open = {};
      } else {
        state.screen = "debrief";
      }
    }
    else if (act === "restart") {
      state.caseIndex = 0;
      state.answers = [];
      state.visited = CASES.map(function () { return {}; });
      state.open = {};
      state.selected = null;
      state.screen = "intro";
    }
    render();
  });

  /* ------------------------------------------------------------ screens */

  function viewIntro() {
    return '' +
      '<div class="detective-shell"><div class="detective-card">' +
      '<div class="kicker">Spark UI Detective</div>' +
      '<h1>Three slow jobs. Three suspects to name.</h1>' +
      '<p>Each case gives you a story and a real-looking Spark UI. Click through the tabs, ' +
      'drill into stages, sort the task table, read the SQL plan, check what the Fabric ' +
      'Diagnosis views have to say. When you know what went wrong, make your accusation.</p>' +
      '<p>No timer. No hints. Around fifteen minutes for all three.</p>' +
      '<p class="game-note">None of these cases appeared in the talk. ' +
      'Everything in the UI is consistent, and some of it is a red herring.</p>' +
      '<p style="margin-top:26px"><button class="btn" data-act="start">Open the first case file</button></p>' +
      '</div></div>';
  }

  function viewBrief() {
    var c = current();
    return '' +
      '<div class="detective-shell"><div class="detective-card">' +
      '<div class="kicker">Case ' + (state.caseIndex + 1) + ' of ' + CASES.length + '</div>' +
      '<h1>' + esc(c.title) + '</h1>' +
      '<p class="case-subtitle">' + esc(c.subtitle) + '</p>' +
      '<div class="case-file">' + esc(c.brief) + '</div>' +
      '<div class="symptom">' + esc(c.symptom) + '</div>' +
      '<p style="margin-top:28px"><button class="btn" data-act="investigate">Open the Spark UI</button></p>' +
      '</div></div>';
  }

  function viewInvestigate() {
    var c = current();
    return '' +
      '<div class="detective-bar">' +
        '<span class="case-label">' + esc(c.title) + '</span>' +
        '<span class="case-count">Case ' + (state.caseIndex + 1) + ' of ' + CASES.length + '</span>' +
        '<span class="spacer"></span>' +
        '<button class="btn" data-act="accuse">Make your accusation</button>' +
      '</div>' +
      '<div class="hint-strip">Investigating <b>' + esc(c.app.id) + '</b>. ' +
      'Everything below behaves like the Spark UI: switch tabs, click a stage to drill in, ' +
      'sort the task table by clicking a column header.</div>' +
      sparkUI(c);
  }

  function viewAccuse() {
    var c = current();
    var opts = c.options.map(function (o) {
      var on = state.selected === o.id;
      return '<button type="button" class="option' + (on ? " selected" : "") + '" data-act="select" data-value="' + o.id + '" aria-pressed="' + on + '">' +
        '<span class="letter">' + o.id.toUpperCase() + '</span>' +
        '<span>' + esc(o.text) + '</span></button>';
    }).join("");

    return '' +
      '<div class="detective-shell"><div class="detective-card">' +
      '<div class="kicker">The accusation</div>' +
      '<h2>' + esc(c.question) + '</h2>' +
      '<div class="options">' + opts + '</div>' +
      '<p style="margin-top:22px">' +
        '<button class="btn" data-act="lockin"' + (state.selected ? "" : " disabled") + '>Lock it in</button> ' +
        '<button class="btn btn-ghost" data-act="resume">Back to the evidence</button>' +
      '</p>' +
      '</div></div>';
  }

  function viewVerdict() {
    var c = current();
    var answer = state.answers[state.caseIndex];
    var chosen = c.options.filter(function (o) { return o.id === answer.chosen; })[0];
    var truth = c.options.filter(function (o) { return o.id === c.answer; })[0];

    var banner = answer.correct
      ? '<div class="verdict-banner right">Case closed. ' + esc(truth.text) + '</div>'
      : '<div class="verdict-banner wrong">Wrong suspect. You said: ' + esc(chosen.text) + '</div>';

    var wrongNote = "";
    if (!answer.correct) {
      var why = c.wrongAnswers[answer.chosen];
      wrongNote = '<p>' + (why ? esc(why) : "") + '</p>' +
        '<p><b>The actual cause:</b> ' + esc(truth.text) + '</p>';
    }

    var evidence = c.evidence.map(function (e) {
      return '<div class="evidence-item"><div class="where">' + esc(e.tab) + '</div>' +
        esc(e.text) + '</div>';
    }).join("");

    var seen = TABS.filter(function (t) { return state.visited[state.caseIndex][t.id]; })
                   .map(function (t) { return t.label; });
    var missed = c.evidence
      .map(function (e) { return e.tab.split(" ")[0].toLowerCase(); })
      .filter(function (key, i, arr) { return arr.indexOf(key) === i; })
      .filter(function (key) {
        if (key === "stage") return !state.visited[state.caseIndex].stages;
        return !state.visited[state.caseIndex][key];
      });

    var tabsNote = '<div class="tabs-seen">Tabs you opened: ' +
      (seen.length ? esc(seen.join(", ")) : "none") +
      (missed.length ? '. You reached a verdict without opening every tab that held evidence.' : '') +
      '</div>';

    var isLast = state.caseIndex === CASES.length - 1;

    return '' +
      '<div class="detective-shell"><div class="detective-card">' +
      '<div class="kicker">Verdict</div>' +
      banner + wrongNote +
      '<h2 style="margin-top:26px">The evidence trail</h2>' + evidence +
      '<div class="fix-box"><b>The fix</b><p>' + esc(c.fix.text) + '</p>' +
        '<div class="beforeafter">' +
          '<div><span>Before</span>' + esc(c.fix.before) + '</div>' +
          '<div><span>After</span>' + esc(c.fix.after) + '</div>' +
        '</div></div>' +
      tabsNote +
      '<p style="margin-top:26px"><button class="btn" data-act="next">' +
        (isLast ? "See the debrief" : "Next case") + '</button></p>' +
      '</div></div>';
  }

  function viewDebrief() {
    var correct = state.answers.filter(function (a) { return a && a.correct; }).length;
    var rows = CASES.map(function (c, i) {
      var a = state.answers[i];
      var mark = a && a.correct ? "solved" : "missed";
      var tabs = TABS.filter(function (t) { return state.visited[i][t.id]; }).length;
      return '<tr><td>' + esc(c.title) + '</td><td>' + mark + '</td>' +
        '<td class="num">' + tabs + ' of ' + TABS.length + '</td></tr>';
    }).join("");

    return '' +
      '<div class="detective-shell"><div class="detective-card">' +
      '<div class="kicker">Debrief</div>' +
      '<div class="score-line">' + correct + ' / ' + CASES.length + '</div>' +
      '<p>Cases closed.</p>' +
      '<table class="results-table">' +
      '<thead><tr><th>Case</th><th>Result</th><th class="num">Tabs opened</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<p>The scripts that produce these runs, the slides, and the field guide all live in the repo: ' +
      '<a href="https://github.com/ThibauldC/spark-ui-detective" target="_blank" rel="noopener">' +
      'github.com/ThibauldC/spark-ui-detective</a>.</p>' +
      '<p style="margin-top:22px"><button class="btn btn-ghost" data-act="restart">Play again</button></p>' +
      '</div></div>';
  }

  /* ----------------------------------------------------------- spark ui */

  function sparkUI(c) {
    var tabs = TABS.map(function (t) {
      var active = state.tab === t.id;
      return '<button type="button" class="tab' + (active ? " active" : "") + '"' +
        (active ? ' aria-current="page"' : ' data-act="tab" data-value="' + t.id + '"') + '>' + t.label + '</button>';
    }).join("");

    return '' +
      '<div class="spark-ui">' +
        '<div class="spark-nav">' +
          '<div class="spark-logo"><b>Spark</b><small>' + esc(c.app.sparkVersion) + '</small></div>' +
          tabs +
          '<div class="appname">' + esc(c.app.name) + ' application UI</div>' +
        '</div>' +
        '<div class="spark-body">' + tabContent(c) + '</div>' +
      '</div>';
  }

  function tabContent(c) {
    if (state.view && state.view.name === "stage") return stageDetail(c, state.view.id);
    if (state.view && state.view.name === "sql") return sqlDetail(c, state.view.id);
    if (state.tab === "jobs") return jobsTab(c);
    if (state.tab === "stages") return stagesTab(c);
    if (state.tab === "storage") return storageTab();
    if (state.tab === "environment") return environmentTab(c);
    if (state.tab === "executors") return executorsTab(c);
    if (state.tab === "sql") return sqlTab(c);
    return diagnosisTab(c);
  }

  function progressCell(done, total) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    return '<td class="progress-cell"><div class="progress">' +
      '<div class="bar" style="width:' + pct + '%"></div>' +
      '<div class="label">' + num(done) + '/' + num(total) + '</div></div></td>';
  }

  function collapsible(id, label, inner, openByDefault) {
    var open = state.open[id] === undefined ? !!openByDefault : state.open[id];
    return '<div class="collapsible">' +
      '<button type="button" class="toggle" data-act="toggle" data-value="' + id + '" aria-expanded="' + open + '">' +
      (open ? "\u25BC " : "\u25B6 ") + esc(label) + '</button>' +
      (open ? '<div class="panel">' + inner + '</div>' : '') +
      '</div>';
  }

  function jobsTab(c) {
    var rows = c.jobs.map(function (j) {
      return '<tr><td>' + j.id + '</td>' +
        '<td><button type="button" class="spark-link" data-act="stage" data-value="' + j.stageIds[0] + '">' + esc(j.description) + '</button>' +
        '<br><span style="color:#888;font-size:11.5px">' + esc(j.group) + '</span></td>' +
        '<td class="mono">' + esc(j.submitted) + '</td>' +
        '<td class="num">' + dur(j.duration) + '</td>' +
        '<td class="num">' + esc(j.stages) + '</td>' +
        progressCell(j.tasksDone, j.tasksTotal) + '</tr>';
    }).join("");

    return '<h3>Spark Jobs <span style="color:#999;font-size:15px">(?)</span></h3>' +
      '<ul class="app-summary">' +
        '<li><strong>User:</strong> ' + esc(c.app.user) + '</li>' +
        '<li><strong>Total Uptime:</strong> ' + esc(c.app.uptime) + '</li>' +
        '<li><strong>Scheduling Mode:</strong> ' + esc(c.app.schedulingMode) + '</li>' +
        '<li><strong>Completed Jobs:</strong> ' + c.app.completedJobs + '</li>' +
      '</ul>' +
      collapsible("timeline", "Event Timeline", eventTimeline(c), false) +
      '<h4>Completed Jobs (' + c.jobs.length + ')</h4>' +
      '<table class="spark"><thead><tr>' +
        '<th>Job Id</th><th>Description</th><th>Submitted</th><th class="num">Duration</th>' +
        '<th class="num">Stages: Succeeded/Total</th><th>Tasks (for all stages)</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function eventTimeline(c) {
    var total = c.app.uptimeMs;
    var rows = c.jobs.map(function (j) {
      var left = (j.startMs / total) * 100;
      var width = Math.max(((j.endMs - j.startMs) / total) * 100, 0.6);
      return '<div class="row"><div>Job ' + j.id + ': ' + esc(j.description.slice(0, 34)) +
        (j.description.length > 34 ? "\u2026" : "") + '</div>' +
        '<div class="track"><div class="bar" style="left:' + left.toFixed(2) + '%;width:' +
        width.toFixed(2) + '%"></div></div></div>';
    }).join("");

    return '<div class="timeline">' +
      '<div class="caption">Application timeline, 0 to ' + dur(total) + '. Each bar is one job.</div>' +
      rows +
      '<div class="axis"><span>0</span><span>' + dur(total / 4) + '</span><span>' +
      dur(total / 2) + '</span><span>' + dur((total * 3) / 4) + '</span><span>' +
      dur(total) + '</span></div></div>';
  }

  function stagesTab(c) {
    var rows = c.stages.map(function (s) {
      return '<tr class="clickable" data-act="stage" data-value="' + s.id + '">' +
        '<td>' + s.id + '</td>' +
        '<td><button type="button" class="spark-link">' + esc(s.description) + '</button></td>' +
        '<td class="mono">' + esc(s.submitted) + '</td>' +
        '<td class="num">' + dur(s.duration) + '</td>' +
        progressCell(s.tasksDone, s.tasksTotal) +
        '<td class="num">' + (s.input ? sizeRecords(s.input, s.inputRecords) : "") + '</td>' +
        '<td class="num">' + (s.output ? bytes(s.output) : "") + '</td>' +
        '<td class="num">' + (s.shuffleRead ? bytes(s.shuffleRead) : "") + '</td>' +
        '<td class="num">' + (s.shuffleWrite ? bytes(s.shuffleWrite) : "") + '</td>' +
        '<td class="num">' + (s.spill ? bytes(s.spill) : "") + '</td>' +
        '</tr>';
    }).join("");

    return '<h3>Stages for All Jobs</h3>' +
      '<ul class="app-summary"><li><strong>Completed Stages:</strong> ' + c.stages.length + '</li></ul>' +
      '<h4>Completed Stages (' + c.stages.length + ')</h4>' +
      '<table class="spark"><thead><tr>' +
        '<th>Stage Id</th><th>Description</th><th>Submitted</th><th class="num">Duration</th>' +
        '<th>Tasks: Succeeded/Total</th><th class="num">Input</th><th class="num">Output</th>' +
        '<th class="num">Shuffle Read</th><th class="num">Shuffle Write</th><th class="num">Spill (Disk)</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function stageDetail(c, id) {
    var stage = c.stages.filter(function (s) { return s.id === id; })[0];
    var d = c.stageDetail[id];
    if (!stage || !d) return '<p class="empty-note">No detail captured for this stage.</p>';

    var summaryRows = d.summary.map(function (m) {
      function cell(v, rec) {
        if (m.kind === "time") return dur(v);
        if (rec !== undefined && rec !== null) return bytes(v) + " / " + num(rec);
        return bytes(v);
      }
      return '<tr><td>' + esc(m.metric) + '</td>' +
        '<td class="num">' + cell(m.min, m.recMin) + '</td>' +
        '<td class="num">' + cell(m.p25, m.recP25) + '</td>' +
        '<td class="num">' + cell(m.median, m.recMedian) + '</td>' +
        '<td class="num">' + cell(m.p75, m.recP75) + '</td>' +
        '<td class="num">' + cell(m.max, m.recMax) + '</td></tr>';
    }).join("");

    var execRows = d.byExecutor.map(function (e) {
      return '<tr><td>' + esc(e.exec) + '</td><td class="mono">' + esc(e.address) + '</td>' +
        '<td class="num">' + dur(e.taskTime) + '</td>' +
        '<td class="num">' + e.tasks + '</td>' +
        '<td class="num">' + (e.input ? bytes(e.input) : "") + '</td>' +
        '<td class="num">' + (e.shuffleRead ? bytes(e.shuffleRead) : "") + '</td>' +
        '<td class="num">' + (e.shuffleWrite ? bytes(e.shuffleWrite) : "") + '</td></tr>';
    }).join("");

    var tasks = d.tasks.slice();
    if (state.sort) {
      var key = state.sort.key, dir = state.sort.dir;
      tasks.sort(function (a, b) {
        var x = a[key], y = b[key];
        if (typeof x === "string") return x.localeCompare(y) * dir;
        return (x - y) * dir;
      });
    }

    var taskCols = [
      { key: "index", label: "Index", type: "num" },
      { key: "taskId", label: "ID", type: "num" },
      { key: "attempt", label: "Attempt", type: "num" },
      { key: "status", label: "Status", type: "text" },
      { key: "locality", label: "Locality Level", type: "text" },
      { key: "exec", label: "Executor ID", type: "text" },
      { key: "host", label: "Host", type: "text" },
      { key: "launch", label: "Launch Time", type: "text" },
      { key: "duration", label: "Duration", type: "dur" },
      { key: "gc", label: "GC Time", type: "dur" },
      { key: "input", label: "Input Size / Records", type: "sizerec", rec: "inputRecords" },
      { key: "shuffleWrite", label: "Shuffle Write Size / Records", type: "sizerec", rec: "shuffleWriteRecords" },
      { key: "shuffleRead", label: "Shuffle Read Size", type: "bytes" },
      { key: "spill", label: "Spill (Disk)", type: "bytes" }
    ];

    var head = taskCols.map(function (col) {
      var arrow = "";
      if (state.sort && state.sort.key === col.key) arrow = state.sort.dir === -1 ? " \u25BC" : " \u25B2";
      return '<th class="sortable' + (col.type === "text" ? "" : " num") +
        '" data-act="sort" data-value="' + col.key + '">' + col.label +
        '<span class="arrow">' + arrow + '</span></th>';
    }).join("");

    var body = tasks.map(function (t) {
      return "<tr>" + taskCols.map(function (col) {
        var v = t[col.key], out;
        if (col.type === "dur") out = dur(v);
        else if (col.type === "bytes") out = v ? bytes(v) : "";
        else if (col.type === "sizerec") out = v ? sizeRecords(v, t[col.rec]) : "";
        else out = esc(v);
        return '<td class="' + (col.type === "text" ? "" : "num ") +
          (col.key === "launch" ? "mono" : "") + '">' + out + "</td>";
      }).join("") + "</tr>";
    }).join("");

    var dag = '<div class="dag">' + d.dag.map(function (n, i) {
      return (i ? '<div class="arrow">\u2192</div>' : "") +
        '<div class="node">' + esc(n.name) + '<small>' + esc(n.detail) + '</small></div>';
    }).join("") + '</div>';

    return '<p><button type="button" class="spark-link" data-act="back">\u2190 Back to ' + (state.tab === "jobs" ? "Jobs" : "Stages") + '</button></p>' +
      '<h3>Details for Stage ' + stage.id + ' (Attempt ' + stage.attempt + ')</h3>' +
      '<ul class="app-summary">' +
        '<li><strong>Total Time Across All Tasks:</strong> ' + dur(d.totalTaskTime) + '</li>' +
        '<li><strong>Locality Level Summary:</strong> ' + esc(d.localitySummary) + '</li>' +
        (d.input ? '<li><strong>Input Size / Records:</strong> ' + sizeRecords(d.input, d.inputRecords) + '</li>' : "") +
        (d.shuffleWrite ? '<li><strong>Shuffle Write Size / Records:</strong> ' + bytes(d.shuffleWrite) + '</li>' : "") +
        '<li><strong>Spill (Memory):</strong> ' + bytes(d.spill) + '</li>' +
        '<li><strong>Spill (Disk):</strong> ' + bytes(d.spill) + '</li>' +
      '</ul>' +
      collapsible("dag" + id, "DAG Visualization", dag, false) +
      '<h4>Summary Metrics for ' + num(stage.tasksDone) + ' Completed Tasks</h4>' +
      '<table class="spark"><thead><tr><th>Metric</th><th class="num">Min</th>' +
        '<th class="num">25th percentile</th><th class="num">Median</th>' +
        '<th class="num">75th percentile</th><th class="num">Max</th></tr></thead>' +
        '<tbody>' + summaryRows + '</tbody></table>' +
      '<h4>Aggregated Metrics by Executor</h4>' +
      '<table class="spark"><thead><tr><th>Executor ID</th><th>Address</th>' +
        '<th class="num">Task Time</th><th class="num">Total Tasks</th><th class="num">Input</th>' +
        '<th class="num">Shuffle Read</th><th class="num">Shuffle Write</th></tr></thead>' +
        '<tbody>' + execRows + '</tbody></table>' +
      '<h4>Tasks (' + num(stage.tasksTotal) + ')</h4>' +
      '<p style="color:#777;font-size:12.5px;margin-top:-4px">Showing ' + d.tasks.length +
        ' of ' + num(stage.tasksTotal) + ' tasks. Click a column header to sort.</p>' +
      '<table class="spark"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function storageTab() {
    return '<h3>Storage</h3><p class="empty-note">No information to display. ' +
      'No RDDs or DataFrames were cached during this application.</p>';
  }

  function environmentTab(c) {
    var rows = c.environment.map(function (pair) {
      return '<tr><td class="mono">' + esc(pair[0]) + '</td><td class="mono">' + esc(pair[1]) + '</td></tr>';
    }).join("");
    return '<h3>Environment</h3>' +
      '<h4>Spark Properties</h4>' +
      '<table class="spark"><thead><tr><th>Name</th><th>Value</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  function executorsTab(c) {
    var s = c.executors.summary;
    var rows = c.executors.list.map(function (e) {
      return '<tr><td>' + esc(e.id) + '</td><td class="mono">' + esc(e.address) + '</td>' +
        '<td>' + esc(e.status) + '</td>' +
        '<td class="num">' + e.rddBlocks + '</td>' +
        '<td class="num">' + bytes(e.storageMemory) + ' / ' + bytes(e.storageMemoryTotal) + '</td>' +
        '<td class="num">' + bytes(e.diskUsed) + '</td>' +
        '<td class="num">' + e.cores + '</td>' +
        '<td class="num">' + e.activeTasks + '</td>' +
        '<td class="num">' + e.failedTasks + '</td>' +
        '<td class="num">' + e.completeTasks + '</td>' +
        '<td class="num">' + e.totalTasks + '</td>' +
        '<td class="num">' + dur(e.taskTime) + ' (' + dur(e.gcTime) + ')</td>' +
        '<td class="num">' + bytes(e.input) + '</td>' +
        '<td class="num">' + bytes(e.shuffleRead) + '</td>' +
        '<td class="num">' + bytes(e.shuffleWrite) + '</td></tr>';
    }).join("");

    return '<h3>Executors</h3>' +
      '<h4>Summary</h4>' +
      '<table class="spark"><thead><tr><th></th><th class="num">Active Executors</th>' +
        '<th class="num">Dead</th><th class="num">Total Cores</th><th class="num">Total Tasks</th>' +
        '<th class="num">Task Time (GC Time)</th><th class="num">Input</th>' +
        '<th class="num">Shuffle Read</th><th class="num">Shuffle Write</th></tr></thead>' +
        '<tbody><tr><td>Total</td><td class="num">' + s.activeExecutors + '</td>' +
        '<td class="num">' + s.deadExecutors + '</td><td class="num">' + s.totalCores + '</td>' +
        '<td class="num">' + num(s.totalTasks) + '</td>' +
        '<td class="num">' + dur(s.totalTaskTime) + ' (' + dur(s.totalGcTime) + ')</td>' +
        '<td class="num">' + bytes(s.totalInput) + '</td>' +
        '<td class="num">' + bytes(s.totalShuffleRead) + '</td>' +
        '<td class="num">' + bytes(s.totalShuffleWrite) + '</td></tr></tbody></table>' +
      '<h4>Executors</h4>' +
      '<table class="spark"><thead><tr><th>Executor ID</th><th>Address</th><th>Status</th>' +
        '<th class="num">RDD Blocks</th><th class="num">Storage Memory</th><th class="num">Disk Used</th>' +
        '<th class="num">Cores</th><th class="num">Active Tasks</th><th class="num">Failed Tasks</th>' +
        '<th class="num">Complete Tasks</th><th class="num">Total Tasks</th>' +
        '<th class="num">Task Time (GC Time)</th><th class="num">Input</th>' +
        '<th class="num">Shuffle Read</th><th class="num">Shuffle Write</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';
  }

  function sqlTab(c) {
    var rows = c.sql.map(function (q) {
      return '<tr class="clickable" data-act="sql" data-value="' + q.id + '">' +
        '<td>' + q.id + '</td><td><button type="button" class="spark-link">' + esc(q.description) + '</button></td>' +
        '<td class="mono">' + esc(q.submitted) + '</td>' +
        '<td class="num">' + dur(q.duration) + '</td>' +
        '<td>' + q.jobIds.join(", ") + '</td></tr>';
    }).join("");

    return '<h3>SQL / DataFrame</h3>' +
      '<h4>Completed Queries (' + c.sql.length + ')</h4>' +
      '<table class="spark"><thead><tr><th>ID</th><th>Description</th><th>Submitted</th>' +
        '<th class="num">Duration</th><th>Job IDs</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';
  }

  function findQuery(c, id) {
    return c.sql.filter(function (x) { return x.id === id; })[0];
  }

  function sqlDetail(c, id) {
    var q = findQuery(c, id);
    if (!q) return '<p class="empty-note">Query not found.</p>';

    return '<p><button type="button" class="spark-link" data-act="back">\u2190 Back to SQL / DataFrame</button></p>' +
      '<h3>Details for Query ' + q.id + '</h3>' +
      '<ul class="app-summary">' +
        '<li><strong>Submitted Time:</strong> ' + esc(q.submitted) + '</li>' +
        '<li><strong>Duration:</strong> ' + dur(q.duration) + '</li>' +
        '<li><strong>Succeeded Jobs:</strong> ' + q.jobIds.join(", ") + '</li>' +
      '</ul>' +
      (q.graph ? planGraph(q) : "") +
      collapsible("plan" + id, "Details", '<pre class="plan">' + esc(q.plan) + '</pre>', true);
  }

  /* ---------------------------------------------------------- plan graph */

  // The SQL tab's DAG. planGraph() emits unpositioned HTML; layoutPlanGraph()
  // runs after render(), measures every box and places it, since node sizes
  // depend on their metric text.

  // "(3) HashAggregate\n..." blocks from the plan text, keyed by node id. Spark
  // shows the same detail when you hover a node.
  function planBlocks(plan) {
    var out = {};
    plan.split(/\n\n+/).forEach(function (block) {
      var m = /^\((\d+)\) /.exec(block);
      if (m) out[m[1]] = block.replace(/\s+$/, "");
    });
    return out;
  }

  // [name, value] renders as one line. [name, total, min, med, max, maxAt] is a
  // task-aggregated metric and renders the way Spark 3.4 does, over two lines.
  function metricLines(m) {
    if (m.length === 2) return '<div>' + esc(m[0]) + ': ' + esc(m[1]) + '</div>';
    return '<div>' + esc(m[0]) + ' total (min, med, max<span class="pv-st"> (stageId: taskId)</span>)</div>' +
      '<div>' + esc(m[1]) + ' (' + esc(m[2]) + ', ' + esc(m[3]) + ', ' + esc(m[4]) +
      '<span class="pv-st"> (' + esc(m[5]) + ')</span>)</div>';
  }

  function planGraph(q) {
    var blocks = planBlocks(q.plan);
    var clusters = q.graph.clusters || {};

    var clusterHtml = Object.keys(clusters).map(function (id) {
      var cl = clusters[id];
      return '<div class="pv-cluster" data-id="' + esc(id) + '"><div class="pv-label">' +
        '<b>' + esc(cl.name) + '</b>' + (cl.metrics || []).map(metricLines).join("") +
        '</div></div>';
    }).join("");

    var nodeHtml = q.graph.nodes.map(function (n) {
      var tip = blocks[n.id];
      return '<div class="pv-node" data-id="' + n.id + '"' + (tip ? ' title="' + esc(tip) + '"' : "") + '>' +
        '<b>' + esc(n.name) + '</b>' + (n.metrics || []).map(metricLines).join("") + '</div>';
    }).join("");

    return '<div class="plan-viz-toolbar"><label><input type="checkbox" data-act="stagetask"' +
        (state.showStageTask ? " checked" : "") + '> ' +
        'Show the Stage ID and Task ID that corresponds to the max metric</label></div>' +
      '<div class="plan-viz" data-query="' + q.id + '"><div class="pv-canvas pending">' +
        clusterHtml + '<svg class="pv-edges" aria-hidden="true"></svg>' + nodeHtml +
      '</div></div>';
  }

  function layoutPlanGraph() {
    var box = document.querySelector(".plan-viz");
    if (!box) return;
    var q = findQuery(current(), Number(box.getAttribute("data-query")));
    var canvas = box.querySelector(".pv-canvas");
    box.classList.toggle("show-st", !!state.showStageTask);

    var PAD_X = 12, PAD_TOP = 8, LABEL_GAP = 8, PAD_BOTTOM = 12;
    var GAP_X = 30, GAP_Y = 34, MARGIN = 6;

    var nodes = {}, list = [];
    q.graph.nodes.forEach(function (d) {
      var el = canvas.querySelector('.pv-node[data-id="' + d.id + '"]');
      var n = { d: d, el: el, w: el.offsetWidth, h: el.offsetHeight, kids: [], parent: null };
      nodes[d.id] = n;
      list.push(n);
    });
    // A plan is a tree. If a node ever feeds two consumers, the first one owns
    // its position; every edge is still drawn.
    list.forEach(function (n) {
      (n.d.from || []).forEach(function (id) {
        var kid = nodes[id];
        if (!kid.parent) { kid.parent = n; n.kids.push(kid); }
      });
    });

    var clusters = {};
    Object.keys(q.graph.clusters || {}).forEach(function (id) {
      var el = canvas.querySelector('.pv-cluster[data-id="' + id + '"]');
      var label = el.querySelector(".pv-label");
      clusters[id] = { el: el, label: label, lw: label.offsetWidth, lh: label.offsetHeight, members: [] };
    });
    list.forEach(function (n) { if (n.d.cluster) clusters[n.d.cluster].members.push(n); });

    // The cluster label sits right of the centre line, clear of the incoming edge,
    // so a clustered node reserves room for it on both sides.
    function reserve(n) {
      var cl = clusters[n.d.cluster];
      if (!cl) return n.w;
      return 2 * Math.max(n.w / 2 + PAD_X, 14 + cl.lw + PAD_X);
    }

    var maxDepth = 0;
    function measure(n, depth) {
      n.depth = depth;
      maxDepth = Math.max(maxDepth, depth);
      n.kidsSpan = n.kids.reduce(function (sum, k) { return sum + measure(k, depth + 1); }, 0) +
        GAP_X * Math.max(n.kids.length - 1, 0);
      n.span = Math.max(reserve(n), n.kidsSpan);
      return n.span;
    }
    function place(n, left) {
      n.cx = left + n.span / 2;
      var x = left + (n.span - n.kidsSpan) / 2;
      n.kids.forEach(function (k) { place(k, x); x += k.span + GAP_X; });
    }
    var left = 0;
    list.filter(function (n) { return !n.parent; }).forEach(function (root) {
      measure(root, 0);
      place(root, left);
      left += root.span + GAP_X;
    });

    // Data flows downward: leaves on the top row, the root at the bottom. The gap
    // below a row grows when an edge leaves one cluster or enters another.
    var rowH = [], gap = [], y = [0], r;
    list.forEach(function (n) {
      n.row = maxDepth - n.depth;
      rowH[n.row] = Math.max(rowH[n.row] || 0, n.h);
    });
    for (r = 0; r < maxDepth; r++) gap[r] = GAP_Y;
    list.forEach(function (n) {
      var p = n.parent;
      if (!p) return;
      var own = n.d.cluster, next = p.d.cluster, extra = 0;
      if (own && own !== next) extra += PAD_BOTTOM;
      if (next && next !== own) extra += clusters[next].lh + PAD_TOP + LABEL_GAP;
      gap[n.row] = Math.max(gap[n.row], GAP_Y + extra);
    });
    for (r = 1; r <= maxDepth; r++) y[r] = y[r - 1] + rowH[r - 1] + gap[r - 1];
    list.forEach(function (n) {
      n.x = n.cx - n.w / 2;
      n.y = y[n.row] + (rowH[n.row] - n.h) / 2;
    });

    var rects = list.map(function (n) { return { x: n.x, y: n.y, w: n.w, h: n.h }; });
    Object.keys(clusters).forEach(function (id) {
      var cl = clusters[id], m = cl.members;
      if (!m.length) return;
      var x0 = Math.min.apply(null, m.map(function (n) { return n.x; }));
      var x1 = Math.max.apply(null, m.map(function (n) { return n.x + n.w; }));
      var y0 = Math.min.apply(null, m.map(function (n) { return n.y; }));
      var y1 = Math.max.apply(null, m.map(function (n) { return n.y + n.h; }));
      var mid = (x0 + x1) / 2;
      cl.x = x0 - PAD_X;
      cl.w = Math.max(x1 + PAD_X, mid + 14 + cl.lw + PAD_X) - cl.x;
      cl.y = y0 - LABEL_GAP - cl.lh - PAD_TOP;
      cl.h = y1 + PAD_BOTTOM - cl.y;
      rects.push(cl);
    });

    var minX = Math.min.apply(null, rects.map(function (b) { return b.x; }));
    var minY = Math.min.apply(null, rects.map(function (b) { return b.y; }));
    var dx = MARGIN - minX, dy = MARGIN - minY;
    var width = Math.max.apply(null, rects.map(function (b) { return b.x + b.w; })) + dx + MARGIN;
    var height = Math.max.apply(null, rects.map(function (b) { return b.y + b.h; })) + dy + MARGIN;

    function put(el, b) {
      el.style.left = (b.x + dx) + "px";
      el.style.top = (b.y + dy) + "px";
    }
    list.forEach(function (n) { put(n.el, n); });
    Object.keys(clusters).forEach(function (id) {
      var cl = clusters[id];
      if (!cl.members.length) return;
      put(cl.el, cl);
      cl.el.style.width = cl.w + "px";
      cl.el.style.height = cl.h + "px";
      cl.label.style.top = PAD_TOP + "px";
      cl.label.style.right = PAD_X + "px";
    });

    var paths = [];
    list.forEach(function (n) {
      var from = n.d.from || [];
      from.forEach(function (id, i) {
        var k = nodes[id];
        var x1 = k.cx + dx, y1 = k.y + k.h + dy;
        var x2 = n.cx + dx + (i - (from.length - 1) / 2) * Math.min(24, n.w / (from.length + 1));
        var y2 = n.y + dy - 1, ym = (y1 + y2) / 2;
        paths.push('<path d="M' + x1 + ',' + y1 + ' C' + x1 + ',' + ym + ' ' + x2 + ',' + ym +
          ' ' + x2 + ',' + y2 + '" marker-end="url(#pv-arrow)"/>');
      });
    });
    var svg = canvas.querySelector(".pv-edges");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.innerHTML = '<defs><marker id="pv-arrow" viewBox="0 0 10 10" refX="9" refY="5" ' +
      'markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>' +
      paths.join("");

    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    canvas.classList.remove("pending");
  }

  function diagnosisTab(c) {
    var panels = [
      { id: "dataSkew", label: "Data Skew" },
      { id: "timeSkew", label: "Time Skew" },
      { id: "executorUsage", label: "Executor Usage Analysis" }
    ];

    var nav = panels.map(function (p) {
      var active = state.diagTab === p.id;
      return '<button type="button" class="dtab' + (active ? " active" : "") +
        '" data-act="diagtab" data-value="' + p.id + '" aria-pressed="' + active + '">' + p.label + '</button>';
    }).join("");

    var d = c.diagnosis[state.diagTab];
    var rows = (d.rows || []).map(function (r) {
      return '<tr><td>' + esc(r[0]) + '</td><td class="num mono">' + esc(r[1]) + '</td></tr>';
    }).join("");

    return '<h3>Diagnosis</h3>' +
      '<p style="color:#777;font-size:13px;margin-top:-6px">Fabric-specific analysis of the completed application.</p>' +
      '<div class="diag-tabs">' + nav + '</div>' +
      '<div class="diag-card">' +
        '<span class="pill ' + d.severity + '">' + d.severity + '</span>' +
        '<h4 style="margin:10px 0 6px">' + esc(d.headline) + '</h4>' +
        '<p style="color:#555">' + esc(d.detail) + '</p>' +
        (rows ? '<table class="spark" style="max-width:460px;margin-top:14px"><tbody>' +
          rows + '</tbody></table>' : "") +
      '</div>';
  }

  render();
})();
