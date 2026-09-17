export const MAX_BULK_CANDIDATES = 20;
const CANDIDATE_ID = /^[a-f0-9]{64}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{1,160}$/;

export function duplicateCandidateIds(payload) {
  const valid = new Set((payload?.candidates || []).map(item => item?.id));
  const ids = new Set();
  for (const group of payload?.duplicateGroups || []) {
    if (!Array.isArray(group) || group.length < 2) continue;
    for (const id of group) if (valid.has(id)) ids.add(id);
  }
  return ids;
}

export function candidatesForFilter(payload, { status = "all", account = "all", duplicates = "all" } = {}) {
  if (!payload || !Array.isArray(payload.candidates)) throw new Error("保存済み候補の応答が正しくありません。");
  const ids = duplicateCandidateIds(payload);
  return payload.candidates.filter(item => {
    const actualStatus = item.expensePosted ? "posted" : item.reviewStatus || "unreviewed";
    return (status === "all" || status === actualStatus) &&
      (account === "all" || account === item.account) &&
      (duplicates !== "duplicate" || ids.has(item.id));
  });
}

export function planBulkAction(payload, selectedIds, action, eventId = "") {
  if (!payload || !Array.isArray(payload.candidates) || !Array.isArray(selectedIds)) throw new Error("候補を読み込み直してください。");
  if (!selectedIds.length || selectedIds.length > MAX_BULK_CANDIDATES || new Set(selectedIds).size !== selectedIds.length) {
    throw new Error(`1回に選べるのは1件から${MAX_BULK_CANDIDATES}件です。`);
  }
  if (!["kept", "excluded", "assign"].includes(action)) throw new Error("操作を確認してください。");
  if (action === "assign" && !SESSION_ID.test(eventId)) throw new Error("対象イベントを選択してください。");
  if (action === "assign" && !payload.sessions?.some(item => item.id === eventId)) throw new Error("対象イベントが見つかりません。");
  const byId = new Map(payload.candidates.map(item => [item.id, item]));
  const rows = selectedIds.map(id => {
    const item = byId.get(id);
    if (!CANDIDATE_ID.test(id) || !item || item.expensePosted) throw new Error("経費登録済みの候補や不明な候補は変更できません。");
    if (action === "assign" && !["unreviewed", "kept"].includes(item.reviewStatus)) {
      throw new Error("除外した候補は割り当てできません。");
    }
    if (action !== "assign" && item.reviewStatus !== "unreviewed") {
      throw new Error("確認状態の一括変更は未確認の候補に限ります。");
    }
    return item;
  });
  const duplicateIds = duplicateCandidateIds(payload);
  return { rows, duplicateCount: rows.filter(row => duplicateIds.has(row.id)).length };
}
