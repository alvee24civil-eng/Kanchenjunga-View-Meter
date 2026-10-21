const LAT = 26.5032, LON = 88.344, TZ = "Asia/Dhaka";
const MODELS = [{ id: "ecmwf_ifs04", name: "ECMWF" }, { id: "gfs_seamless", name: "GFS" }];
const HOURS = ["06:00", "07:00", "08:00"];
const DAY_NAMES = ["Today", "Tomorrow", "Day 3"];
const $ = id => document.getElementById(id);
const isNum = v => typeof v === "number" && !Number.isNaN(v);

const BANDS = [
  { min: 0,  max: 19,  name: "Hidden",      color: "#e0656a", sky: ["#3e4855", "#8a929c"], desc: "Heavy cloud cover. The range will not be visible this morning." },
  { min: 20, max: 39,  name: "Unwatchable", color: "#e0656a", sky: ["#4b5664", "#a4aab2"], desc: "Thick mist over the valley. At most, faint outlines may appear." },
  { min: 40, max: 59,  name: "Hazy",        color: "#e6b44c", sky: ["#37567a", "#d6b48a"], desc: "Peaks partly hidden. Patches of ridge show through the haze." },
  { min: 60, max: 79,  name: "Visible",     color: "#4fbf85", sky: ["#2a5486", "#f0c58f"], desc: "Most of the range is clear. Light haze softens the distant peaks." },
  { min: 80, max: 100, name: "Clear",       color: "#4fbf85", sky: ["#1f4f8a", "#ffd9a0"], desc: "Full range in sharp view. Good conditions for a dawn visit." }
];
const bandFor = v => BANDS.find(b => v >= b.min && v <= b.max) || BANDS[0];

// Rules from the plan. Missing data earns no points and is shown as "?".
function evaluate(v) {
  const rules = [
    { name: "Cloud low <20%, mid <20%, high <30%", pts: 30, need: [v.cl, v.cm, v.ch], test: () => v.cl < 20 && v.cm < 20 && v.ch < 30 },
    { name: "Visibility >12 km", pts: 30, need: [v.vis], test: () => v.vis > 12 },
    { name: "Humidity <65%", pts: 20, need: [v.hum], test: () => v.hum < 65 },
    { name: "Smog: AOD <0.4 and PM2.5 <60", pts: 20, need: [v.aod, v.pm], test: () => v.aod < 0.4 && v.pm < 60 }
  ];
  let score = 0;
  rules.forEach(r => {
    r.missing = r.need.some(x => !isNum(x));
    r.pass = !r.missing && r.test();
    if (r.pass) score += r.pts;
  });
  return { score, rules, v };
}

function verdict(score, spread) {
  if (spread > 20) return { t: "Models disagree", d: "Don't go. The forecasts conflict.", c: "var(--bad)" };
  if (score >= 90) return { t: "Go tomorrow", d: "Book the bus now.", c: "var(--good)" };
  if (score >= 70) return { t: "High chance", d: "Stay 2 nights in Tetulia.", c: "var(--good)" };
  if (score >= 45) return { t: "Maybe", d: "Only if you can stay flexible.", c: "var(--maybe)" };
  return { t: "Stay home", d: "Conditions look poor.", c: "var(--bad)" };
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
  const a = aq && aq.hourly ? aq.hourly : { time: [], aerosol_optical_depth: [], pm2_5: [] };
  const aqIdx = {};
  a.time.forEach((t, j) => aqIdx[t] = j);

  const map = {};
  h.time.forEach((t, i) => {
    const [date, hm] = t.split("T");
    if (!HOURS.includes(hm)) return;
    const j = aqIdx[t];
    const aod = j === undefined ? null : a.aerosol_optical_depth[j];
    const pm  = j === undefined ? null : a.pm2_5[j];
    map[date] ??= { date, models: {} };
    MODELS.forEach(m => {
      const visM = h[`visibility_${m.id}`][i];
      const v = {
        cl: h[`cloud_cover_low_${m.id}`][i],
        cm: h[`cloud_cover_mid_${m.id}`][i],
        ch: h[`cloud_cover_high_${m.id}`][i],
        vis: isNum(visM) ? visM / 1000 : null,
        hum: h[`relative_humidity_2m_${m.id}`][i],
        aod, pm
      };
      const M = (map[date].models[m.id] ??= { scores: [], at07: null });
      const ev = evaluate(v);
      M.scores.push(ev.score);
      if (hm === "07:00") M.at07 = ev;
    });
  });

  return Object.values(map)
    .sort((x, y) => x.date < y.date ? -1 : 1)
    .slice(0, 3)
    .map(d => {
      const per = MODELS.map(m => {
        const M = d.models[m.id];
        return M.scores.reduce((s, x) => s + x, 0) / M.scores.length;
      });
      return {
        date: d.date,
        score: Math.round(Math.min(...per)),
        spread: Math.round(Math.max(...per) - Math.min(...per)),
        perModel: per.map(Math.round),
        models: d.models
      };
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
    b.innerHTML = `${DAY_NAMES[i] || "Day " + (i + 1)}<b>${d.score}%</b>`;
    b.onclick = () => { current = i; render(); };
    seg.appendChild(b);
  });
  $("segInd").style.transform = `translateX(${current * 100}%)`;
}

function renderHero(d) {
  const band = bandFor(d.score);
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
  $("verdict").textContent = verdict(d.score, d.spread).t;
  $("verdict").style.color = band.color;

  target.watch = d.score;
  target.far   = 0.05 + 0.95 * Math.pow(d.score / 100, 0.9);
  target.cloud = Math.max(0, (100 - d.score) / 100) * 0.95;
  target.mist  = Math.max(0, 1 - d.score / 70) * 0.9;
}

function renderRules(d) {
  const e = d.models[MODELS[0].id].at07;
  const g = d.models[MODELS[1].id].at07;
  const mark = r => r.missing ? `<span class="st m">?</span>`
    : r.pass ? `<span class="st p">✓</span>` : `<span class="st f">✗</span>`;

  $("rules").innerHTML = e.rules.map((r, i) =>
    `<tr><td>${r.name}</td><td>${mark(r)}</td><td>${mark(g.rules[i])}</td></tr>`).join("");

  const v = e.v;
  const f = x => isNum(x) ? Math.round(x) : "n/a";
  $("raw").innerHTML =
    `ECMWF 07:00 · cloud ${f(v.cl)}/${f(v.cm)}/${f(v.ch)}% · ` +
    `vis ${isNum(v.vis) ? v.vis.toFixed(1) : "n/a"} km · RH ${f(v.hum)}% · ` +
    `AOD ${isNum(v.aod) ? v.aod.toFixed(2) : "n/a"} · PM2.5 ${f(v.pm)}`;
}

function renderAccuracy(d) {
  const [e, g] = d.perModel;
  const agreement = Math.max(0, 100 - d.spread * 1.5);
  const dayScale = [1, 0.85, 0.7][current] ?? 0.7;
  const accuracy = Math.round(agreement * dayScale);

  target.acc = accuracy;
  $("accBar").style.background = bandFor(accuracy).color;

  $("mE").textContent = e + "%";
  $("mG").textContent = g + "%";
  $("fE").style.width = e + "%";
  $("fE").style.background = bandFor(e).color;
  $("fG").style.width = g + "%";
  $("fG").style.background = bandFor(g).color;

  $("accNote").textContent =
    `Models agree within ${d.spread} points. ` +
    (current === 0 ? "Today's forecast is the most reliable."
      : current === 1 ? "Tomorrow is less certain than today."
      : "Day 3 is the least certain. Check again the day before.");
}

function render() {
  if (!days.length) return;
  const d = days[current];
  renderSegment();
  renderHero(d);
  renderRules(d);
  renderAccuracy(d);
}

async function load() {
  $("updated").textContent = "Fetching live forecast…";
  try {
    const fcUrl = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
      `&timezone=${TZ}&forecast_days=3&models=${MODELS.map(m => m.id).join(",")}` +
      `&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m`;
    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}` +
      `&timezone=${TZ}&forecast_days=3&hourly=aerosol_optical_depth,pm2_5`;

    const [fc, aq] = await Promise.all([
      fetchWithTimeout(fcUrl),
      fetchWithTimeout(aqUrl).catch(err => { console.warn("Air quality unavailable:", err); return null; })
    ]);

    days = buildDays(fc, aq);
    current = 0;
    render();
    $("updated").textContent = (aq ? "" : "Smog data unavailable · ") +
      "Updated " + new Date().toLocaleString("en-GB", { timeZone: TZ });
  } catch (e) {
    console.error(e);
    $("updated").textContent = "Could not load forecast: " + e.message + ". Reload to try again.";
  }
}

// Smooth animation loop: eases every value toward its target.
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
