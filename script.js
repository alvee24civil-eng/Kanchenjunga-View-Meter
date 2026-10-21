const LAT = 26.5032, LON = 88.344, TZ = "Asia/Dhaka";
const MODELS = ["ecmwf_ifs04", "gfs_seamless"];
const HOURS = ["06:00", "07:00", "08:00"];
const $ = id => document.getElementById(id);

// Scoring rules from the plan: cloud layers, visibility, humidity, aerosol/smog.
function hourScore(cl, cm, ch, visKm, hum, aod, pm25) {
  let s = 0;
  if (cl < 20 && cm < 20 && ch < 30) s += 30;
  if (visKm > 12) s += 30;
  if (hum < 65) s += 20;
  if (aod < 0.4 && pm25 < 60) s += 20;
  return s;
}

function verdict(score, spread) {
  if (spread > 20) return { t: "DON'T GO", d: "Models disagree", c: "bad" };
  if (score >= 90) return { t: "GO TOMORROW", d: "Book the bus now", c: "good" };
  if (score >= 70) return { t: "HIGH CHANCE", d: "Stay 2 nights in Tetulia", c: "ok" };
  return { t: "STAY IN RAJSHAHI", d: "Conditions look poor", c: "bad" };
}

const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
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

function render(fc, aq) {
  const h = fc.hourly, a = aq.hourly;
  const aqIdx = {};
  a.time.forEach((t, j) => aqIdx[t] = j);

  const perDay = {};
  h.time.forEach((t, i) => {
    const [date, hm] = t.split("T");
    if (!HOURS.includes(hm) || aqIdx[t] === undefined) return;
    const j = aqIdx[t];
    const aod = a.aerosol_optical_depth[j] ?? 0;
    const pm = a.pm2_5[j] ?? 0;
    perDay[date] ??= {};
    MODELS.forEach(m => {
      const s = hourScore(
        h[`cloud_cover_low_${m}`][i],
        h[`cloud_cover_mid_${m}`][i],
        h[`cloud_cover_high_${m}`][i],
        h[`visibility_${m}`][i] / 1000,
        h[`relative_humidity_2m_${m}`][i],
        aod, pm);
      (perDay[date][m] ??= []).push(s);
    });
  });

  const dates = Object.keys(perDay).sort();
  $("days").innerHTML = dates.map((date, idx) => {
    const by = MODELS.map(m => avg(perDay[date][m]));
    const score = Math.round(Math.min(...by));          // both models must agree
    const spread = Math.round(Math.max(...by) - Math.min(...by));
    const v = verdict(score, spread);
    return `
      <div class="card ${v.c}">
        <div class="lbl">${dayLabel(idx)} · ${date}</div>
        <div class="big">${score}%</div>
        <div class="verdict">${v.t}</div>
        <div class="sub2">${v.d}</div>
        <div class="models">${MODELS.map((m, k) => `<span>${m}: ${Math.round(by[k])}</span>`).join("")}</div>
      </div>`;
  }).join("");
}

$("refresh").addEventListener("click", load);
load();
setInterval(load, 30 * 60 * 1000);
