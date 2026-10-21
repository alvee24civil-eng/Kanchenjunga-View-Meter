const LAT = 26.5032, LON = 88.344, TZ = "Asia/Dhaka";
const HOURS = ["06:00", "07:00", "08:00"];
const DAY_NAMES = ["Today", "Tomorrow", "Day 3"];
const BASE_CONFIDENCE = [90, 80, 70];
const $ = id => document.getElementById(id);
const isNum = v => typeof v === "number" && Number.isFinite(v);

const BANDS = [
  { min: 0,  max: 19,  name: "Hidden",      color: "#e0656a", sky: ["#3e4855", "#8a929c"], desc: "Heavy cloud cover. The range will not be visible this morning." },
  { min: 20, max: 39,  name: "Unwatchable", color: "#e0656a", sky: ["#4b5664", "#a4aab2"], desc: "Thick mist over the valley. At most, faint outlines may appear." },
  { min: 40, max: 59,  name: "Hazy",        color: "#e6b44c", sky: ["#37567a", "#d6b48a"], desc: "Peaks partly hidden. Patches of ridge show through the haze." },
  { min: 60, max: 79,  name: "Visible",     color: "#4fbf85", sky: ["#2a5486", "#f0c58f"], desc: "Most of the range is clear. Light haze softens the distant peaks." },
  { min: 80, max: 100, name: "Clear",       color: "#4fbf85", sky: ["#1f4f8a", "#ffd9a0"], desc: "Full range in sharp view. Good conditions for a dawn visit." }
];
const bandFor = v => BANDS.find(b => v >= b.min && v <= b.max) || BANDS[0];

// Points per rule. Thresholds are starting values for October in Tetulia.
const PTS = { cloud: 30, vis: 30, hum: 20, smog: 20 };
const LABELS = { cloud: "Cloud cover", vis: "Visibility", hum: "Humidity", smog: "Smog (AOD · PM2.5)" };
const NEEDED = {
  cloud: "low <30 · mid <30 · high <40%",
  vis: "8 km or more",
  hum: "under 90%",
  smog: "AOD <0.5 · PM2.5 <100"
};

function evaluate(v) {
  const r = {
    cloud: {
      missing: ![v.cl, v.cm, v.ch].every(isNum),
      pass: v.cl < 30 && v.cm < 30 && v.ch < 40,
      text: [v.cl, v.cm, v.ch].map(x => isNum(x) ? Math.round(x) : "n/a").join(" · ") + "%"
    },
    vis: {
      missing: !isNum(v.vis),
      pass: v.vis >= 8,
      text: isNum(v.vis) ? v.vis.toFixed(1) + " km" : "n/a"
    },
    hum: {
      missing: !isNum(v.hum),
      pass: v.hum < 90,
      text: isNum(v.hum) ? Math.round(v.hum) + "%" : "n/a"
    },
    smog: {
      missing: !isNum(v.aod) || !isNum(v.pm),
      pass: v.aod < 0.5 && v.pm < 100,
      text: (isNum(v.aod) ? v.aod.toFixed(2) : "n/a") + " · " + (isNum(v.pm) ? Math.round(v.pm) : "n/a")
    }
  };
  let score = 0;
  for (const k in r) {
    r[k].pass = !r[k].missing && r[k].pass;
    if (r[k].pass) score += PTS[k];
  }
  return { score, r };
}

function verdict(score) {
  if (score >= 90) return { t: "Go tomorrow", d: "Conditions look excellent. Book the bus.", c: "var(--good)" };
  if (score >= 70) return { t: "High chance", d: "Stay 2 nights in Tetulia.", c: "var(--good)" };
  if (score >= 45) return { t: "Maybe", d: "Only if you can stay flexible.", c: "var(--maybe)" };
  return { t: "Stay home", d: "Conditions look poor.", c: "var(--bad)" };
}

function nowDhaka() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const g = t => parts.find(p => p.type === t).value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")) % 24 };
}

function isPassed(date, now) {
  return date < now.date || (date === now.date && now.hour >= 8);
}

async function fetchWithTimeout(url, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildDays(fc, aq) {
  const h = fc.hourly;
  const a = aq && aq.hourly ? aq.hourly : { time: [] };
  const aqIdx = {};
  (a.time || []).forEach((t, j) => aqIdx[t] = j);

  const dates = [];
  const byDate = {};
  h.time.forEach((t, i) => {
    const [date, hm] = t.split("T");
    if (!HOURS.includes(hm)) return;
    if (!byDate[date]) { byDate[date] = []; dates.push(date); }
    const j = aqIdx[t];
    const v = {
      cl: h.cloud_cover_low[i],
      cm: h.cloud_cover_mid[i],
      ch: h.cloud_cover_high[i],
      vis: isNum(h.visibility[i]) ? h.visibility[i] / 1000 : null,
      hum: h.relative_humidity_2m[i],
      aod: j === undefined ? null : a.aerosol_optical_depth[j],
      pm:  j === undefined ? null : a.pm2_5[j]
    };
    byDate[date].push({ hm, ...evaluate(v) });
  });

  const now = nowDhaka();
  return dates.slice(0, 3).map((date, idx) => {
    const hours = byDate[date];
    const score = Math.round(hours.reduce((s, x) => s + x.score, 0) / hours.length);
    const missingRules = new Set();
    hours.forEach(x => Object.keys(x.r).forEach(k => { if (x.r[k].missing) missingRules.add(k); }));
    const confidence = Math.max(0, BASE_CONFIDENCE[idx] - 15 * missingRules.size);
    return { date, score, hours, confidence, passed: isPassed(date, now), missingRules: missingRules.size };
  });
}

let days = [], current = 0, lastBand = null;
const target = { watch: 0, acc: 0, far: 0, cloud: 0, mist: 0 };
const state  = { watch: 0, acc: 0, far: 0, cloud: 0, mist: 0 };

function renderSegment() {
  const seg = $("seg");
  seg.querySelectorAll("button").forEach(b => b.remove());
  days.forEach((d, i) => {
    const b = document.createElement("button");
    b.className = i === current ? "on" : "";
    b.innerHTML = `${DAY_NAMES[i] || "Day " + (i + 1)}<b>${d.score}%</b>` +
      (d.passed ? `<small>window passed</small>` : "");
    b.onclick = () => { current = i; render(); };
    seg.appendChild(b);
  });
  $("segInd").style.transform = `translateX(${current * 100}%)`;
}

function renderHero(d) {
  const band = bandFor(d.score);
  const v = verdict(d.score);
  $("sky1").style.stopColor = band.sky[0];
  $("sky2").style.stopColor = band.sky[1];
  $("chip").style.setProperty("--c", band.color);
  $("bandName").textContent = band.name;

  const desc = $("bandDesc");
  if (lastBand !== band.name) {
    desc.style.opacity = 0;
    setTimeout(() => { desc.textContent = band.desc; desc.style.opacity = 1; }, 180);
  }
  lastBand = band.name;

  $("arc").style.stroke = band.color;
  $("verdict").textContent = v.t;
  $("verdict").style.color = band.color;

  target.watch = d.score;
  target.far   = 0.05 + 0.95 * Math.pow(d.score / 100, 0.9);
  target.cloud = Math.max(0, (100 - d.score) / 100) * 0.95;
  target.mist  = Math.max(0, 1 - d.score / 70) * 0.9;
}

function renderRules(d) {
  const mark = (x) => x.missing
    ? `<span class="st m">?</span>`
    : x.pass ? `<span class="st p">✓</span>` : `<span class="st f">✗</span>`;

  $("rules").innerHTML = Object.keys(PTS).map(k => {
    const cells = HOURS.map((hm, i) => {
      const h = d.hours[i];
      if (!h) return `<td>n/a</td>`;
      return `<td>${h.r[k].text}${mark(h.r[k])}</td>`;
    }).join("");
    return `<tr><td>${LABELS[k]}<small>${PTS[k]} pts</small></td><td>${NEEDED[k]}</td>${cells}</tr>`;
  }).join("");
}

function renderConfidence(d) {
  target.acc = d.confidence;
  $("accBar").style.background = bandFor(d.confidence).color;
  const reasons = [];
  if (d.passed) reasons.push("This window has already passed, so this is for reference only.");
  if (d.missingRules) reasons.push(`${d.missingRules} rule${d.missingRules > 1 ? "s" : ""} missing data.`);
  reasons.push(d.confidence >= 80 ? "Short range, so the forecast is more reliable."
    : "Further ahead, so the forecast is less certain. Check again the day before.");
  $("accNote").textContent = reasons.join(" ");
}

function render() {
  if (!days.length) return;
  const d = days[current];
  renderSegment();
  renderHero(d);
  renderRules(d);
  renderConfidence(d);
}

async function load() {
  $("updated").textContent = "Fetching live forecast…";
  try {
    const fcUrl = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
      `&timezone=${TZ}&forecast_days=3` +
      `&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m`;
    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}` +
      `&timezone=${TZ}&forecast_days=3&hourly=aerosol_optical_depth,pm2_5`;

    const [fc, aq] = await Promise.all([
      fetchWithTimeout(fcUrl),
      fetchWithTimeout(aqUrl).catch(err => { console.warn("Air quality unavailable:", err); return null; })
    ]);

    days = buildDays(fc, aq);
    current = Math.max(0, days.findIndex(d => !d.passed));
    render();
    $("updated").textContent = (aq ? "" : "Smog data unavailable · ") +
      "Updated " + new Date().toLocaleString("en-GB", { timeZone: TZ }) +
      " · Source: Open-Meteo";
  } catch (e) {
    console.error(e);
    $("updated").textContent = "Could not load forecast: " + e.message + ". Reload to try again.";
  }
}

// Smooth animation loop
function frame() {
  const k = 0.07;
  for (const key in state) state[key] += (target[key] - state[key]) * k;

  $("arc").setAttribute("stroke-dashoffset", (175.93 * (1 - state.watch / 100)).toFixed(2));
  $("heroNum").textContent = Math.round(state.watch) + "%";
  $("accNum").textContent = Math.round(state.acc) + "%";
  $("accBar").style.width = state.acc.toFixed(1) + "%";

  $("far").setAttribute("opacity", state.far.toFixed(3));
  $("cloudG").setAttribute("opacity", state.cloud.toFixed(3));
  $("mistG").setAttribute("opacity", state.mist.toFixed(3));

  document.documentElement.style.setProperty("--cloud", state.cloud.toFixed(3));
  document.documentElement.style.setProperty("--mist", state.mist.toFixed(3));

  requestAnimationFrame(frame);
}

load();
requestAnimationFrame(frame);
setInterval(load, 30 * 60 * 1000);
