"use strict";

// Fetch only bounded Gmail text parts whose data is stored behind an attachmentId.
const MAX_TEXT_MIME_BYTES = 2 * 1024 * 1024;
async function hydrateReferencedTextParts(payload, fetchTextPart) {
  let visited = 0;
  let requested = 0;
  async function visit(part, depth = 0) {
    if (!part || typeof part !== "object" || depth > 12 || ++visited > 100) return;
    const mime = String(part.mimeType || "").split(";")[0].toLowerCase();
    const isText = mime === "text/plain" || mime === "text/html";
    const body = part.body;
    const id = body?.attachmentId;
    const size = Number(body?.size);
    if (isText && !part.filename && body && typeof body.data !== "string" &&
        typeof id === "string" && id.length > 0 && id.length <= 4096 &&
        (!Number.isFinite(size) || size <= MAX_TEXT_MIME_BYTES) &&
        requested < 3) {
      requested++;
      try {
        const response = await fetchTextPart(id);
        const data = response?.data;
        const fetchedSize = Number(response?.size);
        if (typeof data === "string" &&
            (!Number.isFinite(fetchedSize) || fetchedSize <= MAX_TEXT_MIME_BYTES) &&
            Math.floor(data.length * 0.75) <= MAX_TEXT_MIME_BYTES) {
          body.data = data;
        }
      } catch {
        // Preserve the original part if Gmail cannot serve the referenced text.
      }
    }
    for (const child of Array.isArray(part.parts) ? part.parts : []) {
      await visit(child, depth + 1);
    }
  }
  await visit(payload);
}
module.exports = { MAX_TEXT_MIME_BYTES, hydrateReferencedTextParts };
