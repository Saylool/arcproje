/**
 * İstek gövdesinin SINIRLI ve zaman aşımlı okunması.
 *
 * `request.text()` tüm gövdeyi önce belleğe alır ve sonuçtaki `length` UTF-16
 * kod birimi sayar — çok baytlı UTF-8 içerikte gerçek bayt sayısından sapar.
 * Burada alınan BAYTLAR sayılır, sınır aşılır aşılmaz akış iptal edilir ve
 * çözümleme yalnızca sınır içinde kalan veri üzerinde, katı UTF-8 ile yapılır.
 *
 * Boyut sınırı tek başına yetmez: istemci sınırın altında kalıp baytları
 * saniyede bir damlatarak isteği açık tutabilir. Bu yüzden tüm okumayı kapsayan
 * bir son teslim süresi de uygulanır.
 *
 * Not: `/api/rates/verify` kendi kopyasını taşımaya devam ediyor; o rota bu
 * bölümde bilinçli olarak DEĞİŞTİRİLMEDİ. Ortaklaştırma ayrı ve gözden
 * geçirilmiş bir değişikliğe bırakıldı.
 */

export type BoundedBody =
  | { status: "ok"; text: string }
  | { status: "tooLarge" }
  | { status: "invalidEncoding" }
  | { status: "timeout" }
  | { status: "unreadable" };

export async function readBoundedBody(
  request: Request,
  maxBytes: number,
  deadlineMs: number,
): Promise<BoundedBody> {
  const stream = request.body;
  if (stream === null) {
    return { status: "ok", text: "" };
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, deadlineMs);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (timedOut) {
        return { status: "timeout" };
      }
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { status: "tooLarge" };
      }
      chunks.push(value);
    }
  } catch {
    return timedOut ? { status: "timeout" } : { status: "unreadable" };
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      status: "ok",
      text: new TextDecoder("utf-8", { fatal: true }).decode(merged),
    };
  } catch {
    return { status: "invalidEncoding" };
  }
}
