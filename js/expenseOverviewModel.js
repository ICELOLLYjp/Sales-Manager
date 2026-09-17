// The overview is read only. Counts reflect the bounded candidate list returned by the backend.
export function summarizeExpenseCandidates(payload) {
  if (!payload || !Array.isArray(payload.candidates)) {
    throw new Error("保存済み候補の応答を確認できませんでした。");
  }
  const counts = { total: 0, unreviewed: 0, kept: 0, posted: 0, excluded: 0 };
  for (const item of payload.candidates) {
    counts.total += 1;
    if (item?.expensePosted === true) counts.posted += 1;
    else if (item?.reviewStatus === "excluded") counts.excluded += 1;
    else if (item?.reviewStatus === "kept") counts.kept += 1;
    else counts.unreviewed += 1;
  }
  return { ...counts, truncated: payload.truncated === true, maxResults: Number(payload.maxResults) || 100 };
}
