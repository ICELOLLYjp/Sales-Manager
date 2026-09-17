export function isValidExpenseCandidateId(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function sessionExpenseDetailHref(sessionId) {
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(sessionId)) {
    return null;
  }
  return `./?expenseSessionId=${encodeURIComponent(sessionId)}`;
}

export function validatedGmailSourceUrl(value) {
  const url = new URL(value);
  if (url.origin !== "https://mail.google.com" || !url.pathname.startsWith("/mail/u/")) {
    throw new Error("Gmailのリンクを確認できませんでした。");
  }
  return url.href;
}
