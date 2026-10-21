const LAT = 26.5032, LON = 88.344, TZ = "Asia/Dhaka";
const MODELS = ["ecmwf_ifs04", "gfs_seamless"];
const HOURS = ["06:00", "07:00", "08:00"];
const $ = id => document.getElementById(id);
const isNum = v => typeof v === "number" && !Number.isNaN(v);
const fmt = (x, d = 0) => isNum(x) ? Number(x).toFixed(d) : "n/a";

// Each rule: points, the values it needs, and the test. Missing data = no points.
function evaluate(v) {
  const rules = [
    { name: "Cloud low<20, mid<20, high<30", pts: 30, need: [v.cl, v.cm, v.ch],
      test: v.cl < 20 && v.cm < 20 && v.ch < 30 },
    { name: "Visibility >12 km", pts: 30, need: [v.vis],
      test: v.vis > 12 },
    { name: "Humidity <65%", pts: 20, need: [v.hum],
      test: v.hum < 65 },
    { name: "Smog: AOD<0.4 and PM2.5<60", pts: 20, need: [v.aod, v.pm],
      test: v.aod < 0.4 && v.pm < 60 },
  ];
  let score = 0;
  rules.forEach(r => {
    r.missing = r.need.some(x => !isNum(x));
    r.pass = !r.missing && r.test;
    if (r.pass) score += r.pts;
  });
  return { score, rules };
}

function verdict(score, spread) {
  if (spread > 20) return { t: "DON'T GO", d: "Models disagree", c: "bad" };
  if (score >= 90) return { t: "GO TOMORROW", d: "Book the bus now", c: "good" };
  if (score >= 70) return { t: "HIGH CHANCE", d: "Stay 2 nights in Tetulia", c: "ok" };
  return { t: "STAY IN RAJSHAHI", d: "Conditions look poor", c: "bad" };
}

const dayLabel = i => ["Today", "Tomorrow", "Day 3"][i] || `Day ${i + 1}`;

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("request failed (" + r.status + ")");
  return r.json();
}

async function load() {
  $("refresh").disabled = true;
  $("updated").textContent = "Fetching weather…";
  try {
    const fcUrl = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
      `&timezone=${TZ}&forecast_days=3&models=${MODELS.join(",")}` +
      `&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m`;
    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}` +
      `&timezone=${TZ}&forecast_days=3&hourly=aerosol_optical_depth,pm2_5`;
    const [fc, aq] = await Promise.all([getJSON(fcUrl), getJSON(aqUrl)]);
    render(fc, aq);
    $("updated").textContent = "Updated " + new Date().toLocaleString("en-GB", { timeZone: TZ });
  } catch (e) {
    $("days").innerHTML = "";
    $("updated").textContent = "Could not load weather: " + e.message;
  } finally {
    $("refresh").disabled = false;
  }
}

function detailHTML(m, rec) {
  const v = rec.v, ev = rec.ev;
  const lines = ev.rules.map(r =>
    `${r.missing ? "?" : r.pass ? "✓" : "✗"} ${r.name} (${r.pass ? r.pts : 0}/${r.pts})`);
  return `<div style="margin-top:10px">
    <b>${m}</b> · 07:00 · score ${ev.score}<br>
    Cloud low ${fmt(v.cl)}% · mid ${fmt(v.cm)}% · high ${fmt(v.ch)}%<br>
    Visibility ${fmt(v.vis, 1)} km · Humidity ${fmt(v.hum)}%<br>
    AOD ${fmt(v.aod, 2)} · PM2.5 ${fmt(v.pm, 1)}<br>
    ${lines.join("<br>")}
  </div>`;
}

function render(fc, aq) {
  const h = fc.hourly, a = aq.hourly;
  const aqIdx = {};
  a.time.forEach((t, j) => aqIdx[t] = j);

  const days = {};
  h.time.forEach((t, i) => {
    const [date, hm] = t.split("T");
    if (!HOURS.includes(hm)) return;
    const j = aqIdx[t];
    const aod = j === undefined ? null : a.aerosol_optical_depth[j];
    const pm = j === undefined ? null : a.pm2_5[j];
    days[date] ??= {};
    MODELS.forEach(m => {
      const visM = h[`visibility_${m}`][i];
      const v = {
        cl: h[`cloud_cover_low_${m}`][i],
        cm: h[`cloud_cover_mid_${m}`][i],
        ch: h[`cloud_cover_high_${m}`][i],
        vis: isNum(visM) ? visM / 1000 : null,
        hum: h[`relative_humidity_2m_${m}`][i],
        aod, pm
      };
      days[date][m] ??= {};
      days[date][m][hm] = { v, ev: evaluate(v) };
    });
  });

  const dates = Object.keys(days).sort();
  $("days").innerHTML = dates.map((date, idx) => {
    const modelScores = MODELS.map(m => {
      const hrs = Object.values(days[date][m]);
      return hrs.reduce((s, x) => s + x.ev.score, 0) / hrs.length;
    });
    const score = Math.round(Math.min(...modelScores));
    const spread = Math.round(Math.max(...modelScores) - Math.min(...modelScores));
    const v = verdict(score, spread);
    const details = MODELS.map(m => days[date][m]["07:00"]
      ? detailHTML(m, days[date][m]["07:00"]) : "").join("");

    return `
      <div class="card ${v.c}">
        <div class="lbl">${dayLabel(idx)} · ${date}</div>
        <div class="big">${score}%</div>
        <div class="verdict">${v.t}</div>
        <div class="sub2">${v.d}</div>
        <div class="models">${MODELS.map((m, k) => `<span>${m}: ${Math.round(modelScores[k])}</span>`).join("")}</div>
        <details style="text-align:left;margin-top:12px;font-size:12px;color:#8fa6bf">
          <summary style="cursor:pointer">Why this score?</summary>
          ${details}
        </details>
      </div>`;
  }).join("");
}

$("refresh").addEventListener("click", load);
load();
setInterval(load, 30 * 60 * 1000);
