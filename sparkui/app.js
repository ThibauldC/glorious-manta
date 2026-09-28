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
    set: null,             // "talk" | "new": which case file is open
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

  var TABS = [
    { id: "jobs", label: "Jobs" },
    { id: "stages", label: "Stages" },
    { id: "storage", label: "Storage" },
    { id: "environment", label: "Environment" },
    { id: "executors", label: "Executors" },
    { id: "sql", label: "SQL / DataFrame" },
    { id: "diagnosis", label: "Diagnosis" }
  ];

  var SETS = {
    talk: { label: "The talk's cases",
            blurb: "The four investigations from The Spark Detective, rebuilt from the event logs " +
                   "recorded for the talk. Every number, task and plan is real." },
    "new": { label: "New cases",
             blurb: "Three cases that were not in the talk. The data is mocked but consistent " +
                    "throughout, and some of it is a red herring." }
  };

  function cases() { return CASES.filter(function (c) { return c.set === state.set; }); }
  function current() { return cases()[state.caseIndex]; }

  function openSet(set) {
    state.set = set;
    state.caseIndex = 0;
    state.answers = [];
    state.visited = cases().map(function () { return {}; });
    state.open = {};
    state.selected = null;
    state.diagTab = "dataSkew";
    state.screen = "brief";
  }

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

    if (act === "start") { openSet(value); }
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
      if (state.caseIndex < cases().length - 1) {
        state.caseIndex += 1;
        state.screen = "brief";
        state.tab = "jobs";
        state.view = null;
        state.selected = null;
        state.open = {};
        state.diagTab = "dataSkew";
      } else {
        state.screen = "debrief";
      }
    }
    else if (act === "restart") { state.screen = "intro"; }
    render();
  });

  /* ------------------------------------------------------------ screens */

  function viewIntro() {
    var files = Object.keys(SETS).map(function (key) {
      var n = CASES.filter(function (c) { return c.set === key; }).length;
      return '<div class="case-set">' +
        '<div class="kicker">' + n + ' cases</div>' +
        '<h2>' + esc(SETS[key].label) + '</h2>' +
        '<p>' + esc(SETS[key].blurb) + '</p>' +
        '<button class="btn" data-act="start" data-value="' + key + '">Open this case file</button>' +
        '</div>';
    }).join("");

    return '' +
      '<div class="detective-shell"><div class="detective-card">' +
      '<div class="kicker">Spark UI Detective</div>' +
      '<h1>Slow Spark jobs. Suspects to name.</h1>' +
      '<p>Each case gives you a story and a Spark UI. Click through the tabs, ' +
      'drill into stages, sort the task table, read the SQL plan, check what the Fabric ' +
      'Diagnosis views have to say. When you know what went wrong, make your accusation.</p>' +
      '<p>No timer. No hints. Around five minutes a case.</p>' +
      '<div class="case-sets">' + files + '</div>' +
      '</div></div>';
  }

  function viewBrief() {
    var c = current();
    return '' +
      '<div class="detective-shell"><div class="detective-card">' +
      '<div class="kicker">' + esc(SETS[state.set].label) + ' \u00b7 Case ' + (state.caseIndex + 1) + ' of ' + cases().length + '</div>' +
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
        '<span class="case-count">Case ' + (state.caseIndex + 1) + ' of ' + cases().length + '</span>' +
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

    var isLast = state.caseIndex === cases().length - 1;

    return '' +
      '<div class="detective-shell"><div class="detective-card">' +
      '<div class="kicker">Verdict</div>' +
      banner + wrongNote +
      '<h2 style="margin-top:26px">The evidence trail</h2>' + evidence +
      '<div class="fix-box"><b>The fix</b><p>' + esc(c.fix.text) + '</p>' +
        '<div class="beforeafter">' +
          '<div><span>Before</span>' + esc(c.fix.before) + '</div>' +
          (c.fix.after ? '<div><span>After</span>' + esc(c.fix.after) + '</div>' : '') +
        '</div>' +
        (c.fix.note ? '<p class="game-note">' + esc(c.fix.note) + '</p>' : '') +
        '</div>' +
      tabsNote +
      '<p style="margin-top:26px"><button class="btn" data-act="next">' +
        (isLast ? "See the debrief" : "Next case") + '</button></p>' +
      '</div></div>';
  }

  function viewDebrief() {
    var correct = state.answers.filter(function (a) { return a && a.correct; }).length;
    var list = cases();
    var other = state.set === "talk" ? "new" : "talk";
    var rows = list.map(function (c, i) {
      var a = state.answers[i];
      var mark = a && a.correct ? "solved" : "missed";
      var tabs = TABS.filter(function (t) { return state.visited[i][t.id]; }).length;
      return '<tr><td>' + esc(c.title) + '</td><td>' + mark + '</td>' +
        '<td class="num">' + tabs + ' of ' + TABS.length + '</td></tr>';
    }).join("");

    return '' +
      '<div class="detective-shell"><div class="detective-card">' +
      '<div class="kicker">Debrief</div>' +
      '<div class="score-line">' + correct + ' / ' + list.length + '</div>' +
      '<p>Cases closed.</p>' +
      '<table class="results-table">' +
      '<thead><tr><th>Case</th><th>Result</th><th class="num">Tabs opened</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<p>The scripts that produce these runs, the slides, and the field guide all live in the repo: ' +
      '<a href="https://github.com/ThibauldC/spark-ui-detective" target="_blank" rel="noopener">' +
      'github.com/ThibauldC/spark-ui-detective</a>.</p>' +
      '<p style="margin-top:22px"><button class="btn" data-act="start" data-value="' + other + '">' +
        'Open ' + esc(SETS[other].label.toLowerCase()) + '</button> ' +
        '<button class="btn btn-ghost" data-act="restart">Back to the start</button></p>' +
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

  function progressCell(done, total, failed, skipped) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    var extra = (failed ? " (" + num(failed) + " failed)" : "") +
      (skipped ? " (" + num(skipped) + " skipped)" : "");
    return '<td class="progress-cell"><div class="progress">' +
      '<div class="bar" style="width:' + pct + '%"></div>' +
      '<div class="label">' + num(done) + '/' + num(total) + extra + '</div></div></td>';
  }

  function collapsible(id, label, inner, openByDefault) {
    var open = state.open[id] === undefined ? !!openByDefault : state.open[id];
    return '<div class="collapsible">' +
      '<button type="button" class="toggle" data-act="toggle" data-value="' + id + '" aria-expanded="' + open + '">' +
      (open ? "▼ " : "▶ ") + esc(label) + '</button>' +
      (open ? '<div class="panel">' + inner + '</div>' : '') +
      '</div>';
  }

  // Spark gives every status its own table: Active Jobs, Completed Jobs, and so
  // on. Items without a status are finished ones, which is all the mock cases hold.
  function byStatus(items, groups, fallback) {
    return groups.map(function (g) {
      return { label: g.label, rows: items.filter(function (x) { return (x.status || fallback) === g.status; }) };
    }).filter(function (g) { return g.rows.length; });
  }

  function statusCounts(groups) {
    return groups.map(function (g) {
      return '<li><strong>' + g.label + ':</strong> ' + g.rows.length + '</li>';
    }).join("");
  }

  var JOB_GROUPS = [
    { status: "RUNNING", label: "Active Jobs" },
    { status: "SUCCEEDED", label: "Completed Jobs" },
    { status: "FAILED", label: "Failed Jobs" }
  ];

  function jobsTab(c) {
    var groups = byStatus(c.jobs, JOB_GROUPS, "SUCCEEDED");
    var tables = groups.map(function (g) {
      var rows = g.rows.map(function (j) {
        var link = j.link !== undefined ? j.link : j.stageIds[0];
        return '<tr><td>' + j.id + '</td>' +
          '<td><button type="button" class="spark-link" data-act="stage" data-value="' + link + '">' + esc(j.description) + '</button>' +
          '<br><span style="color:#888;font-size:11.5px">' + esc(j.group) + '</span></td>' +
          '<td class="mono">' + esc(j.submitted) + '</td>' +
          '<td class="num">' + dur(j.duration) + '</td>' +
          '<td class="num">' + esc(j.stages) + '</td>' +
          progressCell(j.tasksDone, j.tasksTotal, j.tasksFailed, j.tasksSkipped) + '</tr>';
      }).join("");
      return '<h4>' + g.label + ' (' + g.rows.length + ')</h4>' +
        '<table class="spark"><thead><tr>' +
          '<th>Job Id</th><th>Description</th><th>Submitted</th><th class="num">Duration</th>' +
          '<th class="num">Stages: Succeeded/Total</th><th>Tasks (for all stages): Succeeded/Total</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
    }).join("");

    var attempt = c.app.attemptId && c.app.attemptId !== "1";
    return '<h3>Spark Jobs <span style="color:#999;font-size:15px">(?)</span></h3>' +
      '<ul class="app-summary">' +
        '<li><strong>User:</strong> ' + esc(c.app.user) + '</li>' +
        '<li><strong>Total Uptime:</strong> ' + esc(c.app.uptime) + '</li>' +
        '<li><strong>Scheduling Mode:</strong> ' + esc(c.app.schedulingMode) + '</li>' +
        (attempt ? '<li><strong>Application Attempt:</strong> ' + esc(c.app.attemptId) + '</li>' : '') +
        statusCounts(groups) +
      '</ul>' +
      (c.app.incomplete ? '<p class="spark-alert">This application is incomplete: its event log ends ' +
        'without an application end event, so running jobs and stages are shown as of the last event.</p>' : '') +
      collapsible("timeline", "Event Timeline", eventTimeline(c), false) +
      tables;
  }

  function timeAxis(total) {
    return '<div class="axis"><span>0</span><span>' + dur(total / 4) + '</span><span>' +
      dur(total / 2) + '</span><span>' + dur((total * 3) / 4) + '</span><span>' +
      dur(total) + '</span></div>';
  }

  function eventTimeline(c) {
    var total = c.app.uptimeMs;
    function pct(ms) { return ((ms / total) * 100).toFixed(2) + "%"; }

    var execRow = "";
    if (c.executorEvents && c.executorEvents.length) {
      execRow = '<div class="row"><div>Executors</div><div class="track">' +
        c.executorEvents.map(function (e) {
          var text = "Executor " + e.id + " " + e.kind + " at " + dur(e.ms) + (e.reason ? ". " + e.reason : "");
          return '<span class="mark ' + e.kind + '" style="left:' + pct(e.ms) + '" title="' + esc(text) + '"></span>';
        }).join("") + '</div></div>';
    }

    var rows = c.jobs.map(function (j) {
      var width = Math.max(((j.endMs - j.startMs) / total) * 100, 0.6);
      var cls = j.status === "RUNNING" ? " running" : j.status === "FAILED" ? " failed" : "";
      return '<div class="row"><div>Job ' + j.id + ': ' + esc(j.description.slice(0, 34)) +
        (j.description.length > 34 ? "…" : "") + '</div>' +
        '<div class="track"><div class="bar' + cls + '" style="left:' + pct(j.startMs) + ';width:' +
        width.toFixed(2) + '%"></div></div></div>';
    }).join("");

    return '<div class="timeline">' +
      '<div class="caption">Application timeline, 0 to ' + dur(total) + '. Each bar is one job.' +
      (execRow ? ' Markers show executors being added (green) and removed (red); hover one for the reason.' : '') +
      '</div>' + execRow + rows + timeAxis(total) + '</div>';
  }

  var STAGE_GROUPS = [
    { status: "ACTIVE", label: "Active Stages" },
    { status: "PENDING", label: "Pending Stages" },
    { status: "COMPLETE", label: "Completed Stages" },
    { status: "FAILED", label: "Failed Stages" }
  ];

  function stagesTab(c) {
    var groups = byStatus(c.stages, STAGE_GROUPS, "COMPLETE");
    var tables = groups.map(function (g) {
      var rows = g.rows.map(function (s) {
        var pending = s.status === "PENDING";
        return '<tr' + (c.stageDetail[s.id] ? ' class="clickable" data-act="stage" data-value="' + s.id + '"' : '') + '>' +
          '<td>' + s.id + '</td>' +
          '<td><button type="button" class="spark-link">' + esc(s.description) + '</button></td>' +
          '<td class="mono">' + esc(s.submitted) + '</td>' +
          '<td class="num">' + (pending ? "Unknown" : dur(s.duration)) + '</td>' +
          progressCell(s.tasksDone, s.tasksTotal, s.tasksFailed) +
          '<td class="num">' + (s.input ? sizeRecords(s.input, s.inputRecords) : "") + '</td>' +
          '<td class="num">' + (s.output ? bytes(s.output) : "") + '</td>' +
          '<td class="num">' + (s.shuffleRead ? bytes(s.shuffleRead) : "") + '</td>' +
          '<td class="num">' + (s.shuffleWrite ? bytes(s.shuffleWrite) : "") + '</td>' +
          '<td class="num">' + (s.spill ? bytes(s.spill) : "") + '</td>' +
          '</tr>';
      }).join("");
      return '<h4>' + g.label + ' (' + g.rows.length + ')</h4>' +
        '<table class="spark"><thead><tr>' +
          '<th>Stage Id</th><th>Description</th><th>Submitted</th><th class="num">Duration</th>' +
          '<th>Tasks: Succeeded/Total</th><th class="num">Input</th><th class="num">Output</th>' +
          '<th class="num">Shuffle Read</th><th class="num">Shuffle Write</th><th class="num">Spill (Disk)</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
    }).join("");

    return '<h3>Stages for All Jobs</h3>' +
      '<ul class="app-summary">' + statusCounts(groups) + '</ul>' + tables;
  }

  // Spark's task table shows a hundred rows a page; sorting applies to all tasks.
  var TASK_PAGE = 100;

  function any(list, key) {
    return list.some(function (x) { return x[key]; });
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
    var summaryTable = d.summary.length
      ? '<table class="spark"><thead><tr><th>Metric</th><th class="num">Min</th>' +
          '<th class="num">25th percentile</th><th class="num">Median</th>' +
          '<th class="num">75th percentile</th><th class="num">Max</th></tr></thead>' +
          '<tbody>' + summaryRows + '</tbody></table>'
      : '<p class="empty-note">No task in this stage has completed.</p>';

    var execFailed = any(d.byExecutor, "failedTasks"), execSpill = any(d.byExecutor, "spill");
    var execRows = d.byExecutor.map(function (e) {
      return '<tr><td>' + esc(e.exec) + '</td><td class="mono">' + esc(e.address) + '</td>' +
        '<td class="num">' + dur(e.taskTime) + '</td>' +
        '<td class="num">' + e.tasks + '</td>' +
        (execFailed ? '<td class="num">' + e.failedTasks + '</td>' : '') +
        '<td class="num">' + (e.input ? bytes(e.input) : "") + '</td>' +
        '<td class="num">' + (e.shuffleRead ? bytes(e.shuffleRead) : "") + '</td>' +
        '<td class="num">' + (e.shuffleWrite ? bytes(e.shuffleWrite) : "") + '</td>' +
        (execSpill ? '<td class="num">' + (e.spill ? bytes(e.spill) : "") + '</td>' : '') + '</tr>';
    }).join("");

    var tasks = d.tasks.slice();
    if (state.sort) {
      var key = state.sort.key, dir = state.sort.dir;
      tasks.sort(function (a, b) {
        var x = a[key], y = b[key];
        if (typeof x === "string" || typeof y === "string") return String(x || "").localeCompare(String(y || "")) * dir;
        return ((x || 0) - (y || 0)) * dir;
      });
    }

    var taskCols = [
      { key: "index", label: "Index", type: "num" },
      { key: "taskId", label: "ID", type: "num" },
      { key: "attempt", label: "Attempt", type: "num" },
      { key: "status", label: "Status", type: "status" },
      { key: "locality", label: "Locality Level", type: "text" },
      { key: "exec", label: "Executor ID", type: "text" },
      { key: "host", label: "Host", type: "text" },
      { key: "launch", label: "Launch Time", type: "text" },
      { key: "duration", label: "Duration", type: "dur" },
      { key: "gc", label: "GC Time", type: "dur" }
    ];
    // Like Spark, only show the I/O columns this stage actually has.
    if (any(d.tasks, "input")) taskCols.push({ key: "input", label: "Input Size / Records", type: "sizerec", rec: "inputRecords" });
    if (any(d.tasks, "output")) taskCols.push({ key: "output", label: "Output Size", type: "bytes" });
    if (any(d.tasks, "shuffleRead")) {
      taskCols.push(d.tasks.some(function (t) { return t.shuffleReadRecords !== undefined; })
        ? { key: "shuffleRead", label: "Shuffle Read Size / Records", type: "sizerec", rec: "shuffleReadRecords" }
        : { key: "shuffleRead", label: "Shuffle Read Size", type: "bytes" });
    }
    if (any(d.tasks, "shuffleWrite")) taskCols.push({ key: "shuffleWrite", label: "Shuffle Write Size / Records", type: "sizerec", rec: "shuffleWriteRecords" });
    if (any(d.tasks, "memorySpill")) taskCols.push({ key: "memorySpill", label: "Spill (Memory)", type: "bytes" });
    if (any(d.tasks, "spill") || any(d.tasks, "memorySpill")) taskCols.push({ key: "spill", label: "Spill (Disk)", type: "bytes" });
    if (any(d.tasks, "error")) taskCols.push({ key: "error", label: "Errors", type: "error" });

    var head = taskCols.map(function (col) {
      var arrow = "";
      if (state.sort && state.sort.key === col.key) arrow = state.sort.dir === -1 ? " ▼" : " ▲";
      var text = col.type === "text" || col.type === "status" || col.type === "error";
      return '<th class="sortable' + (text ? "" : " num") +
        '" data-act="sort" data-value="' + col.key + '">' + col.label +
        '<span class="arrow">' + arrow + '</span></th>';
    }).join("");

    var body = tasks.slice(0, TASK_PAGE).map(function (t) {
      return "<tr>" + taskCols.map(function (col) {
        var v = t[col.key], out, cls = "num ";
        if (col.type === "dur") out = dur(v);
        else if (col.type === "bytes") out = v ? bytes(v) : "";
        else if (col.type === "sizerec") out = v ? sizeRecords(v, t[col.rec]) : "";
        else if (col.type === "status") {
          out = v === "SUCCESS" ? esc(v) : '<span class="task-failed">' + esc(v) + '</span>';
          cls = "";
        } else if (col.type === "error") {
          out = v ? '<span class="task-error" title="' + esc(v) + '">' + esc(v.split("\n")[0]) + '</span>' : "";
          cls = "";
        } else {
          out = esc(v);
          if (col.type === "text") cls = "";
        }
        return '<td class="' + cls + (col.key === "launch" ? "mono" : "") + '">' + out + "</td>";
      }).join("") + "</tr>";
    }).join("");

    var dag = '<div class="dag">' + d.dag.map(function (n, i) {
      return (i ? '<div class="arrow">→</div>' : "") +
        '<div class="node">' + esc(n.name) + '<small>' + esc(n.detail) + '</small></div>';
    }).join("") + '</div>';

    var timeline = taskTimeline(d);
    var attempts = Math.max(stage.tasksTotal, d.tasks.length);
    var shown = Math.min(d.tasks.length, TASK_PAGE);
    var memorySpill = d.memorySpill !== undefined ? d.memorySpill : d.spill;

    return '<p><button type="button" class="spark-link" data-act="back">← Back to ' + (state.tab === "jobs" ? "Jobs" : "Stages") + '</button></p>' +
      '<h3>Details for Stage ' + stage.id + ' (Attempt ' + stage.attempt + ')</h3>' +
      '<ul class="app-summary">' +
        '<li><strong>Total Time Across All Tasks:</strong> ' + dur(d.totalTaskTime) + '</li>' +
        '<li><strong>Locality Level Summary:</strong> ' + esc(d.localitySummary) + '</li>' +
        (d.input ? '<li><strong>Input Size / Records:</strong> ' + sizeRecords(d.input, d.inputRecords) + '</li>' : "") +
        (d.output ? '<li><strong>Output Size / Records:</strong> ' + sizeRecords(d.output, d.outputRecords) + '</li>' : "") +
        (d.shuffleRead ? '<li><strong>Shuffle Read Size / Records:</strong> ' + sizeRecords(d.shuffleRead, d.shuffleReadRecords) + '</li>' : "") +
        (d.shuffleWrite ? '<li><strong>Shuffle Write Size / Records:</strong> ' +
          (d.shuffleWriteRecords !== undefined ? sizeRecords(d.shuffleWrite, d.shuffleWriteRecords) : bytes(d.shuffleWrite)) + '</li>' : "") +
        '<li><strong>Spill (Memory):</strong> ' + bytes(memorySpill) + '</li>' +
        '<li><strong>Spill (Disk):</strong> ' + bytes(d.spill) + '</li>' +
      '</ul>' +
      collapsible("dag" + id, "DAG Visualization", dag, false) +
      (timeline ? collapsible("tasktl" + id, "Event Timeline", timeline, false) : "") +
      '<h4>Summary Metrics for ' + num(stage.tasksDone) + ' Completed Tasks</h4>' +
      summaryTable +
      '<h4>Aggregated Metrics by Executor</h4>' +
      '<table class="spark"><thead><tr><th>Executor ID</th><th>Address</th>' +
        '<th class="num">Task Time</th><th class="num">Total Tasks</th>' +
        (execFailed ? '<th class="num">Failed Tasks</th>' : '') +
        '<th class="num">Input</th><th class="num">Shuffle Read</th><th class="num">Shuffle Write</th>' +
        (execSpill ? '<th class="num">Spill (Disk)</th>' : '') + '</tr></thead>' +
        '<tbody>' + execRows + '</tbody></table>' +
      '<h4>Tasks (' + num(attempts) + ')</h4>' +
      '<p style="color:#777;font-size:12.5px;margin-top:-4px">Showing ' + shown +
        ' of ' + num(attempts) + ' tasks. Click a column header to sort.</p>' +
      '<div class="table-scroll"><table class="spark"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  // Spark's stage timeline: one lane per task slot, grouped by executor, each
  // task a bar. Only cases built from an event log carry the start offsets.
  function taskTimeline(d) {
    var tasks = d.tasks.filter(function (t) { return t.start !== undefined; });
    if (!tasks.length) return "";
    var span = Math.max(1, Math.max.apply(null, tasks.map(function (t) { return t.start + t.duration; })));

    var execs = [], lanes = {};
    tasks.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (t) {
      if (!lanes[t.exec]) { lanes[t.exec] = []; execs.push(t.exec); }
      var list = lanes[t.exec], i = 0;
      while (i < list.length && list[i].end > t.start) i++;
      if (i === list.length) list.push({ end: 0, bars: [] });
      list[i].end = t.start + t.duration;
      list[i].bars.push(t);
    });

    var rows = execs.map(function (exec) {
      return lanes[exec].map(function (lane, i) {
        return '<div class="row"><div>Executor ' + esc(exec) + ', slot ' + (i + 1) + '</div><div class="track">' +
          lane.bars.map(function (t) {
            var tip = "Task " + t.taskId + " (index " + t.index + ", attempt " + t.attempt + "): " +
              t.status + ", " + dur(t.duration);
            return '<div class="bar' + (t.status === "SUCCESS" ? "" : " failed") + '" style="left:' +
              (t.start / span * 100).toFixed(2) + '%;width:' + Math.max(t.duration / span * 100, 0.3).toFixed(2) +
              '%" title="' + esc(tip) + '"></div>';
          }).join("") + '</div></div>';
      }).join("");
    }).join("");

    return '<div class="timeline">' +
      '<div class="caption">' + num(tasks.length) + ' task attempts over ' + dur(span) +
      ' from stage submission. Each row is one task slot; failed attempts are red. Hover a bar for the task.</div>' +
      rows + timeAxis(span) + '</div>';
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
    var failed = s.failedTasks !== undefined ? s.failedTasks
      : c.executors.list.reduce(function (sum, e) { return sum + e.failedTasks; }, 0);
    var loss = any(c.executors.list, "lossReason");
    var rows = c.executors.list.map(function (e) {
      return '<tr><td>' + esc(e.id) + '</td><td class="mono">' + esc(e.address) + '</td>' +
        '<td>' + (e.status === "Dead" ? '<span class="task-failed">Dead</span>' : esc(e.status)) + '</td>' +
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
        '<td class="num">' + bytes(e.shuffleWrite) + '</td>' +
        (loss ? '<td>' + (e.lossReason ? '<span class="task-error" title="' + esc(e.lossReason) + '">' +
          esc(e.lossReason.split("\n")[0]) + '</span>' : '') + '</td>' : '') + '</tr>';
    }).join("");

    return '<h3>Executors</h3>' +
      '<h4>Summary</h4>' +
      '<table class="spark"><thead><tr><th></th><th class="num">Active Executors</th>' +
        '<th class="num">Dead</th><th class="num">Total Cores</th><th class="num">Failed Tasks</th>' +
        '<th class="num">Total Tasks</th>' +
        '<th class="num">Task Time (GC Time)</th><th class="num">Input</th>' +
        '<th class="num">Shuffle Read</th><th class="num">Shuffle Write</th></tr></thead>' +
        '<tbody><tr><td>Total</td><td class="num">' + s.activeExecutors + '</td>' +
        '<td class="num">' + s.deadExecutors + '</td><td class="num">' + s.totalCores + '</td>' +
        '<td class="num">' + num(failed) + '</td>' +
        '<td class="num">' + num(s.totalTasks) + '</td>' +
        '<td class="num">' + dur(s.totalTaskTime) + ' (' + dur(s.totalGcTime) + ')</td>' +
        '<td class="num">' + bytes(s.totalInput) + '</td>' +
        '<td class="num">' + bytes(s.totalShuffleRead) + '</td>' +
        '<td class="num">' + bytes(s.totalShuffleWrite) + '</td></tr></tbody></table>' +
      '<h4>Executors</h4>' +
      '<div class="table-scroll"><table class="spark"><thead><tr><th>Executor ID</th><th>Address</th><th>Status</th>' +
        '<th class="num">RDD Blocks</th><th class="num">Storage Memory</th><th class="num">Disk Used</th>' +
        '<th class="num">Cores</th><th class="num">Active Tasks</th><th class="num">Failed Tasks</th>' +
        '<th class="num">Complete Tasks</th><th class="num">Total Tasks</th>' +
        '<th class="num">Task Time (GC Time)</th><th class="num">Input</th>' +
        '<th class="num">Shuffle Read</th><th class="num">Shuffle Write</th>' +
        (loss ? '<th>Exec Loss Reason</th>' : '') + '</tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';
  }

  var SQL_GROUPS = [
    { status: "RUNNING", label: "Running Queries" },
    { status: "COMPLETED", label: "Completed Queries" },
    { status: "FAILED", label: "Failed Queries" }
  ];

  function sqlTab(c) {
    var groups = byStatus(c.sql, SQL_GROUPS, "COMPLETED");
    var tables = groups.map(function (g) {
      var rows = g.rows.map(function (q) {
        return '<tr class="clickable" data-act="sql" data-value="' + q.id + '">' +
          '<td>' + q.id + '</td><td><button type="button" class="spark-link">' + esc(q.description) + '</button></td>' +
          '<td class="mono">' + esc(q.submitted) + '</td>' +
          '<td class="num">' + dur(q.duration) + '</td>' +
          '<td>' + q.jobIds.join(", ") + '</td></tr>';
      }).join("");
      return '<h4>' + g.label + ' (' + g.rows.length + ')</h4>' +
        '<table class="spark"><thead><tr><th>ID</th><th>Description</th><th>Submitted</th>' +
          '<th class="num">Duration</th><th>Job IDs</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table>';
    }).join("");

    return '<h3>SQL / DataFrame</h3>' + tables;
  }

  function findQuery(c, id) {
    return c.sql.filter(function (x) { return x.id === id; })[0];
  }

  function sqlDetail(c, id) {
    var q = findQuery(c, id);
    if (!q) return '<p class="empty-note">Query not found.</p>';

    var jobs = { RUNNING: [], SUCCEEDED: [], FAILED: [] };
    q.jobIds.forEach(function (jid) {
      var j = c.jobs.filter(function (x) { return x.id === jid; })[0];
      jobs[(j && j.status) || "SUCCEEDED"].push(jid);
    });
    var jobLines = [["Running Jobs", jobs.RUNNING], ["Succeeded Jobs", jobs.SUCCEEDED], ["Failed Jobs", jobs.FAILED]]
      .filter(function (p) { return p[1].length; })
      .map(function (p) { return '<li><strong>' + p[0] + ':</strong> ' + p[1].join(", ") + '</li>'; }).join("");

    var props = (q.properties || []).map(function (p) {
      return '<tr><td class="mono">' + esc(p[0]) + '</td><td class="mono">' + esc(p[1]) + '</td></tr>';
    }).join("");

    return '<p><button type="button" class="spark-link" data-act="back">← Back to SQL / DataFrame</button></p>' +
      '<h3>Details for Query ' + q.id + '</h3>' +
      '<ul class="app-summary">' +
        '<li><strong>Submitted Time:</strong> ' + esc(q.submitted) + '</li>' +
        '<li><strong>Duration:</strong> ' + dur(q.duration) + '</li>' +
        jobLines +
      '</ul>' +
      (q.graph ? planGraph(q) : "") +
      collapsible("plan" + id, "Details", '<pre class="plan">' + esc(q.plan) + '</pre>', true) +
      (props ? collapsible("props" + id, "SQL / DataFrame Properties",
        '<table class="spark" style="margin:0"><thead><tr><th>Name</th><th>Value</th></tr></thead>' +
        '<tbody>' + props + '</tbody></table>', false) : "");
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
      var tip = blocks[n.id] || n.tip;
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
    if (c.diagnosis.advice) panels.push({ id: "advice", label: "Spark Advisor" });

    var tab = c.diagnosis[state.diagTab] ? state.diagTab : "dataSkew";
    var nav = panels.map(function (p) {
      var active = tab === p.id;
      return '<button type="button" class="dtab' + (active ? " active" : "") +
        '" data-act="diagtab" data-value="' + p.id + '" aria-pressed="' + active + '">' + p.label + '</button>';
    }).join("");

    var d = c.diagnosis[tab];
    var rows = (d.rows || []).map(function (r) {
      return '<tr><td>' + esc(r[0]) + '</td><td class="num mono">' + esc(r[1]) + '</td></tr>';
    }).join("");

    return '<h3>Diagnosis</h3>' +
      '<p style="color:#777;font-size:13px;margin-top:-6px">Fabric-specific analysis of the application.</p>' +
      '<div class="diag-tabs">' + nav + '</div>' +
      '<div class="diag-card">' +
        '<span class="pill ' + d.severity.replace("/", "") + '">' + esc(d.severity) + '</span>' +
        '<h4 style="margin:10px 0 6px">' + esc(d.headline) + '</h4>' +
        '<p style="color:#555">' + esc(d.detail) + '</p>' +
        (rows ? '<table class="spark" style="max-width:460px;margin-top:14px"><tbody>' +
          rows + '</tbody></table>' : "") +
      '</div>';
  }

  render();
})();
