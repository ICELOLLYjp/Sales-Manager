export function createOperationId(prefix = "op") {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "_",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");

  const random = crypto.randomUUID().slice(0, 8);
  return `${prefix}_${stamp}_${random}`;
}

export function slugify(value = "") {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
