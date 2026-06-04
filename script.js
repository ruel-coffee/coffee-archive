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

function determineAdviceMode(tds) {
  if (!tds || tds <= 0) return "brewing";
  return tds > 2.2 ? "espresso" : "brewing";
}

function strengthBand(tds, mode = "brewing") {
  if (!tds) return "none";
  if (mode === "espresso") {
    if (tds < 7) return "weak";
    if (tds > 12) return "strong";
    return "ideal";
  }
  if (tds < 1.15) return "weak";
  if (tds > 1.35) return "strong";
  return "ideal";
}

function extractionBand(ey) {
  if (!ey) return "none";
  if (ey < 18) return "low";
  if (ey > 22) return "high";
  return "ideal";
}

function bandLabel(strength, extraction, mode) {
  const strengthLabel = {
    weak: mode === "espresso" ? "낮은 농도" : "약함",
    ideal: mode === "espresso" ? "권장 농도권" : "권장 농도",
    strong: mode === "espresso" ? "높은 농도" : "강함",
    none: "-"
  }[strength];

  const extractionLabel = {
    low: "저수율",
    ideal: "권장 수율",
    high: "고수율",
    none: "-"
  }[extraction];

  const modeLabel = mode === "espresso" ? "Espresso" : "Brewing";
  return `${modeLabel} · ${strengthLabel} / ${extractionLabel}`;
}

function getExtractionAdvice(tds, ey, ratio) {
  if (!tds || !ey) {
    return {
      zone: "입력 대기",
      summary: "도징, 추출액, TDS를 입력하면 브루잉 컨트롤 차트와 에스프레소 해석 기준을 함께 참고해 다음 조정 방향을 제안합니다.",
      primary: "-",
      secondary: "-",
      test: "-",
      note: "브루잉은 차트 기준으로, 에스프레소는 같은 수율 개념을 참고하되 농도 범위가 다르기 때문에 별도로 해석합니다."
    };
  }

  const mode = determineAdviceMode(tds);
  const strength = strengthBand(tds, mode);
  const extraction = extractionBand(ey);
  const ratioText = ratio ? ` 현재 레시오는 약 1:${fmt(ratio, 1)}입니다.` : "";
  const key = `${strength}-${extraction}`;

  const brewingAdvice = {
    "weak-low": ["브루잉 기준으로 농도와 수율이 모두 낮습니다. 컵이 얇고 산미가 날카롭거나 중심이 비어 보일 수 있습니다.", "분쇄도를 조금 더 가늘게 조정하거나 물 온도를 1~2℃ 높입니다.", "푸어를 조금 더 적극적으로 하거나 접촉시간을 늘립니다.", "분쇄도만 한 단계 가늘게 바꾼 뒤 TDS와 수율이 함께 올라가는지 확인하세요."],
    "weak-ideal": ["브루잉 기준으로 수율은 권장 구간이지만 농도가 낮습니다. 추출 부족보다 레시피가 길어 희석된 상태일 가능성이 큽니다.", "총 투입수 또는 추출액을 줄여 레시오를 짧게 가져갑니다.", "같은 물 양을 유지하고 싶다면 도징을 소폭 늘려 농도를 올립니다.", "물 양을 10~15g 줄이거나 도징을 0.5~1g 늘려 농도 변화를 비교하세요."],
    "weak-high": ["브루잉 기준으로 많이 녹였지만 농도는 낮습니다. 긴 레시오로 인해 후반부 성분까지 끌고 오면서 컵이 묽어졌을 가능성이 있습니다.", "추출액을 줄이고 레시오를 짧게 잡아 후반부 추출을 줄입니다.", "후반 푸어의 교반을 줄이거나 물 온도를 약간 낮춥니다.", "총 추출량을 10~20g 줄이고 후미가 깨끗해지는지 확인하세요."],
    "ideal-low": ["브루잉 기준으로 농도는 적정하지만 수율이 낮습니다. 진하기는 있으나 단맛과 복합성이 덜 열렸을 수 있습니다.", "분쇄도를 조금 더 가늘게 하거나 접촉시간을 늘려 수율을 올립니다.", "물 온도를 1℃ 정도 높이거나 초반 푸어에서 균일한 포화를 확보합니다.", "레시오는 유지하고 분쇄도만 가늘게 바꿔 수율이 18% 이상으로 올라가는지 보세요."],
    "ideal-ideal": ["브루잉 컨트롤 차트 기준으로 균형 구간에 있습니다. 수치상으로는 현재 레시피를 기준점으로 삼기 좋습니다.", "현재 레시피를 기준 레시피로 저장하고 관능 목적에 따라 미세 조정합니다.", "더 선명하게는 분쇄를 약간 굵게, 더 단맛 쪽으로는 분쇄를 약간 가늘게 테스트합니다.", "한 번은 현재 레시피를 반복 추출해 재현성을 확인한 뒤 한 변수만 바꿔 비교하세요."],
    "ideal-high": ["브루잉 기준으로 농도는 좋지만 수율이 높습니다. 컵에 쓴맛, 건조감, 후미의 거친 질감이 있는지 확인이 필요합니다.", "분쇄도를 조금 더 굵게 하거나 총 추출 시간을 줄입니다.", "후반부 교반과 물 온도를 낮춰 과다 추출 성향을 줄입니다.", "분쇄도만 굵게 바꿔 수율이 22% 아래로 내려오면서 단맛이 유지되는지 확인하세요."],
    "strong-low": ["브루잉 기준으로 농도는 높지만 수율은 낮습니다. 진하지만 충분히 열리지 않았거나 국소적으로만 추출된 상태일 수 있습니다.", "레시오를 조금 길게 하거나 추출액을 늘려 수율을 확보합니다.", "흐름이 막히는 느낌이면 분쇄를 아주 약간 굵게 하고 푸어를 균일하게 가져갑니다.", "추출액을 10g 늘려 수율이 오르는지 보고 텁텁함이 있으면 분쇄를 소폭 굵게 조정하세요."],
    "strong-ideal": ["브루잉 기준으로 수율은 적정하지만 농도가 높습니다. 구조감 있는 컵이지만 마시기 무겁거나 답답할 수 있습니다.", "더 편안한 컵을 원하면 총 투입수 또는 추출액을 소폭 늘려 농도를 낮춥니다.", "현재 강도를 유지하려면 기준 레시피로 저장하고 향미 선명도만 미세 조정합니다.", "물 양을 10g 늘린 컵과 현재 컵을 비교해 농도감과 향미 선명도를 체크하세요."],
    "strong-high": ["브루잉 기준으로 농도와 수율이 모두 높습니다. 강하고 무거우며 쓴맛, 건조감, 떫은 질감이 동반될 수 있습니다.", "분쇄도를 굵게 하고 추출 시간을 줄여 과다 추출을 완화합니다.", "물 온도를 낮추거나 후반부 푸어 교반을 줄입니다.", "분쇄도만 굵게 바꾼 컵과 물 온도만 낮춘 컵을 분리해서 비교하세요."]
  };

  const espressoAdvice = {
    "weak-low": ["에스프레소 기준으로 농도와 수율이 모두 낮습니다. 바디가 약하고 산미가 비어 보일 수 있으며, 수프샷처럼 의도한 저농도 추출인지 먼저 확인해야 합니다.", "일반 에스프레소 방향이면 분쇄를 가늘게 하거나 도징을 늘려 저항과 농도를 올립니다.", "저압·긴 레시오 추출이라면 추출량을 줄이거나 피크 이후의 희석 구간을 줄입니다.", "추출 목적을 먼저 정하고, 일반 에스프레소는 분쇄도, 저농도 에스프레소는 추출량을 우선 조정하세요."],
    "weak-ideal": ["에스프레소 기준으로 수율은 확보됐지만 농도는 낮습니다. 추출 자체보다 레시오가 길거나 희석된 성격이 강할 수 있습니다.", "추출량을 줄여 레시오를 짧게 잡거나 도징을 소폭 늘립니다.", "향미가 선명하다면 저농도 에스프레소로 유지할 수 있고, 바디가 부족하면 농도만 올립니다.", "동일 분쇄에서 추출량만 줄인 컵을 비교해 농도와 밸런스를 확인하세요."],
    "weak-high": ["에스프레소 기준으로 수율은 높지만 농도는 낮습니다. 긴 레시오로 후반부 성분까지 많이 끌고 온 상태일 수 있습니다.", "추출량을 줄여 후반부 희석과 과다 추출 성향을 낮춥니다.", "쓴맛이나 건조감이 있으면 분쇄를 바꾸기보다 먼저 추출 종료 지점을 앞당깁니다.", "같은 세팅에서 추출량만 5~10g 줄여 후미가 깨끗해지는지 보세요."],
    "ideal-low": ["에스프레소 기준으로 농도는 유지되지만 수율이 낮습니다. 강도는 있으나 단맛과 향미 전개가 부족할 수 있습니다.", "분쇄를 조금 더 가늘게 하거나 추출 시간을 늘려 수율을 올립니다.", "채널링이 의심되면 분쇄보다 도징, 분배, 탬핑, 헤드스페이스를 먼저 점검합니다.", "분쇄도 조정 전후의 추출 흐름과 크레마, 후미 단맛을 함께 비교하세요."],
    "ideal-ideal": ["에스프레소 기준으로도 수율과 농도 균형이 좋은 기준점입니다. 현재 레시피를 기준으로 관능 목적에 맞춰 세부 조정하기 좋습니다.", "현재 레시피를 기준으로 저장하고 맛의 방향에 따라 레시오 또는 분쇄를 미세 조정합니다.", "더 선명하게는 추출량 소폭 증가, 더 묵직하게는 추출량 소폭 감소를 테스트합니다.", "동일 레시피를 반복 추출해 재현성을 먼저 확인하세요."],
    "ideal-high": ["에스프레소 기준으로 농도는 적정하지만 수율이 높습니다. 쓴맛, 건조감, 후미의 거친 질감이 있는지 확인이 필요합니다.", "추출량을 줄이거나 분쇄를 약간 굵게 하여 수율을 낮춥니다.", "고압 추출에서는 퍽 압축과 미분 이동이 영향을 줄 수 있어 도징과 헤드스페이스도 함께 봅니다.", "추출량을 먼저 줄이고, 그래도 거칠면 분쇄와 도징을 따로 비교하세요."],
    "strong-low": ["에스프레소 기준으로 농도는 높지만 수율은 낮습니다. 매우 진하지만 충분히 열리지 않아 산미가 날카롭거나 단맛이 부족할 수 있습니다.", "레시오를 조금 길게 하거나 추출 시간을 늘려 수율을 확보합니다.", "흐름이 너무 느리다면 분쇄를 아주 약간 굵게 하여 균일성을 확보합니다.", "추출량을 소폭 늘린 컵과 분쇄를 소폭 굵게 한 컵을 나눠 비교하세요."],
    "strong-ideal": ["에스프레소 기준으로 수율은 좋고 농도는 높은 편입니다. 진한 구조감이 장점이지만 마시기 무겁다면 레시오 조정이 필요합니다.", "더 편안한 컵을 원하면 추출량을 소폭 늘려 농도를 낮춥니다.", "강한 바디를 의도했다면 유지하고, 후미가 답답하면 분쇄를 아주 약간 굵게 봅니다.", "현재 컵을 기준으로 추출량만 2~5g 늘려 농도와 단맛 변화를 확인하세요."],
    "strong-high": ["에스프레소 기준으로 농도와 수율이 모두 높습니다. 강도, 쓴맛, 건조감, 텁텁함이 같이 올라올 가능성이 큽니다.", "분쇄를 굵게 하거나 추출량을 줄여 과다 추출 성향을 낮춥니다.", "고압 추출에서는 압력 상승, 퍽 압축, 미분 이동도 함께 점검합니다.", "분쇄도와 추출량을 동시에 바꾸지 말고 먼저 추출량을 줄인 뒤 분쇄를 조정하세요."]
  };

  const selected = (mode === "espresso" ? espressoAdvice : brewingAdvice)[key] || brewingAdvice["ideal-ideal"];
  return {
    zone: bandLabel(strength, extraction, mode),
    summary: `${selected[0]}${ratioText}`,
    primary: selected[1],
    secondary: selected[2],
    test: selected[3],
    note: mode === "espresso"
      ? "에스프레소는 브루잉 컨트롤 차트의 농도 범위와 다르므로, 차트 위치는 수율 개념 참고용으로 보고 실제 조정은 레시오·분쇄·도징·압력·헤드스페이스를 함께 확인하세요."
      : "브루잉은 차트 위치를 기준으로 보되, 원두·로스팅·드리퍼·물 조건에 따라 권장 구간 밖에서도 좋은 컵이 나올 수 있습니다."
  };
}

function updateExtractionAdvice(tds, ey, ratio) {
  const advice = getExtractionAdvice(tds, ey, ratio);
  const zone = $("adviceZone");
  const summary = $("adviceSummary");
  const primary = $("advicePrimary");
  const secondary = $("adviceSecondary");
  const test = $("adviceTest");
  const note = $("adviceNote");

  if (zone) zone.textContent = advice.zone;
  if (summary) summary.textContent = advice.summary;
  if (primary) primary.textContent = advice.primary;
  if (secondary) secondary.textContent = advice.secondary;
  if (test) test.textContent = advice.test;
  if (note) note.textContent = advice.note;
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
  updateExtractionAdvice(tds, ey, ratio);

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
  ctx.fillText("Strong", x(20.0), y(1.66));
  ctx.fillText("강함", x(20.0), y(1.61));
  ctx.fillText("Underextracted", x(16.5), y(1.36));
  ctx.fillText("과소추출", x(16.5), y(1.31));
  ctx.fillText("Overextracted", x(24.0), y(1.36));
  ctx.fillText("과다추출", x(24.0), y(1.31));
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
