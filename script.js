const LAT = 26.5032;
const LON = 88.344;
const TZ = "Asia/Dhaka";

const MODELS = ["ecmwf_ifs04", "gfs_seamless"];
const HOURS = ["06:00", "07:00", "08:00"];

const $ = id => document.getElementById(id);

const isNum = v =>
  typeof v === "number" && !Number.isNaN(v);

const fmt = (x, d = 0) =>
  isNum(x) ? Number(x).toFixed(d) : "n/a";


// ============================================================
// VISUAL STATE
// ============================================================

const state = {
  cloud: 0,
  mist: 0
};


// ============================================================
// UPDATE CSS VARIABLES
// ============================================================

function updateVisualState(v) {

  /*
    CLOUD
    ----------------------------------------------------------
    Average low, middle and high cloud cover.

    API values:
      0   = clear
      100 = completely cloudy

    CSS variable:
      0.000 = no cloud
      1.000 = maximum cloud
  */

  const cloudValues = [v.cl, v.cm, v.ch]
    .filter(isNum);

  let cloud = 0;

  if (cloudValues.length > 0) {
    cloud =
      cloudValues.reduce((sum, value) => sum + value, 0) /
      cloudValues.length /
      100;
  }


  /*
    MIST
    ----------------------------------------------------------
    Humidity + visibility are used to estimate atmospheric mist.

    Higher humidity = more mist.
    Lower visibility = more mist.
  */

  let humidityMist = 0;

  if (isNum(v.hum)) {
    humidityMist = v.hum / 100;
  }


  let visibilityMist = 0;

  if (isNum(v.vis)) {

    // 15 km or more = almost no visibility-related mist
    // 0 km = maximum visibility-related mist

    visibilityMist =
      Math.max(
        0,
        Math.min(
          1,
          1 - (v.vis / 15)
        )
      );
  }


  /*
    Combine humidity and visibility.

    Humidity gets 60% influence.
    Visibility gets 40% influence.
  */

  const mist =
    (humidityMist * 0.6) +
    (visibilityMist * 0.4);


  // Keep everything between 0 and 1.

  state.cloud =
    Math.max(
      0,
      Math.min(1, cloud)
    );

  state.mist =
    Math.max(
      0,
      Math.min(1, mist)
    );


  // ==========================================================
  // SEND WEATHER VALUES TO CSS
  // ==========================================================

  document.documentElement.style.setProperty(
    "--cloud",
    state.cloud.toFixed(3)
  );

  document.documentElement.style.setProperty(
    "--mist",
    state.mist.toFixed(3)
  );
}


// ============================================================
// VIEWING SCORE
// ============================================================

// Each rule:
// points = score awarded
// need   = values required
// test   = condition that must pass
//
// Missing data = no points.

function evaluate(v) {

  const rules = [

    {
      name: "Cloud low<20, mid<20, high<30",
      pts: 30,
      need: [v.cl, v.cm, v.ch],

      test:
        v.cl < 20 &&
        v.cm < 20 &&
        v.ch < 30
    },

    {
      name: "Visibility >12 km",
      pts: 30,
      need: [v.vis],

      test:
        v.vis > 12
    },

    {
      name: "Humidity <65%",
      pts: 20,
      need: [v.hum],

      test:
        v.hum < 65
    },

    {
      name: "Smog: AOD<0.4 and PM2.5<60",
      pts: 20,
      need: [v.aod, v.pm],

      test:
        v.aod < 0.4 &&
        v.pm < 60
    }

  ];


  let score = 0;


  rules.forEach(r => {

    r.missing =
      r.need.some(x => !isNum(x));

    r.pass =
      !r.missing &&
      r.test;

    if (r.pass) {
      score += r.pts;
    }

  });


  return {
    score,
    rules
  };
}


// ============================================================
// VERDICT
// ============================================================

function verdict(score, spread) {

  if (spread > 20) {

    return {
      t: "DON'T GO",
      d: "Models disagree",
      c: "bad"
    };

  }


  if (score >= 90) {

    return {
      t: "GO TOMORROW",
      d: "Book the bus now",
      c: "good"
    };

  }


  if (score >= 70) {

    return {
      t: "HIGH CHANCE",
      d: "Stay 2 nights in Tetulia",
      c: "ok"
    };

  }


  return {

    t: "STAY IN RAJSHAHI",
    d: "Conditions look poor",
    c: "bad"

  };
}


// ============================================================
// DAY LABEL
// ============================================================

const dayLabel = i =>
  ["Today", "Tomorrow", "Day 3"][i] ||
  `Day ${i + 1}`;


// ============================================================
// FETCH JSON
// ============================================================

async function getJSON(url) {

  const r = await fetch(url);

  if (!r.ok) {
    throw new Error(
      "request failed (" +
      r.status +
      ")"
    );
  }

  return r.json();
}


// ============================================================
// LOAD WEATHER
// ============================================================

async function load() {

  $("refresh").disabled = true;

  $("updated").textContent =
    "Fetching weather…";


  try {

    // --------------------------------------------------------
    // WEATHER FORECAST
    // --------------------------------------------------------

    const fcUrl =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${LAT}` +
      `&longitude=${LON}` +
      `&timezone=${TZ}` +
      `&forecast_days=3` +
      `&models=${MODELS.join(",")}` +
      `&hourly=` +
      `cloud_cover_low,` +
      `cloud_cover_mid,` +
      `cloud_cover_high,` +
      `visibility,` +
      `relative_humidity_2m`;


    // --------------------------------------------------------
    // AIR QUALITY
    // --------------------------------------------------------

    const aqUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality` +
      `?latitude=${LAT}` +
      `&longitude=${LON}` +
      `&timezone=${TZ}` +
      `&forecast_days=3` +
      `&hourly=` +
      `aerosol_optical_depth,pm2_5`;


    // --------------------------------------------------------
    // FETCH BOTH AT THE SAME TIME
    // --------------------------------------------------------

    const [fc, aq] =
      await Promise.all([
        getJSON(fcUrl),
        getJSON(aqUrl)
      ]);


    // --------------------------------------------------------
    // RENDER
    // --------------------------------------------------------

    render(fc, aq);


    $("updated").textContent =
      "Updated " +
      new Date().toLocaleString(
        "en-GB",
        {
          timeZone: TZ
        }
      );


  } catch (e) {

    $("days").innerHTML = "";

    $("updated").textContent =
      "Could not load weather: " +
      e.message;


  } finally {

    $("refresh").disabled = false;

  }
}


// ============================================================
// DETAIL INFORMATION
// ============================================================

function detailHTML(m, rec) {

  const v = rec.v;
  const ev = rec.ev;


  const lines =
    ev.rules.map(r =>

      `${r.missing
        ? "?"
        : r.pass
          ? "✓"
          : "✗"
      } ${r.name} (${r.pass ? r.pts : 0}/${r.pts})`

    );


  return `

    <div style="margin-top:10px">

      <b>${m}</b> · 07:00 · score ${ev.score}

      <br>

      Cloud low ${fmt(v.cl)}%
      · mid ${fmt(v.cm)}%
      · high ${fmt(v.ch)}%

      <br>

      Visibility ${fmt(v.vis, 1)} km
      · Humidity ${fmt(v.hum)}%

      <br>

      AOD ${fmt(v.aod, 2)}
      · PM2.5 ${fmt(v.pm, 1)}

      <br>

      ${lines.join("<br>")}

    </div>

  `;
}


// ============================================================
// RENDER
// ============================================================

function render(fc, aq) {

  const h = fc.hourly;
  const a = aq.hourly;


  // ----------------------------------------------------------
  // AIR QUALITY TIME INDEX
  // ----------------------------------------------------------

  const aqIdx = {};

  a.time.forEach((t, j) => {

    aqIdx[t] = j;

  });


  // ----------------------------------------------------------
  // STORE DAYS
  // ----------------------------------------------------------

  const days = {};


  // ----------------------------------------------------------
  // LOOP THROUGH WEATHER HOURS
  // ----------------------------------------------------------

  h.time.forEach((t, i) => {

    const [date, hm] =
      t.split("T");


    // Only use:
    // 06:00
    // 07:00
    // 08:00

    if (!HOURS.includes(hm)) {
      return;
    }


    // --------------------------------------------------------
    // FIND AIR QUALITY DATA
    // --------------------------------------------------------

    const j = aqIdx[t];


    const aod =
      j === undefined
        ? null
        : a.aerosol_optical_depth[j];


    const pm =
      j === undefined
        ? null
        : a.pm2_5[j];


    // Create day

    days[date] ??= {};


    // --------------------------------------------------------
    // PROCESS EACH WEATHER MODEL
    // --------------------------------------------------------

    MODELS.forEach(m => {

      const visM =
        h[`visibility_${m}`][i];


      const v = {

        cl:
          h[`cloud_cover_low_${m}`][i],

        cm:
          h[`cloud_cover_mid_${m}`][i],

        ch:
          h[`cloud_cover_high_${m}`][i],

        // Open-Meteo visibility is metres.
        // Convert to kilometres.

        vis:
          isNum(visM)
            ? visM / 1000
            : null,

        hum:
          h[`relative_humidity_2m_${m}`][i],

        aod,

        pm

      };


      // ------------------------------------------------------
      // EVALUATE SCORE
      // ------------------------------------------------------

      days[date][m] ??= {};


      days[date][m][hm] = {

        v,

        ev: evaluate(v)

      };


      // ------------------------------------------------------
      // UPDATE VISUAL CLOUD / MIST
      //
      // We use ECMWF at 07:00 as the visual state.
      // This prevents the CSS variables being overwritten
      // multiple times during rendering.
      // ------------------------------------------------------

      if (
        hm === "07:00" &&
        m === "ecmwf_ifs04"
      ) {

        updateVisualState(v);

      }

    });

  });


  // ----------------------------------------------------------
  // GET DATES
  // ----------------------------------------------------------

  const dates =
    Object.keys(days).sort();


  // ----------------------------------------------------------
  // CREATE DAY CARDS
  // ----------------------------------------------------------

  $("days").innerHTML =
    dates.map((date, idx) => {


      // ------------------------------------------------------
      // CALCULATE MODEL SCORES
      // ------------------------------------------------------

      const modelScores =
        MODELS.map(m => {

          const hrs =
            Object.values(
              days[date][m]
            );


          return hrs.reduce(
            (s, x) =>
              s + x.ev.score,
            0
          ) / hrs.length;

        });


      // ------------------------------------------------------
      // USE WORST MODEL
      // ------------------------------------------------------

      const score =
        Math.round(
          Math.min(...modelScores)
        );


      // ------------------------------------------------------
      // MODEL DISAGREEMENT
      // ------------------------------------------------------

      const spread =
        Math.round(
          Math.max(...modelScores) -
          Math.min(...modelScores)
        );


      // ------------------------------------------------------
      // VERDICT
      // ------------------------------------------------------

      const v =
        verdict(
          score,
          spread
        );


      // ------------------------------------------------------
      // DETAILS
      // ------------------------------------------------------

      const details =
        MODELS.map(m =>

          days[date][m]["07:00"]

            ? detailHTML(
                m,
                days[date][m]["07:00"]
              )

            : ""

        ).join("");


      // ------------------------------------------------------
      // RETURN CARD HTML
      // ------------------------------------------------------

      return `

        <div class="card ${v.c}">

          <div class="lbl">
            ${dayLabel(idx)} · ${date}
          </div>


          <div class="big">
            ${score}%
          </div>


          <div class="verdict">
            ${v.t}
          </div>


          <div class="sub2">
            ${v.d}
          </div>


          <div class="models">

            ${MODELS.map(
              (m, k) =>

                `<span>
                  ${m}: ${Math.round(modelScores[k])}
                </span>`

            ).join("")}

          </div>


          <details
            style="
              text-align:left;
              margin-top:12px;
              font-size:12px;
              color:#8fa6bf
            "
          >

            <summary
              style="cursor:pointer"
            >
              Why this score?
            </summary>

            ${details}

          </details>

        </div>

      `;

    }).join("");

}


// ============================================================
// REFRESH BUTTON
// ============================================================
load();
requestAnimationFrame(frame);
setInterval(load, 30 * 60 * 1000);

// ============================================================
// INITIAL LOAD
// ============================================================

load();


// ============================================================
// AUTO REFRESH
// Every 30 minutes
// ============================================================

setInterval(
  load,
  30 * 60 * 1000
);
