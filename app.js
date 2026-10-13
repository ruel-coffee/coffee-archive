const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const storage = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The prototype remains usable when storage is unavailable.
    }
  },
};

const formatTime = (seconds) => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
};

const escapeHTML = (value = "") =>
  String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);

const toast = (message) => {
  const element = $("[data-toast]");
  if (!element) return;
  element.textContent = message;
  element.classList.add("is-visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("is-visible"), 2600);
};

// ——— Ambient interface ———
const header = $("[data-header]");
const progressBar = $(".page-progress span");
const updateScrollUI = () => {
  header?.classList.toggle("is-scrolled", window.scrollY > 40);
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (progressBar) progressBar.style.width = `${max > 0 ? (window.scrollY / max) * 100 : 0}%`;
};
window.addEventListener("scroll", updateScrollUI, { passive: true });
updateScrollUI();

const clock = $("[data-clock]");
const updateClock = () => {
  if (!clock) return;
  const time = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  clock.textContent = `SEO ${time}`;
};
updateClock();
setInterval(updateClock, 30000);

const cursor = $(".cursor");
if (cursor && matchMedia("(pointer:fine)").matches) {
  window.addEventListener("pointermove", (event) => {
    cursor.animate(
      { left: `${event.clientX}px`, top: `${event.clientY}px` },
      { duration: 260, fill: "forwards", easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  });
  $$("a, button, input, textarea, .recipe-card").forEach((element) => {
    element.addEventListener("pointerenter", () => cursor.classList.add("is-hover"));
    element.addEventListener("pointerleave", () => cursor.classList.remove("is-hover"));
  });
}

if (matchMedia("(pointer:fine)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  $$(".magnetic").forEach((element) => {
    element.addEventListener("pointermove", (event) => {
      const box = element.getBoundingClientRect();
      const x = (event.clientX - box.left - box.width / 2) * 0.16;
      const y = (event.clientY - box.top - box.height / 2) * 0.16;
      element.style.transform = `translate(${x}px, ${y}px)`;
    });
    element.addEventListener("pointerleave", () => { element.style.transform = ""; });
  });
}

const revealObserver = new IntersectionObserver(
  (entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    }
  }),
  { threshold: 0.12 },
);
$$('.reveal').forEach((element) => revealObserver.observe(element));

const menuButton = $("[data-menu-button]");
const menuOverlay = $("[data-menu-overlay]");
const setMenu = (open) => {
  document.body.classList.toggle("menu-open", open);
  menuOverlay?.classList.toggle("is-open", open);
  menuOverlay?.setAttribute("aria-hidden", String(!open));
  menuButton?.setAttribute("aria-expanded", String(open));
};
menuButton?.addEventListener("click", () => setMenu(!document.body.classList.contains("menu-open")));
$$('a[href^="#"]', menuOverlay).forEach((link) => link.addEventListener("click", () => setMenu(false)));

// ——— Replaceable hero motion reel ———
const media = [
  {
    id: "123zLI3JoRQ",
    title: "World Champion Recipe",
    label: "TETSU KASUYA / RECIPE",
  },
  {
    id: "TfSBzFeoL4s",
    title: "Rapidly Cooled Iced Coffee",
    label: "TETSU KASUYA / ICED",
  },
  {
    id: "AI4ynXzkSQo",
    title: "The Ultimate V60 Technique",
    label: "JAMES HOFFMANN / V60",
  },
];
let activeMediaIndex = 0;
const renderMedia = (index) => {
  activeMediaIndex = index;
  const item = media[index];
  const frame = $("[data-media-frame]");
  const link = $("[data-media-link]");
  const title = $("[data-media-title]");
  const count = $("[data-media-count]");
  if (frame) {
    frame.src = `https://www.youtube-nocookie.com/embed/${item.id}?autoplay=1&mute=1&controls=0&loop=1&playlist=${item.id}&modestbranding=1&playsinline=1&rel=0`;
    frame.title = item.title;
  }
  if (link) link.href = `https://www.youtube.com/watch?v=${item.id}`;
  if (title) title.textContent = item.title;
  if (count) count.textContent = `${String(index + 1).padStart(2, "0")} / ${String(media.length).padStart(2, "0")}`;
  $$('[data-media-index]').forEach((button) => button.classList.toggle("is-active", Number(button.dataset.mediaIndex) === index));
};
$$('[data-media-index]').forEach((button) => button.addEventListener("click", () => renderMedia(Number(button.dataset.mediaIndex))));

// ——— Guided brew timer ———
const recipes = {
  "46": {
    title: "4:6 Method",
    maker: "Tetsu Kasuya",
    dose: "20g",
    water: "300g",
    temp: "93°C",
    total: 210,
    steps: [
      { at: 0, label: "첫 번째 푸어", detail: "중앙부터 천천히", target: "60g" },
      { at: 45, label: "두 번째 푸어", detail: "단맛 밸런스", target: "120g" },
      { at: 90, label: "세 번째 푸어", detail: "원을 그리며", target: "180g" },
      { at: 135, label: "네 번째 푸어", detail: "수위를 유지", target: "240g" },
      { at: 180, label: "마지막 푸어", detail: "드로다운", target: "300g" },
    ],
  },
  onecup: {
    title: "One Cup V60",
    maker: "James Hoffmann",
    dose: "15g",
    water: "250g",
    temp: "100°C",
    total: 180,
    steps: [
      { at: 0, label: "블루밍", detail: "가볍게 스월", target: "50g" },
      { at: 45, label: "메인 푸어 1", detail: "빠르고 고르게", target: "100g" },
      { at: 70, label: "메인 푸어 2", detail: "수위를 유지", target: "150g" },
      { at: 95, label: "메인 푸어 3", detail: "가장자리까지", target: "200g" },
      { at: 120, label: "마지막 푸어", detail: "부드럽게 스월", target: "250g" },
    ],
  },
  april: {
    title: "Three Pour",
    maker: "April",
    dose: "12g",
    water: "200g",
    temp: "92°C",
    total: 150,
    steps: [
      { at: 0, label: "첫 번째 푸어", detail: "원형 푸어", target: "60g" },
      { at: 35, label: "두 번째 푸어", detail: "중앙 푸어", target: "120g" },
      { at: 75, label: "마지막 푸어", detail: "원형 후 중앙", target: "200g" },
      { at: 120, label: "드로다운", detail: "베드를 확인", target: "—" },
    ],
  },
};

const brewDialog = $("[data-brew-dialog]");
const timer = {
  recipeKey: "46",
  elapsed: 0,
  playing: false,
  sound: true,
  startedAt: 0,
  raf: null,
  stepIndex: 0,
  lastAnnouncedStep: -1,
};

const announceStep = () => {
  if (!timer.sound) return;
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.24);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.25);
  } catch {
    // Audio is an enhancement and may be unavailable in some browsers.
  }
  navigator.vibrate?.([80, 40, 80]);
};

const renderTimerRecipe = () => {
  const recipe = recipes[timer.recipeKey];
  $("[data-dialog-recipe]").textContent = recipe.title.toUpperCase();
  $("[data-recipe-summary]").innerHTML = [
    ["DOSE", recipe.dose],
    ["WATER", recipe.water],
    ["TEMP", recipe.temp],
    ["TARGET", formatTime(recipe.total)],
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
  $("[data-brew-steps]").innerHTML = recipe.steps.map((step, index) => `
    <li class="brew-step" data-step-index="${index}">
      <time>${formatTime(step.at)}</time>
      <div><strong>${escapeHTML(step.label)}</strong><small>${escapeHTML(step.detail)}</small></div>
      <span>${escapeHTML(step.target)}</span>
    </li>
  `).join("");
  updateTimerUI();
};

const updateTimerUI = () => {
  const recipe = recipes[timer.recipeKey];
  let stepIndex = 0;
  recipe.steps.forEach((step, index) => { if (timer.elapsed >= step.at) stepIndex = index; });
  timer.stepIndex = stepIndex;
  const step = recipe.steps[stepIndex];
  const finished = timer.elapsed >= recipe.total;
  const mainTimer = $("[data-main-timer]");
  if (mainTimer) mainTimer.textContent = formatTime(Math.min(timer.elapsed, recipe.total));
  $("[data-step-label]").textContent = finished ? "BREW COMPLETE" : `STEP ${String(stepIndex + 1).padStart(2, "0")} / ${String(recipe.steps.length).padStart(2, "0")}`;
  $("[data-timer-state]").textContent = finished ? "DONE" : timer.playing ? "BREWING" : timer.elapsed > 0 ? "PAUSED" : "READY";
  $("[data-command-label]").textContent = finished ? "COMPLETE" : step.label.toUpperCase();
  $("[data-command-value]").textContent = finished ? "추출 기록을 남겨보세요" : `${step.target} · ${step.detail}`;
  $("[data-progress-bar]").style.width = `${Math.min(100, (timer.elapsed / recipe.total) * 100)}%`;
  $("[data-timer-toggle]").textContent = timer.playing ? "PAUSE" : finished ? "RESTART" : "START";
  $("[data-save-after-brew]").disabled = !finished;
  $$('[data-step-index]').forEach((element, index) => {
    element.classList.toggle("is-current", index === stepIndex && !finished);
    element.classList.toggle("is-done", finished || index < stepIndex);
  });
  if (timer.playing && stepIndex !== timer.lastAnnouncedStep) {
    timer.lastAnnouncedStep = stepIndex;
    announceStep();
  }
  if (finished && timer.playing) {
    timer.playing = false;
    cancelAnimationFrame(timer.raf);
    announceStep();
  }
};

const tick = (now) => {
  if (!timer.playing) return;
  timer.elapsed = (now - timer.startedAt) / 1000;
  updateTimerUI();
  if (timer.playing) timer.raf = requestAnimationFrame(tick);
};

const toggleTimer = () => {
  const recipe = recipes[timer.recipeKey];
  if (timer.elapsed >= recipe.total) resetTimer();
  timer.playing = !timer.playing;
  if (timer.playing) {
    timer.startedAt = performance.now() - timer.elapsed * 1000;
    timer.raf = requestAnimationFrame(tick);
  } else {
    cancelAnimationFrame(timer.raf);
  }
  updateTimerUI();
};

const resetTimer = () => {
  timer.playing = false;
  timer.elapsed = 0;
  timer.stepIndex = 0;
  timer.lastAnnouncedStep = -1;
  cancelAnimationFrame(timer.raf);
  updateTimerUI();
};

const openBrewDialog = (recipeKey = "46") => {
  timer.recipeKey = recipes[recipeKey] ? recipeKey : "46";
  resetTimer();
  renderTimerRecipe();
  brewDialog?.showModal();
  document.body.style.overflow = "hidden";
};

$$('[data-start-brew]').forEach((button) => button.addEventListener("click", () => openBrewDialog("46")));
$$('[data-open-recipe]').forEach((button) => button.addEventListener("click", () => openBrewDialog(button.dataset.openRecipe)));
$("[data-close-dialog]")?.addEventListener("click", () => brewDialog.close());
brewDialog?.addEventListener("close", () => {
  timer.playing = false;
  cancelAnimationFrame(timer.raf);
  document.body.style.overflow = "";
});
$("[data-timer-toggle]")?.addEventListener("click", toggleTimer);
$("[data-timer-reset]")?.addEventListener("click", resetTimer);
$("[data-timer-sound]")?.addEventListener("click", (event) => {
  timer.sound = !timer.sound;
  event.currentTarget.textContent = timer.sound ? "SOUND ON" : "SOUND OFF";
  event.currentTarget.setAttribute("aria-pressed", String(timer.sound));
});
$("[data-save-after-brew]")?.addEventListener("click", () => {
  brewDialog.close();
  $("#lab")?.scrollIntoView({ behavior: "smooth" });
  setTimeout(() => $("#brew-notes")?.focus(), 650);
});

// ——— Custom brew fields ———
const defaultFields = [
  { id: "beans", label: "원두", placeholder: "Ethiopia Benti Nenka", active: true },
  { id: "roast", label: "로스터 / 배전일", placeholder: "Mono · D+11", active: true },
  { id: "water", label: "물", placeholder: "GH 60 · KH 25", active: true },
  { id: "equipment", label: "장비", placeholder: "V60 02 · Kettle", active: true },
  { id: "grind", label: "분쇄도", placeholder: "Comandante 24 clicks", active: true },
  { id: "ratio", label: "원두 : 물", placeholder: "15g : 250g", active: true },
  { id: "weather", label: "날씨", placeholder: "18°C · 58% · 맑음", active: true },
  { id: "degassing", label: "디게싱", placeholder: "11일", active: true },
  { id: "agitation", label: "교반", placeholder: "Bloom swirl 2x", active: false },
  { id: "flow", label: "유속", placeholder: "4.2g/s", active: false },
  { id: "tds", label: "TDS", placeholder: "1.38%", active: false },
  { id: "yield", label: "수율", placeholder: "20.1%", active: false },
];
let fields = storage.get("dialin-fields", defaultFields);
const fieldValues = storage.get("dialin-field-values", {});

const renderFields = () => {
  const chips = $("[data-field-chips]");
  const dynamicFields = $("[data-dynamic-fields]");
  if (!chips || !dynamicFields) return;
  chips.innerHTML = fields.map((field) => `
    <button class="field-chip ${field.active ? "is-active" : ""}" type="button" data-field-id="${escapeHTML(field.id)}" aria-pressed="${field.active}">
      ${escapeHTML(field.label)}
    </button>
  `).join("");
  const active = fields.filter((field) => field.active);
  dynamicFields.innerHTML = active.map((field) => `
    <div class="record-field">
      <label for="field-${escapeHTML(field.id)}">${escapeHTML(field.label).toUpperCase()}</label>
      <input id="field-${escapeHTML(field.id)}" name="${escapeHTML(field.id)}" value="${escapeHTML(fieldValues[field.id] || "")}" placeholder="${escapeHTML(field.placeholder)}" />
    </div>
  `).join("");
  const count = $("[data-field-count]");
  if (count) count.textContent = `${String(active.length).padStart(2, "0")} FIELDS ACTIVE`;
  $$('[data-field-id]', chips).forEach((button) => button.addEventListener("click", () => {
    const field = fields.find((item) => item.id === button.dataset.fieldId);
    if (!field) return;
    if (fields.filter((item) => item.active).length === 1 && field.active) {
      toast("기록 항목은 하나 이상 남겨주세요.");
      return;
    }
    field.active = !field.active;
    storage.set("dialin-fields", fields);
    renderFields();
  }));
};
renderFields();

$("[data-add-field-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("input", event.currentTarget);
  const label = input.value.trim();
  if (!label) return;
  if (fields.some((field) => field.label.toLowerCase() === label.toLowerCase())) {
    toast("이미 있는 항목입니다.");
    return;
  }
  fields.push({ id: `custom-${Date.now()}`, label, placeholder: `${label} 입력`, active: true });
  storage.set("dialin-fields", fields);
  input.value = "";
  renderFields();
  toast(`‘${label}’ 항목을 추가했습니다.`);
});

// ——— Brew archive ———
const seedBrews = [
  { id: 3, date: "OCT 13 · 09:42", bean: "ETHIOPIA BENTI NENKA", origin: "GUJI · WASHED", method: "V60 · 4:6 METHOD", detail: "20:300 · 93°C · 03:28", score: "4.6", demo: true },
  { id: 2, date: "OCT 11 · 15:18", bean: "KENYA GICHATHAINI", origin: "NYERI · WASHED", method: "OREA · THREE POUR", detail: "15:250 · 92°C · 02:41", score: "4.4", demo: true },
  { id: 1, date: "OCT 08 · 08:06", bean: "COLOMBIA EL DIVISO", origin: "HUILA · NATURAL", method: "V60 · ONE CUP", detail: "15:250 · 96°C · 03:05", score: "4.8", demo: true },
];
let brews = storage.get("dialin-brews", seedBrews);

const renderArchive = () => {
  const list = $("[data-archive-list]");
  if (!list) return;
  if (!brews.length) {
    list.innerHTML = '<p class="archive-empty">아직 기록이 없습니다. 첫 추출을 남겨보세요.</p>';
    return;
  }
  list.innerHTML = brews.map((brew) => `
    <article class="archive-row">
      <div class="archive-date">${escapeHTML(brew.date)}${brew.demo ? " · DEMO" : ""}</div>
      <div class="archive-bean"><strong>${escapeHTML(brew.bean)}</strong><span>${escapeHTML(brew.origin || "PERSONAL BREW")}</span></div>
      <div class="archive-method"><strong>${escapeHTML(brew.method)}</strong><span>${escapeHTML(brew.detail)}</span></div>
      <div class="archive-score">${escapeHTML(brew.score)}</div>
      <button class="archive-open" type="button" aria-label="${escapeHTML(brew.bean)} 기록 열기" data-archive-open="${brew.id}">↗</button>
    </article>
  `).join("");
  $$('[data-archive-open]', list).forEach((button) => button.addEventListener("click", () => {
    const brew = brews.find((item) => String(item.id) === button.dataset.archiveOpen);
    toast(`${brew.bean} · ${brew.method}`);
  }));
};
renderArchive();

$("[data-brew-form]")?.addEventListener("input", (event) => {
  if (!event.target.name || event.target.name === "notes") return;
  fieldValues[event.target.name] = event.target.value;
  storage.set("dialin-field-values", fieldValues);
});

$("[data-brew-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const now = new Date();
  const bean = formData.get("beans") || "MY DAILY BREW";
  const method = formData.get("equipment") || "CUSTOM RECIPE";
  const ratio = formData.get("ratio") || "RATIO NOTED";
  const weather = formData.get("weather") || "CONDITION SAVED";
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(now).toUpperCase();
  const brew = {
    id: Date.now(),
    date,
    bean: String(bean).toUpperCase(),
    origin: String(formData.get("roast") || "PERSONAL BREW").toUpperCase(),
    method: String(method).toUpperCase(),
    detail: `${ratio} · ${weather}`,
    score: "4.6",
    notes: formData.get("notes") || "",
  };
  brews = [brew, ...brews];
  storage.set("dialin-brews", brews);
  renderArchive();
  event.currentTarget.reset();
  Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);
  storage.set("dialin-field-values", fieldValues);
  toast("추출 기록을 아카이브에 저장했습니다.");
  setTimeout(() => $("#archive")?.scrollIntoView({ behavior: "smooth" }), 500);
});

$("[data-export]")?.addEventListener("click", () => {
  const content = JSON.stringify({ exportedAt: new Date().toISOString(), brews }, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `dial-in-brews-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast("추출 기록을 JSON으로 내보냈습니다.");
});

// ——— Community ———
$$('[data-like]').forEach((button) => button.addEventListener("click", () => {
  const liked = button.classList.toggle("is-liked");
  const count = $("span", button);
  count.textContent = Number(count.textContent) + (liked ? 1 : -1);
  button.firstChild.textContent = liked ? "♥ " : "♡ ";
}));
$$('[data-discuss]').forEach((button) => button.addEventListener("click", () => toast("토론 상세 화면은 다음 버전에서 연결됩니다.")));
$$('[data-share]').forEach((button) => button.addEventListener("click", async () => {
  const post = button.closest(".community-post");
  const title = $("h3", post)?.textContent || "DIAL IN brew note";
  try {
    if (navigator.share) await navigator.share({ title, text: title, url: location.href });
    else {
      await navigator.clipboard.writeText(location.href);
      toast("커뮤니티 링크를 복사했습니다.");
    }
  } catch {
    // Share cancellation needs no feedback.
  }
}));

const postDialog = $("[data-post-dialog]");
$("[data-new-post]")?.addEventListener("click", () => postDialog?.showModal());
$("[data-close-post]")?.addEventListener("click", () => postDialog?.close());
$("[data-post-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const article = document.createElement("article");
  article.className = "community-post is-visible";
  article.innerHTML = `
    <div class="post-meta"><span class="avatar">ME</span><div><strong>my.brew.log</strong><small>방금 · 나의 기록</small></div><span class="mono"># ${escapeHTML(String(data.get("tag") || "BREW").toUpperCase())}</span></div>
    <h3>${escapeHTML(data.get("title"))}</h3>
    <p>${escapeHTML(data.get("body"))}</p>
    <div class="post-brew"><span>PERSONAL BREW NOTE</span><span>FROM MY ARCHIVE</span><strong>${escapeHTML(data.get("score"))}</strong></div>
    <div class="post-actions"><button type="button">♡ <span>0</span></button><button type="button">DISCUSS 00</button><button type="button">SHARE ↗</button></div>
  `;
  $("[data-community-feed]")?.prepend(article);
  postDialog.close();
  event.currentTarget.reset();
  toast("새 이야기를 커뮤니티에 올렸습니다.");
});

// The numbers are illustrative in this prototype; animate only to establish rhythm.
const brewCount = $("[data-brew-count]");
if (brewCount && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  let frame = 0;
  const start = 2384;
  const end = 2481;
  const animateCount = () => {
    frame += 1;
    brewCount.textContent = Math.round(start + (end - start) * Math.min(1, frame / 80)).toLocaleString();
    if (frame < 80) requestAnimationFrame(animateCount);
  };
  animateCount();
}
