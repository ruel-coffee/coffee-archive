const $ = (id) => document.getElementById(id);

const SUPABASE_URL = window.COFFEE_ARCHIVE_SUPABASE_URL;
const SUPABASE_ANON_KEY = window.COFFEE_ARCHIVE_SUPABASE_ANON_KEY;
const AUTH_DOMAIN = window.COFFEE_ARCHIVE_AUTH_DOMAIN || "coffee-archive.local";

let supabaseClient = null;

let state = {
  brewing: [],
  espresso: [],
  currentPoint: null
};

let currentUser = null;
let currentAuthUser = null;
let authMode = "login";

const today = () => new Date().toISOString().slice(0, 10);
const clean = (v) => String(v ?? "").trim();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const fmt = (v, d = 2) => v === null || v === undefined || Number.isNaN(Number(v)) ? "-" : Number(v).toFixed(d);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[m]));

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("PASTE_") || SUPABASE_ANON_KEY.includes("PASTE_")) {
    throw new Error("Supabase 설정이 필요합니다. supabase-config.js에 URL과 anon key를 입력해주세요.");
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabaseClient;
}

function nicknameToEmail(nickname) {
  const normalized = clean(nickname).toLowerCase();
  const encoded = btoa(unescape(encodeURIComponent(normalized)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `nick-${encoded}@${AUTH_DOMAIN}`;
}

async function loadRecords() {
  const sb = getSupabaseClient();

  const [brewingResult, espressoResult] = await Promise.all([
    sb.from("brewing_records").select("id, data, created_at").order("created_at", { ascending: false }),
    sb.from("espresso_records").select("id, data, created_at").order("created_at", { ascending: false })
  ]);

  if (brewingResult.error) throw brewingResult.error;
  if (espressoResult.error) throw espressoResult.error;

  state.brewing = (brewingResult.data || []).map(row => ({
    ...(row.data || {}),
    id: row.id,
    owner: currentUser || row.data?.owner || "unknown",
    createdAt: row.created_at
  }));

  state.espresso = (espressoResult.data || []).map(row => ({
    ...(row.data || {}),
    id: row.id,
    owner: currentUser || row.data?.owner || "unknown",
    createdAt: row.created_at
  }));

  state.currentPoint = null;
}

async function saveRecord(tableName, record) {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from(tableName)
    .insert({ data: record })
    .select("id, data, created_at")
    .single();

  if (error) throw error;
  return data;
}

function calcEY(dose, beverage, tds) {
  if (!dose || !beverage || !tds || dose <= 0 || beverage <= 0 || tds <= 0) return null;
  return beverage * tds / dose;
}

function calcRatio(dose, beverage) {
  if (!dose || !beverage || dose <= 0) return null;
  return beverage / dose;
}

function positionText(tds, ey) {
  if (!tds || !ey) return "-";
  const strength = tds < 1.15 ? "약함" : tds > 1.35 ? "강함" : "권장 농도";
  const extraction = ey < 18 ? "저수율" : ey > 22 ? "고수율" : "권장 수율";
  return `${strength} / ${extraction}`;
}


function ensureExtractionAdvicePanel() {
  if ($("extractionAdvice")) return;
  const resultGrid = document.querySelector("#calcForm .result-grid");
  const actions = document.querySelector("#calcForm .actions");
  const panel = document.createElement("section");
  panel.id = "extractionAdvice";
  panel.className = "extraction-advice";
  panel.setAttribute("aria-live", "polite");
  panel.innerHTML = `
    <div class="advice-head">
      <h3>추출 해석 및 다음 방향 제시</h3>
      <span id="adviceZone" class="advice-zone">입력 대기</span>
    </div>
    <p id="adviceSummary" class="advice-summary">도징, 추출액, TDS를 입력하면 Brewing / Espresso 관점에서 현재 위치를 해석하고 다음 조정 방향을 제안합니다.</p>
    <div class="advice-grid">
      <div><span>우선 조정 변수</span><strong id="advicePrimary">-</strong></div>
      <div><span>보조 조정 변수</span><strong id="adviceSecondary">-</strong></div>
      <div><span>테스트 방향</span><strong id="adviceTest">-</strong></div>
    </div>
    <p id="adviceNote" class="advice-note">한 번에 하나의 변수만 바꾸면 다음 추출에서 원인을 더 정확히 볼 수 있습니다.</p>
  `;
  if (actions) actions.parentNode.insertBefore(panel, actions);
  else if (resultGrid) resultGrid.insertAdjacentElement("afterend", panel);
}

function setAdviceText(data) {
  ensureExtractionAdvicePanel();
  const pairs = {
    adviceZone: data.zone,
    adviceSummary: data.summary,
    advicePrimary: data.primary,
    adviceSecondary: data.secondary,
    adviceTest: data.test,
    adviceNote: data.note
  };
  Object.entries(pairs).forEach(([id, value]) => {
    const el = $(id);
    if (el) el.textContent = value || "-";
  });
}

function resetExtractionAdvice() {
  setAdviceText({
    zone: "입력 대기",
    summary: "도징, 추출액, TDS를 입력하면 Brewing / Espresso 관점에서 현재 위치를 해석하고 다음 조정 방향을 제안합니다.",
    primary: "-",
    secondary: "-",
    test: "-",
    note: "한 번에 하나의 변수만 바꾸면 다음 추출에서 원인을 더 정확히 볼 수 있습니다."
  });
}

function getBrewingAdvice(tds, ey, ratio) {
  const strength = tds < 1.15 ? "weak" : tds > 1.35 ? "strong" : "ideal";
  const extraction = ey < 18 ? "under" : ey > 22 ? "over" : "ideal";
  const zoneLabel = {
    weak: "약한 농도", ideal: "권장 농도", strong: "강한 농도",
    under: "저수율", over: "고수율"
  };

  const map = {
    "weak-under": {
      summary: "농도와 수율이 모두 낮은 구간입니다. 컵이 얇고, 단맛과 구조가 부족하거나 산미가 날카롭게 느껴질 가능성이 있습니다.",
      primary: "분쇄도를 조금 더 가늘게 조정하거나, 물 온도를 1~2℃ 높여 추출력을 올립니다.",
      secondary: "푸어 교반을 소폭 늘리거나 총 접촉시간을 늘려 수용성 성분 추출을 보완합니다.",
      test: "분쇄도만 한 단계 가늘게 바꾼 뒤 같은 도징, 같은 물, 같은 드리퍼 조건에서 비교하세요."
    },
    "weak-ideal": {
      summary: "수율은 권장 범위지만 농도가 낮은 구간입니다. 추출 부족보다는 레시피가 길거나 희석감이 큰 상태일 수 있습니다.",
      primary: "총 투입수 또는 추출액을 줄여 레시오를 짧게 가져갑니다.",
      secondary: "같은 레시오를 유지하고 싶다면 도징을 소폭 늘려 농도감을 확보합니다.",
      test: "현재 레시피를 기준 레시피로 저장하고, 물 양을 10~15g 줄여 농도 변화를 확인하세요."
    },
    "weak-over": {
      summary: "수율은 높지만 농도는 낮은 구간입니다. 너무 긴 레시오로 많이 녹였지만 컵은 묽게 느껴질 수 있습니다.",
      primary: "추출액 또는 총 투입수를 줄여 후반부 추출을 제한합니다.",
      secondary: "분쇄도를 약간 굵게 하거나 후반 푸어 교반을 줄여 과다 추출감을 낮춥니다.",
      test: "레시오를 먼저 줄이고, 쓴맛·건조감이 남는다면 분쇄도나 온도를 추가로 조정하세요."
    },
    "ideal-under": {
      summary: "농도는 권장 범위지만 수율이 낮은 구간입니다. 강도는 있으나 단맛, 투명도, 복합성이 덜 열렸을 수 있습니다.",
      primary: "분쇄도를 조금 더 가늘게 하거나 접촉시간을 늘려 수율을 올립니다.",
      secondary: "물 온도를 1℃ 정도 높이거나 1차/2차 푸어의 교반을 소폭 늘립니다.",
      test: "농도는 유지되는지 보면서 수율만 18% 이상으로 올리는 방향으로 비교하세요."
    },
    "ideal-ideal": {
      summary: "브루잉 컨트롤 차트 기준으로 균형 구간에 있습니다. 수치상으로는 현재 레시피를 기준점으로 삼기 좋습니다.",
      primary: "현재 레시피를 기준 레시피로 저장하고 관능 목적에 따라 미세 조정합니다.",
      secondary: "더 선명하게는 분쇄를 약간 굵게, 더 단맛 쪽으로는 분쇄를 약간 가늘게 테스트합니다.",
      test: "한 번은 현재 레시피를 반복 추출해 재현성을 확인한 뒤, 한 변수만 바꿔 비교하세요."
    },
    "ideal-over": {
      summary: "농도는 권장 범위지만 수율이 높은 구간입니다. 컵에서 건조감, 쓴맛, 거친 후미가 나타날 수 있습니다.",
      primary: "분쇄도를 조금 더 굵게 하거나 물 온도를 낮춰 추출 강도를 줄입니다.",
      secondary: "후반부 푸어 교반을 줄이고, 총 추출 시간을 짧게 가져갑니다.",
      test: "분쇄도를 먼저 굵게 바꾸고, 그래도 후미가 무거우면 추출량을 줄여보세요."
    },
    "strong-under": {
      summary: "농도는 높지만 수율이 낮은 구간입니다. 진하지만 덜 풀린 컵, 혹은 막힘과 불균일 추출 가능성이 있습니다.",
      primary: "레시오를 길게 하거나 추출액을 늘려 수율을 확보합니다.",
      secondary: "흐름이 막히는 느낌이면 분쇄를 약간 굵게 하고 푸어를 안정적으로 가져갑니다.",
      test: "추출액을 10~15g 늘려보고, 농도가 과하게 높게 유지되면 분쇄도도 함께 점검하세요."
    },
    "strong-ideal": {
      summary: "수율은 권장 범위이고 농도는 높은 구간입니다. 진한 구조감이 목적이라면 유지할 수 있지만, 마시기 무겁게 느껴질 수 있습니다.",
      primary: "더 편안한 컵을 원하면 레시오를 길게 하거나 도징을 소폭 줄입니다.",
      secondary: "농도감은 유지하되 선명도를 원하면 분쇄도를 약간 굵게 테스트합니다.",
      test: "현재 컵을 진한 기준점으로 저장하고, 물 양을 10g 늘린 버전과 비교하세요."
    },
    "strong-over": {
      summary: "농도와 수율이 모두 높은 구간입니다. 강하고 무거우며 쓴맛, 텁텁함, 건조감이 나올 가능성이 큽니다.",
      primary: "분쇄도를 굵게 하고, 물 온도와 교반을 줄여 추출 강도를 낮춥니다.",
      secondary: "추출액을 줄여 후반부 과다 추출을 제한하거나 도징을 낮춰 농도감을 완화합니다.",
      test: "분쇄도를 굵게 바꾸는 테스트를 먼저 하고, 다음 추출에서 추출량을 줄이는 테스트를 분리해서 보세요."
    }
  };
  const key = `${strength}-${extraction}`;
  const data = map[key];
  return {
    zone: `${zoneLabel[strength]} · ${extraction === "ideal" ? "권장 수율" : zoneLabel[extraction]} · Brewing 기준`,
    ...data,
    note: `현재 레시오는 약 1:${fmt(ratio, 1)}입니다. 브루잉에서는 레시오가 농도에 가장 직접적으로 작용하고, 분쇄도·온도·교반·시간은 수율과 균일성에 크게 관여합니다.`
  };
}

function getEspressoAdvice(tds, ey, ratio) {
  const extraction = ey < 18 ? "under" : ey > 22 ? "over" : "ideal";
  const strength = tds < 7 ? "low" : tds > 12 ? "high" : "espresso";
  const map = {
    under: {
      summary: "에스프레소 기준에서 수율이 낮은 편입니다. 농도감과 별개로 산미가 날카롭거나 단맛이 충분히 열리지 않았을 수 있습니다.",
      primary: "분쇄도를 가늘게 하거나 추출량을 늘려 수율을 올립니다.",
      secondary: "저항이 너무 낮다면 도징을 소폭 올리거나 바스켓 헤드스페이스를 점검합니다.",
      test: "분쇄도만 가늘게 바꾼 버전과 추출량만 늘린 버전을 분리해서 비교하세요."
    },
    ideal: {
      summary: "에스프레소 기준에서 수율은 균형 범위에 있습니다. 이 상태에서는 농도와 질감, 레시오 목적에 따라 방향을 나누는 것이 좋습니다.",
      primary: "현재 컵을 기준점으로 저장하고, 더 진하게는 레시오를 짧게, 더 열리게는 레시오를 길게 조정합니다.",
      secondary: "압력, 프리인퓨전, 헤드스페이스는 퍽 안정성과 질감 변화를 확인하는 보조 변수로 봅니다.",
      test: "같은 분쇄도에서 추출량만 2~4g 단위로 조정해 농도와 후미 변화를 비교하세요."
    },
    over: {
      summary: "에스프레소 기준에서 수율이 높은 편입니다. 쓴맛, 건조감, 거친 후미가 올라올 가능성이 있습니다.",
      primary: "분쇄도를 굵게 하거나 추출량을 줄여 후반부 추출을 제한합니다.",
      secondary: "고압 구간이 길다면 압력 프로파일을 낮추거나 램프다운을 활용해 과한 성분 추출을 줄입니다.",
      test: "추출량을 먼저 줄이고, 그래도 건조하면 분쇄도와 압력 프로파일을 따로 조정하세요."
    }
  };
  const label = strength === "low" ? "낮은 에스프레소 농도" : strength === "high" ? "높은 에스프레소 농도" : "에스프레소 농도";
  return {
    zone: `${label} · ${extraction === "under" ? "저수율" : extraction === "over" ? "고수율" : "권장 수율"} · Espresso 기준`,
    ...map[extraction],
    note: `현재 레시오는 약 1:${fmt(ratio, 1)}입니다. 에스프레소는 브루잉 컨트롤 차트의 농도 축과 범위가 다르므로, 수율과 레시오를 중심으로 해석하고 분쇄도·도징·압력·헤드스페이스를 함께 봅니다.`
  };
}

function updateExtractionAdvice(tds, ey, ratio) {
  if (!tds || !ey || !ratio) {
    resetExtractionAdvice();
    return;
  }

  // Brewing Control Chart는 필터커피 구간을 기준으로 하지만,
  // 계산기에 에스프레소 수치가 들어올 수 있으므로 TDS와 레시오로 관점을 분리합니다.
  // - Brewing: 보통 낮은 TDS와 긴 레시오
  // - Espresso: 높은 TDS 또는 짧은 레시오
  const isEspressoRange = tds >= 3 || ratio <= 8;
  const advice = isEspressoRange ? getEspressoAdvice(tds, ey, ratio) : getBrewingAdvice(tds, ey, ratio);
  setAdviceText(advice);
}

function initTabs() {
  document.querySelectorAll(".tabbar").forEach(tabbar => {
    tabbar.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      const group = tabbar.dataset.tabs;
      tabbar.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(`#${group} .tab-panel`).forEach(panel => panel.classList.remove("active"));
      $(btn.dataset.target).classList.add("active");
    });
  });
}

function setDateDefaults() {
  ["brewDate", "espDate"].forEach(id => {
    const el = $(id);
    if (el && !el.value) el.value = today();
  });
}

function updateCalculator() {
  const dose = num($("dose").value);
  const beverage = num($("beverage").value);
  const tds = num($("tds").value);
  const ey = calcEY(dose, beverage, tds);
  const ratio = calcRatio(dose, beverage);

  $("eyResult").textContent = ey ? `${fmt(ey)}%` : "-";
  $("ratioResult").textContent = ratio ? `1:${fmt(ratio, 1)}` : "-";
  $("positionResult").textContent = positionText(tds, ey);

  if (ey && tds) {
    state.currentPoint = {
      date: today(),
      dose,
      beverage,
      tds,
      ey,
      ratio,
      source: "수율 계산기"
    };
  } else {
    state.currentPoint = null;
  }

  updateExtractionAdvice(tds, ey, ratio);
  requestAnimationFrame(drawChart);
}

function drawChart() {
  const canvas = $("controlChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#f4f5f5";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "#000";
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 16, W - 32, H - 32);

  ctx.fillStyle = "#6f777b";
  ctx.font = "42px Helvetica, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("Coffee Brewing Control Chart", W - 110, 110);

  ctx.font = "28px Helvetica, Arial, sans-serif";
  ctx.fillText("커피 브루잉 컨트롤 차트", W - 110, 150);

  ctx.textAlign = "center";
  ctx.font = "18px Helvetica, Arial, sans-serif";
  ctx.fillText("Coffee to Water Ratio, by Weight", W / 2 + 230, 205);

  const plot = {
    left: 250,
    right: 1120,
    top: 300,
    bottom: 1280,
    xMin: 14,
    xMax: 26,
    yMin: 0.90,
    yMax: 1.80
  };

  const x = (ey) => plot.left + ((ey - plot.xMin) / (plot.xMax - plot.xMin)) * (plot.right - plot.left);
  const y = (tds) => plot.bottom - ((tds - plot.yMin) / (plot.yMax - plot.yMin)) * (plot.bottom - plot.top);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);

  ctx.strokeStyle = "#d7d7d7";
  ctx.lineWidth = 1;
  for (let ey = 14; ey <= 26.001; ey += 0.2) {
    const px = x(ey);
    ctx.beginPath(); ctx.moveTo(px, plot.top); ctx.lineTo(px, plot.bottom); ctx.stroke();
  }
  for (let t = 0.90; t <= 1.8001; t += 0.01) {
    const py = y(t);
    ctx.beginPath(); ctx.moveTo(plot.left, py); ctx.lineTo(plot.right, py); ctx.stroke();
  }

  ctx.strokeStyle = "#a8a8a8";
  ctx.lineWidth = 1.5;
  for (let ey = 14; ey <= 26; ey += 1) {
    const px = x(ey);
    ctx.beginPath(); ctx.moveTo(px, plot.top); ctx.lineTo(px, plot.bottom); ctx.stroke();
  }
  for (let t = 0.90; t <= 1.8001; t += 0.05) {
    const py = y(t);
    ctx.beginPath(); ctx.moveTo(plot.left, py); ctx.lineTo(plot.right, py); ctx.stroke();
  }

  const idealX1 = x(18);
  const idealX2 = x(22);
  const idealY1 = y(1.80);
  const idealY2 = y(0.90);
  ctx.fillStyle = "rgba(24, 168, 223, 0.45)";
  ctx.fillRect(idealX1, idealY1, idealX2 - idealX1, idealY2 - idealY1);

  ctx.strokeStyle = "#18a8df";
  ctx.lineWidth = 4;
  ctx.strokeRect(idealX1, idealY1, idealX2 - idealX1, idealY2 - idealY1);

  const ratios = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
  ctx.strokeStyle = "#18a8df";
  ctx.lineWidth = 7;
  ctx.font = "20px Helvetica, Arial, sans-serif";
  ctx.fillStyle = "#000";

  ratios.forEach((ratio) => {
    const points = [];
    for (let ey = plot.xMin; ey <= plot.xMax; ey += 0.05) {
      const tds = ey / ratio;
      if (tds >= plot.yMin && tds <= plot.yMax) points.push([x(ey), y(tds), ey, tds]);
    }
    if (points.length > 1) {
      ctx.beginPath();
      points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.stroke();

      const labelPoint = points[Math.min(points.length - 1, Math.floor(points.length * 0.86))];
      ctx.save(); ctx.translate(labelPoint[0], labelPoint[1]); ctx.rotate(-0.75); ctx.fillText(`1:${ratio}`, 0, -12); ctx.restore();
    }
  });

  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.strokeRect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);

  ctx.fillStyle = "#000";
  ctx.font = "20px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  for (let ey = 14; ey <= 26; ey += 1) ctx.fillText(`${ey}%`, x(ey), plot.bottom + 38);

  ctx.textAlign = "right";
  for (let t = 0.90; t <= 1.8001; t += 0.05) ctx.fillText(`${t.toFixed(2)}%`, plot.left - 18, y(t) + 7);

  ctx.textAlign = "left";
  [[1.80,"1:16"],[1.70,"1:17"],[1.60,"1:18"],[1.50,"1:19"],[1.40,"1:20"],[1.30,"1:21"],[1.20,"1:22"]]
    .forEach(([tds, label]) => ctx.fillText(label, plot.right + 18, y(tds) + 7));

  ctx.textAlign = "center";
  ctx.font = "26px Helvetica, Arial, sans-serif";
  ctx.fillText("Extraction – Solubles Yield", (plot.left + plot.right) / 2, plot.bottom + 96);
  ctx.font = "20px Helvetica, Arial, sans-serif";
  ctx.fillText("수율 – 수용성 성분의 산출량", (plot.left + plot.right) / 2, plot.bottom + 130);

  ctx.save();
  ctx.translate(90, (plot.top + plot.bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = "26px Helvetica, Arial, sans-serif";
  ctx.fillText("Strength – Solubles Concentration", 0, 0);
  ctx.font = "20px Helvetica, Arial, sans-serif";
  ctx.fillText("강도 – 수용성 성분의 농도", 0, 36);
  ctx.restore();

  ctx.font = "22px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Strong &", x(16.4), y(1.66));
  ctx.fillText("Underextracted", x(16.4), y(1.61));
  ctx.fillText("강함 & 과소추출", x(16.4), y(1.56));
  ctx.fillText("Strong &", x(23.5), y(1.66));
  ctx.fillText("Overextracted", x(23.5), y(1.61));
  ctx.fillText("강함 & 과다추출", x(23.5), y(1.56));
  ctx.fillText("Underextracted", x(16.5), y(1.36));
  ctx.fillText("과소추출", x(16.5), y(1.31));
  ctx.fillText("Overextracted", x(24.0), y(1.36));
  ctx.fillText("과다추출", x(24.0), y(1.31));
  ctx.fillText("Strong", x(20.0), y(1.66));
  ctx.fillText("강함", x(20.0), y(1.61));
  ctx.fillText("Ideal", x(20.0), y(1.28));
  ctx.fillText("이상적", x(20.0), y(1.23));
  ctx.fillText("Weak &", x(16.2), y(1.02));
  ctx.fillText("Underextracted", x(16.2), y(0.98));
  ctx.fillText("약함 & 과소추출", x(16.2), y(0.94));
  ctx.fillText("Weak", x(20.2), y(1.02));
  ctx.fillText("약함", x(20.2), y(0.98));
  ctx.fillText("Weak &", x(24.5), y(1.02));
  ctx.fillText("Overextracted", x(24.5), y(0.98));
  ctx.fillText("약함 & 과다추출", x(24.5), y(0.94));

  ctx.textAlign = "right";
  ctx.font = "18px Helvetica, Arial, sans-serif";
  ctx.fillStyle = "#888";
  ctx.fillText("Recreated high-resolution control chart for COFFEE ARCHIVE", W - 60, H - 70);

  if (state.currentPoint?.ey && state.currentPoint?.tds) {
    drawPoint(ctx, x, y, state.currentPoint.ey, state.currentPoint.tds, true);
    $("pointLabel").textContent = `EY ${fmt(state.currentPoint.ey)} / TDS ${fmt(state.currentPoint.tds)}`;
  } else {
    $("pointLabel").textContent = "-";
  }
}

function drawPoint(ctx, x, y, ey, tds, current) {
  const eyNum = Number(ey);
  const tdsNum = Number(tds);

  if (!Number.isFinite(eyNum) || !Number.isFinite(tdsNum)) return;
  if (eyNum < 14 || eyNum > 26 || tdsNum < 0.90 || tdsNum > 1.80) return;

  const px = x(eyNum);
  const py = y(tdsNum);

  ctx.save();

  const red = "#e33434";
  const radius = current ? 8 : 5;
  const cross = current ? 18 : 0;

  ctx.beginPath();
  ctx.fillStyle = red;
  ctx.strokeStyle = red;
  ctx.lineWidth = 2;
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fill();

  if (current) {
    ctx.strokeStyle = red;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px - cross, py); ctx.lineTo(px - radius - 3, py);
    ctx.moveTo(px + radius + 3, py); ctx.lineTo(px + cross, py);
    ctx.moveTo(px, py - cross); ctx.lineTo(px, py - radius - 3);
    ctx.moveTo(px, py + radius + 3); ctx.lineTo(px, py + cross);
    ctx.stroke();

    const label = `EY ${fmt(eyNum)} / TDS ${fmt(tdsNum)}`;
    ctx.font = "bold 20px Helvetica, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const labelX = px + 18;
    const labelY = py - 18;
    const metrics = ctx.measureText(label);
    const paddingX = 8;
    const boxW = metrics.width + paddingX * 2;
    const boxH = 28;
    const boxX = labelX - paddingX;
    const boxY = labelY - boxH / 2;

    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = red;
    ctx.fillText(label, labelX, labelY + 1);
  }

  ctx.restore();
}

async function addBrewing(e) {
  e.preventDefault();
  const dose = num($("brewDose").value);
  const beverage = num($("brewBeverage").value);
  const tds = num($("brewTds").value);
  const ey = num($("brewEyManual").value) || calcEY(dose, beverage, tds);
  const ratio = calcRatio(dose, beverage);

  const record = {
    owner: currentUser || "unknown",
    date: $("brewDate").value || today(),
    category: $("brewCategory").value,
    bean: clean($("brewBean").value) || "Untitled",
    title: clean($("brewTitle").value),
    dripper: clean($("brewDripper").value),
    filterPaper: clean($("brewFilterPaper").value),
    grinder: clean($("brewGrinder").value),
    grind: clean($("brewGrind").value),
    waterType: clean($("brewWaterType").value),
    temp: num($("brewTemp").value),
    dose,
    water: num($("brewWater").value),
    beverage,
    bloom: clean($("brewBloom").value),
    pour1: clean($("brewPour1").value),
    pour2: clean($("brewPour2").value),
    pour3: clean($("brewPour3").value),
    pour4: clean($("brewPour4").value),
    time: clean($("brewTime").value),
    tds, ey, ratio,
    ratioManual: clean($("brewRatioManual").value),
    etc: clean($("brewEtc").value),
    notes: clean($("brewNotes").value),
    source: "Variables",
    createdAt: new Date().toISOString()
  };

  try {
    const row = await saveRecord("brewing_records", record);
    state.brewing.unshift({ ...record, id: row.id, createdAt: row.created_at });
    e.target.reset(); setDateDefaults(); renderAll(); alert("저장했습니다.");
  } catch (error) {
    console.error(error);
    alert(`저장에 실패했습니다: ${error.message}`);
  }
}

async function addEspresso(e) {
  e.preventDefault();
  const dose = num($("espDose").value);
  const beverage = num($("espBeverage").value);
  const tds = num($("espTds").value);
  const ey = num($("espEyManual").value) || calcEY(dose, beverage, tds);
  const ratio = calcRatio(dose, beverage);

  const record = {
    owner: currentUser || "unknown",
    date: $("espDate").value || today(),
    category: $("espCategory").value,
    bean: clean($("espBean").value) || "Untitled",
    title: clean($("espTitle").value),
    machine: clean($("espMachine").value),
    grinder: clean($("espGrinder").value),
    grind: clean($("espGrind").value),
    basket: clean($("espBasket").value),
    dose,
    beverage,
    ratio,
    ratioManual: clean($("espRatioManual").value),
    time: clean($("espTime").value),
    preInfusion: clean($("espPreInfusion").value),
    rampUp: clean($("espRampUp").value),
    mainPressure: clean($("espMainPressure").value),
    rampDown: clean($("espRampDown").value),
    temp: num($("espTemp").value),
    tds, ey,
    etc: clean($("espEtc").value),
    notes: clean($("espNotes").value),
    source: "Variables",
    createdAt: new Date().toISOString()
  };

  try {
    const row = await saveRecord("espresso_records", record);
    state.espresso.unshift({ ...record, id: row.id, createdAt: row.created_at });
    e.target.reset(); setDateDefaults(); renderAll(); alert("저장했습니다.");
  } catch (error) {
    console.error(error);
    alert(`저장에 실패했습니다: ${error.message}`);
  }
}

function dataGrid(r, type) {
  const common = [
    ["카테고리", r.category], ["원두", r.bean], ["제목", r.title], ["출처", r.source],
    ["도징", r.dose ? `${fmt(r.dose, 1)}g` : "-"],
    ["추출액", r.beverage ? `${fmt(r.beverage, 1)}g` : "-"],
    ["TDS", r.tds ? `${fmt(r.tds)}%` : "-"],
    ["수율", r.ey ? `${fmt(r.ey)}%` : "-"],
    ["레시오", r.ratio ? `1:${fmt(r.ratio, 1)}` : (r.ratioManual || "-")],
    ["시간", r.time || "-"]
  ];

  const brewing = [
    ["드리퍼", r.dripper], ["필터", r.filterPaper], ["그라인더", r.grinder], ["분쇄도", r.grind],
    ["물", r.waterType], ["물 온도", r.temp ? `${fmt(r.temp, 1)}℃` : "-"],
    ["총 투입수", r.water ? `${fmt(r.water, 1)}g` : "-"],
    ["블룸", r.bloom], ["1차 투입", r.pour1], ["2차 투입", r.pour2], ["3차 투입", r.pour3], ["4차 투입", r.pour4],
    ["기타", r.etc]
  ];

  const espresso = [
    ["머신", r.machine], ["그라인더", r.grinder], ["분쇄도", r.grind], ["바스켓", r.basket],
    ["Pre-infusion", r.preInfusion], ["Ramp-up", r.rampUp], ["Main Pressure", r.mainPressure], ["Ramp-down", r.rampDown],
    ["물 온도", r.temp ? `${fmt(r.temp, 1)}℃` : "-"], ["기타", r.etc]
  ];

  const items = [...common, ...(type === "Brewing" ? brewing : espresso)];

  return `<div class="record-grid">${items.map(([label, value]) => `
    <div class="record-item"><span>${esc(label)}</span><strong>${esc(value || "-")}</strong></div>
  `).join("")}</div>`;
}

function recordCard(r, type) {
  return `<article class="record">
    <div class="record-head">
      <div>
        <h3>${esc(r.title || r.bean || "Untitled")}</h3>
        <p class="meta">${esc(r.date || "-")} · ${esc(type)} · ${esc(r.category || "-")}</p>
        <span class="owner-tag">작성자: ${esc(r.owner || "unknown")}</span>
      </div>
      <button type="button" class="secondary delete-record" data-type="${type.toLowerCase()}" data-id="${esc(r.id)}">삭제</button>
    </div>
    ${dataGrid(r, type)}
    <div class="record-section"><h4>메모</h4><p>${esc(r.notes || "-")}</p></div>
  </article>`;
}

function includesRecord(r, q) {
  if (!q) return true;
  return JSON.stringify(r).toLowerCase().includes(q.toLowerCase());
}

function renderBrewing() {
  const q = clean($("brewSearch").value).toLowerCase();
  const filter = $("brewFilter").value;
  const list = state.brewing.filter(r => {
    const categoryMatch = filter === "전체" || r.category === filter;
    return categoryMatch && includesRecord(r, q);
  });
  $("brewingRecords").innerHTML = list.length ? list.map(r => recordCard(r, "Brewing")).join("") : `<article class="record">기록이 없습니다.</article>`;
}

function renderEspresso() {
  const q = clean($("espSearch").value).toLowerCase();
  const filter = $("espFilter").value;
  const list = state.espresso.filter(r => {
    const categoryMatch = filter === "전체" || r.category === filter;
    return categoryMatch && includesRecord(r, q);
  });
  $("espressoRecords").innerHTML = list.length ? list.map(r => recordCard(r, "Espresso")).join("") : `<article class="record">기록이 없습니다.</article>`;
}

async function deleteRecord(type, id) {
  const key = String(type || "").toLowerCase();
  const tableName = key === "brewing" ? "brewing_records" : key === "espresso" ? "espresso_records" : null;
  if (!tableName) return;
  if (!confirm("삭제할까요?")) return;

  try {
    const sb = getSupabaseClient();
    const { error } = await sb.from(tableName).delete().eq("id", id);
    if (error) throw error;
    state[key] = state[key].filter(r => String(r.id) !== String(id));
    renderAll();
  } catch (error) {
    console.error(error);
    alert(`삭제에 실패했습니다: ${error.message}`);
  }
}

function renderAll() {
  renderBrewing(); renderEspresso(); drawChart();
}

function clearCalc() {
  $("calcForm").reset();
  state.currentPoint = null;
  $("eyResult").textContent = "-";
  $("ratioResult").textContent = "-";
  $("positionResult").textContent = "-";
  resetExtractionAdvice();
  drawChart();
}

function setAuthMode(mode) {
  authMode = mode;
  const isSignup = mode === "signup";
  $("loginModeBtn").classList.toggle("active", !isSignup);
  $("signupModeBtn").classList.toggle("active", isSignup);
  $("passwordConfirmWrap").hidden = !isSignup;
  if (!isSignup) $("passwordConfirmInput").value = "";
  $("authMessage").textContent = "";
  $("authHint").textContent = isSignup
    ? "회원가입은 닉네임, 비밀번호, 비밀번호 확인을 입력합니다."
    : "로그인은 닉네임 + 비밀번호만 입력합니다.";
  $("enterSite").textContent = isSignup ? "회원가입 후 입장" : "로그인";
}

function showAuthMessage(message) {
  $("authMessage").textContent = message;
}

async function initAuth() {
  setAuthMode("login");
  $("loginModeBtn").addEventListener("click", () => setAuthMode("login"));
  $("signupModeBtn").addEventListener("click", () => setAuthMode("signup"));
  $("enterSite").addEventListener("click", handleAuth);
  ["nicknameInput", "passwordInput", "passwordConfirmInput"].forEach(id => {
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleAuth();
    });
  });
  $("logoutBtn").addEventListener("click", logout);

  try {
    const sb = getSupabaseClient();
    const { data } = await sb.auth.getSession();
    const user = data?.session?.user;
    if (user) {
      currentAuthUser = user;
      currentUser = user.user_metadata?.nickname || "사용자";
      await showApp();
    }
  } catch (error) {
    console.error(error);
    showAuthMessage(error.message);
  }
}

async function handleAuth() {
  const nickname = clean($("nicknameInput").value);
  const password = clean($("passwordInput").value);
  const passwordConfirm = clean($("passwordConfirmInput").value);

  if (!nickname) {
    showAuthMessage("닉네임을 입력해주세요.");
    return;
  }
  if (!password) {
    showAuthMessage("비밀번호를 입력해주세요.");
    return;
  }
  if (authMode === "signup") {
    if (!passwordConfirm) {
      showAuthMessage("비밀번호 확인을 입력해주세요.");
      return;
    }
    if (password !== passwordConfirm) {
      showAuthMessage("비밀번호와 비밀번호 확인이 서로 다릅니다.");
      return;
    }
  }

  try {
    const sb = getSupabaseClient();
    const email = nicknameToEmail(nickname);

    if (authMode === "signup") {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { nickname } }
      });
      if (error) throw error;
      currentAuthUser = data.user;
      currentUser = nickname;
      await showApp();
      return;
    }

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentAuthUser = data.user;
    currentUser = data.user?.user_metadata?.nickname || nickname;
    await showApp();
  } catch (error) {
    console.error(error);
    const message = authMode === "signup"
      ? "회원가입에 실패했습니다. 이미 존재하는 닉네임이거나 Supabase 설정을 확인해야 합니다."
      : "로그인에 실패했습니다. 닉네임 또는 비밀번호를 확인해주세요.";
    showAuthMessage(`${message} (${error.message})`);
  }
}

async function showApp() {
  $("authScreen").hidden = true;
  $("authScreen").setAttribute("hidden", "");
  $("appShell").hidden = false;
  $("appShell").removeAttribute("hidden");
  // 닉네임 — 항상 텍스트가 보이도록 (button 요소이므로 color 별도 적용 불필요, CSS로 처리)
  $("currentNickname").textContent = currentUser ? `${currentUser}` : "";
  $("authMessage").textContent = "";

  // 나갔다 들어와도 프로필 사진 복원
  applyAvatarToHeader();

  try {
    await loadRecords();
    renderAll();
  } catch (error) {
    console.error(error);
    alert(`기록을 불러오지 못했습니다: ${error.message}`);
  }
}

async function logout() {
  try {
    const sb = getSupabaseClient();
    await sb.auth.signOut();
  } catch (error) {
    console.error(error);
  }
  currentAuthUser = null;
  currentUser = null;
  state = { brewing: [], espresso: [], currentPoint: null };
  $("appShell").hidden = true;
  $("appShell").setAttribute("hidden", "");
  $("authScreen").hidden = false;
  $("authScreen").removeAttribute("hidden");
  $("passwordInput").value = "";
  $("authMessage").textContent = "";
}

// =============================================
// PROFILE MODAL
// =============================================

const AVATAR_KEY = "coffee_archive_avatar";

function getAvatarDataUrl() {
  try { return localStorage.getItem(AVATAR_KEY) || null; } catch { return null; }
}

function saveAvatarDataUrl(dataUrl) {
  try { localStorage.setItem(AVATAR_KEY, dataUrl); } catch(e) { console.warn("아바타 저장 실패:", e); }
}

// 모달 내부 아바타 적용
function applyAvatarToModal(dataUrl) {
  const img = $("profileAvatarImg");
  const initial = $("profileAvatarInitial");
  if (!img || !initial) return;
  if (dataUrl) {
    img.src = dataUrl;
    img.hidden = false;
    initial.hidden = true;
  } else {
    img.hidden = true;
    initial.hidden = false;
    initial.textContent = (currentUser || "?").charAt(0).toUpperCase();
  }
}

// 헤더 닉네임 배지에 미니 아바타 반영 (텍스트는 항상 유지)
function applyAvatarToHeader() {
  // 닉네임 텍스트는 showApp()에서 이미 set되므로 여기선 건드리지 않음
  // 필요 시 배지 안에 작은 원형 이미지를 넣을 수도 있지만 현재는 텍스트만 유지
}

function renderProfileOverview() {
  const brewTotal = state.brewing.length;
  const espTotal  = state.espresso.length;
  const total     = brewTotal + espTotal;

  $("statTotal").textContent    = total;
  $("statBrewing").textContent  = brewTotal;
  $("statEspresso").textContent = espTotal;

  const categories = ["레시피 셋업", "변수 테스트", "테크니컬 테스트"];

  function renderCatBars(containerId, records) {
    const counts = categories.map(c => records.filter(r => r.category === c).length);
    const maxVal = Math.max(...counts, 1);
    $(containerId).innerHTML = categories.map((cat, i) => {
      const pct = Math.round((counts[i] / maxVal) * 100);
      return `<div class="cat-bar-row">
        <span class="cat-bar-label">${esc(cat)}</span>
        <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${pct}%"></div></div>
        <span class="cat-bar-count">${counts[i]}</span>
      </div>`;
    }).join("");
  }

  renderCatBars("overviewBrewingCats",  state.brewing);
  renderCatBars("overviewEspressoCats", state.espresso);

  // 최근 5개
  const recent = [
    ...state.brewing.map(r  => ({ ...r, _type: "Brewing"  })),
    ...state.espresso.map(r => ({ ...r, _type: "Espresso" }))
  ].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 5);

  $("overviewRecent").innerHTML = recent.length
    ? recent.map(r => `<div class="recent-item">
        <span class="recent-type-badge">${esc(r._type)}</span>
        <span class="recent-title">${esc(r.title || r.bean || "Untitled")}</span>
        <span class="recent-date">${esc((r.date || r.createdAt || "").slice(0, 10))}</span>
      </div>`).join("")
    : `<div class="recent-item"><span class="recent-title" style="color:#888">아직 아카이브가 없습니다.</span></div>`;
}

function renderProfileAccount() {
  const joined = (currentAuthUser?.created_at || "").slice(0, 10) || "-";
  $("accountNickname").textContent = currentUser || "-";
  $("accountEmail").textContent    = currentAuthUser?.email || "-";
  $("accountJoined").textContent   = joined;
  $("accountUid").textContent      = currentAuthUser?.id || "-";
}

function switchProfilePanel(panelId) {
  document.querySelectorAll(".profile-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".profile-nav-btn").forEach(b => b.classList.remove("active"));
  const key = panelId.charAt(0).toUpperCase() + panelId.slice(1);
  const panel = $(`profilePanel${key}`);
  if (panel) panel.classList.add("active");
  document.querySelectorAll(`.profile-nav-btn[data-panel="${panelId}"]`)
          .forEach(b => b.classList.add("active"));
  $("profilePanelTitle").textContent = { overview: "Overview", account: "Account" }[panelId] || panelId;
}

function openProfile() {
  const nickname = currentUser || "?";
  const joined   = (currentAuthUser?.created_at || "").slice(0, 10) || "-";

  $("profileSideNickname").textContent = nickname;
  $("profileSideJoined").textContent   = `joined ${joined}`;
  $("profileAvatarInitial").textContent = nickname.charAt(0).toUpperCase();

  // localStorage에서 아바타 복원 — 나갔다 들어와도 유지
  applyAvatarToModal(getAvatarDataUrl());

  renderProfileOverview();
  renderProfileAccount();
  switchProfilePanel("overview");

  $("profileModal").hidden = false;
  $("profileModal").removeAttribute("hidden");
  document.body.style.overflow = "hidden";
}

function closeProfile() {
  $("profileModal").hidden = true;
  $("profileModal").setAttribute("hidden", "");
  document.body.style.overflow = "";
}

function initProfileModal() {
  $("currentNickname").addEventListener("click", openProfile);
  $("profileCloseBtn").addEventListener("click", closeProfile);
  $("profileLogoutBtn").addEventListener("click", () => { closeProfile(); logout(); });
  $("profileDeleteBtn").addEventListener("click", () => { closeProfile(); deleteAccount(); });

  document.querySelectorAll(".profile-nav-btn").forEach(btn =>
    btn.addEventListener("click", () => switchProfilePanel(btn.dataset.panel))
  );

  // 아바타 업로드 → localStorage 저장 → 즉시 반영
  $("profileAvatarInput").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 5MB 초과 시 경고
    if (file.size > 5 * 1024 * 1024) {
      alert("5MB 이하의 이미지를 선택해주세요.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      saveAvatarDataUrl(dataUrl);   // localStorage 저장
      applyAvatarToModal(dataUrl);  // 모달 즉시 반영
    };
    reader.readAsDataURL(file);
  });

  // 배경 클릭으로 닫기
  $("profileModal").addEventListener("click", (e) => {
    if (e.target === $("profileModal")) closeProfile();
  });

  // ESC 닫기
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("profileModal").hidden) closeProfile();
  });
}

async function deleteAccount() {
  const confirmed = confirm(
    `\u26A0\uFE0F 회원탈퇴\n\n닉네임 "${currentUser}"의 계정과 모든 기록이 영구 삭제됩니다.\n\n계속하시겠습니까?`
  );
  if (!confirmed) return;

  const password = prompt("본인 확인을 위해 비밀번호를 입력해주세요.");
  if (password === null) return;
  if (!password) { alert("비밀번호를 입력해야 탈퇴할 수 있습니다."); return; }

  try {
    const sb = getSupabaseClient();
    const { error: signInError } = await sb.auth.signInWithPassword({
      email: nicknameToEmail(currentUser), password
    });
    if (signInError) { alert("비밀번호가 올바르지 않습니다. 탈퇴를 취소합니다."); return; }

    const userId = currentAuthUser?.id;
    if (userId) {
      await sb.from("brewing_records").delete().eq("user_id", userId);
      await sb.from("espresso_records").delete().eq("user_id", userId);
    }

    const { error: deleteError } = await sb.rpc("delete_user");
    if (deleteError) {
      console.warn("delete_user RPC 오류:", deleteError.message);
      alert("계정 삭제에 문제가 발생했습니다.\n\nSupabase SQL Editor에서 delete_user() 함수를 생성해주세요.\n지금은 로그아웃 처리됩니다.");
      await logout();
      return;
    }

    try { await sb.auth.signOut(); } catch (_) {}
    try { localStorage.removeItem(AVATAR_KEY); } catch (_) {}
    currentAuthUser = null;
    currentUser     = null;
    state = { brewing: [], espresso: [], currentPoint: null };
    $("appShell").hidden = true;
    $("appShell").setAttribute("hidden", "");
    $("authScreen").hidden = false;
    $("authScreen").removeAttribute("hidden");
    $("nicknameInput").value  = "";
    $("passwordInput").value  = "";
    $("authMessage").textContent = "";
    alert("탈퇴가 완료되었습니다. 이용해주셔서 감사합니다.");
  } catch (error) {
    console.error(error);
    alert(`탈퇴 중 오류가 발생했습니다: ${error.message}`);
  }
}

async function init() {
  setDateDefaults(); initTabs();
  resetExtractionAdvice();

  ["dose","beverage","tds"].forEach(id => {
    $(id).addEventListener("input", updateCalculator);
    $(id).addEventListener("change", updateCalculator);
  });

  $("calcForm").addEventListener("submit", (e) => { e.preventDefault(); updateCalculator(); });
  $("clearCalc").addEventListener("click", clearCalc);
  $("brewingForm").addEventListener("submit", addBrewing);
  $("espressoForm").addEventListener("submit", addEspresso);

  $("brewFilter").addEventListener("change", renderBrewing);
  $("brewSearch").addEventListener("input", renderBrewing);
  $("espFilter").addEventListener("change", renderEspresso);
  $("espSearch").addEventListener("input", renderEspresso);
  document.addEventListener("click", (e) => {
    const deleteBtn = e.target.closest(".delete-record");
    if (!deleteBtn) return;
    deleteRecord(deleteBtn.dataset.type, deleteBtn.dataset.id);
  });
  window.addEventListener("resize", drawChart);

  await initAuth();
  initProfileModal();
  drawChart();
}

document.addEventListener("DOMContentLoaded", init);

window.addEventListener("error", (event) => {
  console.error("COFFEE ARCHIVE ERROR:", event.message);
});
