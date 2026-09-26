const COUNTRY_OPTIONS = [
  "Japan",
  "Taiwan",
  "Singapore",
  "Thailand",
  "Hong Kong",
  "South Korea"
];

const EVENT_NAME_PRESETS = [
  "Public Garden",
  "Connect Asia",
  "好好",
  "森之市"
];

function text(value) {
  return String(value ?? "").trim();
}

function normalizedKey(value) {
  return text(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[\s._-]+/g, "");
}

function canonicalCountry(value) {
  const raw = text(value);
  const key = normalizedKey(raw);

  if (["japan", "jp", "日本", "日本国"].includes(key)) return "Japan";
  if (["taiwan", "tw", "台湾", "台灣"].includes(key)) return "Taiwan";
  if (["singapore", "sg", "シンガポール", "新加坡"].includes(key)) return "Singapore";
  if (["thailand", "th", "タイ", "泰国", "泰國"].includes(key)) return "Thailand";
  if (["hongkong", "hk", "香港"].includes(key)) return "Hong Kong";
  if (["southkorea", "korea", "kr", "韓国", "韓國", "대한민국", "한국"].includes(key)) return "South Korea";

  return "";
}

function controlStyle(source) {
  const fallback = "width:100%;min-height:44px;padding:0 12px;border:1px solid #d8d8d2;border-radius:10px;background:#fff;font:inherit;color:#222;box-sizing:border-box;";
  const current = text(source?.style?.cssText);
  return current || fallback;
}

function enhanceCountryInput(inputId) {
  const input = document.getElementById(inputId);
  if (!input || input.dataset.countrySelectEnhanced === "1") return;

  const currentRaw = text(input.value);
  const canonical = canonicalCountry(currentRaw);
  const style = controlStyle(input);
  const wrapper = document.createElement("div");
  wrapper.className = "sessionCountrySelector";
  wrapper.style.cssText = "display:grid;gap:7px;min-width:0;";

  const select = document.createElement("select");
  select.style.cssText = style;
  select.setAttribute("aria-label", "国");
  select.innerHTML = [
    '<option value="">国を選択</option>',
    ...COUNTRY_OPTIONS.map(country => `<option value="${country}">${country}</option>`),
    '<option value="__other__">その他（入力）</option>'
  ].join("");

  const other = document.createElement("input");
  other.type = "text";
  other.placeholder = "国名を入力";
  other.style.cssText = style;
  other.style.display = "none";
  other.setAttribute("aria-label", "その他の国名");

  input.type = "hidden";
  input.dataset.countrySelectEnhanced = "1";
  input.parentNode?.insertBefore(wrapper, input);
  wrapper.appendChild(select);
  wrapper.appendChild(other);

  if (canonical) {
    select.value = canonical;
    input.value = canonical;
  } else if (currentRaw) {
    select.value = "__other__";
    other.style.display = "block";
    other.value = currentRaw;
    input.value = currentRaw;
  }

  function sync() {
    if (select.value === "__other__") {
      other.style.display = "block";
      input.value = text(other.value);
    } else {
      other.style.display = "none";
      input.value = select.value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  select.addEventListener("change", () => {
    sync();
    if (select.value === "__other__") other.focus();
  });
  other.addEventListener("input", sync);
}

function enhanceEventNamePreset(inputId) {
  const input = document.getElementById(inputId);
  if (!input || input.dataset.eventPresetEnhanced === "1") return;

  input.dataset.eventPresetEnhanced = "1";
  const originalParent = input.parentNode;
  if (!originalParent) return;

  const wrapper = document.createElement("div");
  wrapper.className = "sessionEventNameSelector";
  wrapper.style.cssText = "display:grid;gap:7px;min-width:0;";
  originalParent.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const select = document.createElement("select");
  select.className = "sessionEventPresetSelect";
  select.style.cssText = controlStyle(input);
  select.setAttribute("aria-label", "よく使うイベント名");
  select.innerHTML = [
    '<option value="">よく使うイベント名から選択</option>',
    ...EVENT_NAME_PRESETS.map(name => `<option value="${name}">${name}</option>`),
    '<option value="__custom__">その他・自由入力</option>'
  ].join("");
  wrapper.insertBefore(select, input);

  select.addEventListener("change", () => {
    if (select.value && select.value !== "__custom__") {
      input.value = select.value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    input.focus();
  });
}

function enhanceDateRange(startId, endId) {
  const start = document.getElementById(startId);
  const end = document.getElementById(endId);
  if (!start || !end || start.dataset.dateRangeEnhanced === "1") return;

  start.dataset.dateRangeEnhanced = "1";
  end.dataset.dateRangeEnhanced = "1";

  function syncRange() {
    const startValue = text(start.value);
    if (!startValue) return;

    end.min = startValue;
    if (!end.value || end.value < startValue) end.value = startValue;
  }

  start.addEventListener("change", () => {
    syncRange();

    window.setTimeout(() => {
      try {
        end.focus({ preventScroll: false });
      } catch {
        end.focus();
      }

      if (typeof end.showPicker === "function") {
        try {
          end.showPicker();
        } catch {
          // iOS Safari may require the user to tap the focused end date field.
        }
      }
    }, 40);
  });

  end.addEventListener("change", () => {
    if (start.value && end.value && end.value < start.value) {
      end.value = start.value;
    }
  });

  syncRange();

  const parent = start.closest("div")?.parentElement || start.parentElement;
  if (parent && !parent.querySelector(".sessionDateRangeHint")) {
    const hint = document.createElement("div");
    hint.className = "sessionDateRangeHint muted";
    hint.style.cssText = "grid-column:1/-1;margin-top:-2px;font-size:10px;line-height:1.45;";
    hint.textContent = "開始日を選ぶと、続けて終了日を選択します。1日のイベントは同じ日付のままでOKです。";
    parent.appendChild(hint);
  }
}

function enhanceSessionForms() {
  enhanceCountryInput("sessionCountry");
  enhanceCountryInput("editSessionCountry");
  enhanceEventNamePreset("sessionEventName");
  enhanceDateRange("sessionStartDate", "sessionEndDate");
  enhanceDateRange("editSessionStartDate", "editSessionEndDate");
}

let scheduled = false;
function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enhanceSessionForms();
  });
}

const view = document.getElementById("view");
if (view) {
  new MutationObserver(scheduleEnhance).observe(view, {
    childList: true,
    subtree: true
  });
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scheduleEnhance();
});

scheduleEnhance();
