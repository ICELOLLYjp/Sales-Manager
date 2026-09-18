import { selectableEvents, eventStatus, eventDateLabel } from "./gmailExpenseEventPickerModel.js";

export function createEventPicker({ select, search, closedToggle, list, summary, chosen }) {
  let sessions = [];
  let disabled = true;
  let requested = "";
  const MAX_VISIBLE = 15;

  function render() {
    const filtered = selectableEvents(sessions, { includeClosed: closedToggle.checked, query: search.value });
    const selected = sessions.find(item => item.id === select.value);
    const selectedVisible = selected && filtered.some(item => item.id === selected.id);
    const visible = filtered.slice(0, MAX_VISIBLE);
    if (selectedVisible && !visible.some(item => item.id === selected.id)) visible.unshift(selected);
    list.replaceChildren();
    search.disabled = disabled;
    closedToggle.disabled = disabled;
    chosen.textContent = selected ? `選択中：${eventDateLabel(selected)} ／ ${selected.eventName || "名称未設定"} ／ ${[selected.city, selected.country].filter(Boolean).join("、")}${eventStatus(selected) === "closed" ? "（終了済み）" : ""}` : "登録先イベントを選択してください。";
    chosen.classList.toggle("has-choice", Boolean(selected));
    if (!filtered.length) {
      const empty = document.createElement("p"); empty.className = "picker-empty";
      empty.textContent = search.value ? "検索条件に一致するイベントはありません。" : "表示できるイベントはありません。";
      list.append(empty);
    }
    for (const item of visible) {
      const label = document.createElement("label"); label.className = "picker-event";
      if (item.id === select.value) label.classList.add("selected");
      const radio = document.createElement("input"); radio.type = "radio"; radio.name = "intakeTargetEvent";
      radio.value = item.id; radio.checked = item.id === select.value; radio.disabled = disabled;
      const content = document.createElement("span"); content.className = "picker-event-text";
      const name = document.createElement("strong"); name.textContent = item.eventName || "名称未設定";
      const details = document.createElement("small");
      details.textContent = [eventDateLabel(item), [item.city, item.country].filter(Boolean).join("、"), eventStatus(item) === "closed" ? "終了済み" : eventStatus(item) === "pending_allocation" ? "終了処理待ち" : ""].filter(Boolean).join(" ／ ");
      content.append(name, details); label.append(radio, content); list.append(label);
    }
    summary.textContent = filtered.length > MAX_VISIBLE ? `${filtered.length}件中、最近の${MAX_VISIBLE}件を表示しています。名前・都市・日付で検索してください。` : `${filtered.length}件のイベントを表示しています。`;
  }

  function setSessions(items, preferredId = "") {
    sessions = Array.isArray(items) ? items : [];
    requested = preferredId;
    const preferred = sessions.find(item => item.id === preferredId);
    if (preferred && eventStatus(preferred) === "closed") closedToggle.checked = true;
    const allowed = selectableEvents(sessions, { includeClosed: closedToggle.checked });
    select.replaceChildren(new Option("イベントを選択してください", ""));
    for (const item of allowed) select.add(new Option(item.eventName || "名称未設定", item.id));
    select.value = allowed.some(item => item.id === preferredId) ? preferredId : "";
    render();
  }
  function changeSelection(id) {
    if (disabled || ![...select.options].some(option => option.value === id)) return;
    if (select.value === id) return;
    select.value = id;
    render();
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  list.addEventListener("change", event => {
    if (event.target.matches('input[name="intakeTargetEvent"]')) changeSelection(event.target.value);
  });
  search.addEventListener("input", render);
  closedToggle.addEventListener("change", () => {
    const allowed = selectableEvents(sessions, { includeClosed: closedToggle.checked });
    const previous = select.value;
    select.replaceChildren(new Option("イベントを選択してください", ""));
    for (const item of allowed) select.add(new Option(item.eventName || "名称未設定", item.id));
    select.value = allowed.some(item => item.id === previous) ? previous : "";
    render();
    if (previous && !select.value) select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  render();
  return { setSessions, setDisabled(value) { disabled = Boolean(value); render(); }, clear() { sessions = []; requested = ""; select.replaceChildren(new Option("イベントを選択してください", "")); select.value = ""; render(); } };
}
