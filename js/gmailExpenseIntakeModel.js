// Keep review and posting separate from the intake workflow.
export const GMAIL_INTAKE_ACCOUNTS = ["fjmthrs@gmail.com", "icelolly.zakka@gmail.com"];

export function intakeKey(message) {
  return `${message?.account || ""}\u0000${message?.messageId || ""}`;
}

export function groupIntakeSelection(previews, selectedKeys) {
  const groups = new Map();
  for (const item of previews || []) {
    if (!item || !GMAIL_INTAKE_ACCOUNTS.includes(item.account) || !/^[A-Za-z0-9_-]+$/.test(String(item.messageId || ""))) continue;
    const key = intakeKey(item);
    if (!selectedKeys.has(key)) continue;
    if (!groups.has(item.account)) groups.set(item.account, new Map());
    groups.get(item.account).set(item.messageId, item);
  }
  return [...groups].map(([account, messages]) => ({ account, messages: [...messages.values()] }));
}

// A saved candidate may already belong to another event or have been posted.
// Never silently replace that assignment, revive excluded mail, or change a posted expense.
export function planIntakeAssignments(messages, candidates, eventId) {
  const saved = new Map((candidates || []).map(item => [intakeKey(item), item]));
  const assign = [], alreadyAssigned = [], conflicts = [], missing = [];
  for (const message of messages || []) {
    const item = saved.get(intakeKey(message));
    if (!item) { missing.push(message); continue; }
    if (item.expensePosted === true) {
      if (item.expenseScope === "event" && item.eventId === eventId) alreadyAssigned.push(item);
      else conflicts.push(item);
    } else if (item.reviewStatus === "excluded" || item.expenseScope === "general" ||
      (item.expenseScope === "event" && item.eventId !== eventId)) {
      conflicts.push(item);
    } else if (item.expenseScope === "event" && item.eventId === eventId) {
      alreadyAssigned.push(item);
    } else {
      assign.push(item);
    }
  }
  return { assign, alreadyAssigned, conflicts, missing };
}
