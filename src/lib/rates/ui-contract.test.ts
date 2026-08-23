import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Arayüz sözleşmesi.
 *
 * Depoda bileşen testi altyapısı yok; bu yüzden UI'ın kaldırılması/eklenmesi
 * gereken davranışları kaynak düzeyinde doğrulanır. DOM davranışı ayrıca
 * tarayıcı doğrulamasıyla kontrol edilir.
 */

const creator = readFileSync("src/components/PaymentRequestCreator.tsx", "utf8");
const payer = readFileSync("src/components/PaymentRequestPayer.tsx", "utf8");
const conversion = readFileSync("src/lib/arc/conversion.ts", "utf8");
const readme = readFileSync("README.md", "utf8");

describe("oluşturucu ekranı", () => {
  it("elle kur girişi kalmadı", () => {
    expect(creator).not.toContain("setRateInput");
    expect(creator).not.toContain("parseRate(");
    expect(creator).not.toContain("describeRateFailure");
    expect(creator).not.toContain("1 USDC kaç TRY?");
    expect(creator).not.toContain("elle girilir");
    expect(creator).not.toContain("elle girdiğin demo");
  });

  it("kuru sunucudan otomatik alır", () => {
    expect(creator).toContain("fetchQuoteFromServer");
    expect(creator).toContain('status: "loading"');
    expect(creator).toContain('status: "ready"');
    expect(creator).toContain('status: "error"');
    expect(creator).toContain("Kuru yenile");
    expect(creator).toContain("Kuru yeniden dene");
  });

  it("CoinGecko atfı görünür ve bağlantılıdır", () => {
    expect(creator).toContain("https://www.coingecko.com/en/api");
    expect(creator).toContain("Data provided by CoinGecko");
  });

  it("geçerli teklif olmadan talep oluşturulamaz", () => {
    expect(creator).toContain("signedQuote !== null");
    expect(creator).toContain("!quoteExpired");
    // Teklif ve etiket doğrudan sunucu teklifinden gelir.
    expect(creator).toContain("quote: signedQuote.quote");
    expect(creator).toContain("quoteTag: signedQuote.tag");
  });

  it("süresi dolan teklifte uyarı gösterir", () => {
    expect(creator).toContain("Kur teklifinin süresi doldu");
  });
});

describe("ödeyen ekranı", () => {
  it("teklifi sunucuya doğrulatır", () => {
    expect(payer).toContain("verifyQuoteWithServer");
    expect(payer).toContain("extractQuoteFromPayload");
  });

  it("tahmin ve gönderim öncesi yeniden doğrular", () => {
    const occurrences = payer.split("verifyQuoteWithServer").length - 1;
    // import + ilk doğrulama + tahmin öncesi + gönderim öncesi
    expect(occurrences).toBeGreaterThanOrEqual(4);
    expect(payer).toContain("quoteBeforeEstimate");
    expect(payer).toContain("quoteBeforeSend");
  });

  it("cüzdan imzasının piyasa kurunu kanıtlamadığını söyler", () => {
    expect(payer).toContain(
      "Cüzdan imzası tek başına kurun piyasa değeri olduğunu kanıtlamaz",
    );
  });

  it("kur kaynağını ve zamanlarını gösterir", () => {
    expect(payer).toContain("Kur kaynağı");
    expect(payer).toContain("Kur gözlem zamanı");
    expect(payer).toContain("Kur geçerliliği");
  });
});

describe("bağlantı geçerlilik süresi doğru anlatılır", () => {
  it("yedi gün iddiası hiçbir yerde kalmadı", () => {
    for (const [name, source] of [
      ["creator", creator],
      ["payer", payer],
      ["conversion", conversion],
      ["README", readme],
    ] as const) {
      expect(source, name).not.toContain("7 gün");
      expect(source, name).not.toContain("yedi gün");
      expect(source.toLowerCase(), name).not.toContain("seven days");
    }
  });

  it("gerçek bitiş anı ve kalan süre gösterilir", () => {
    expect(creator).toContain("currentGenerated.expiresAt");
    expect(creator).toContain("generatedSecondsLeft");
    expect(creator).toContain("en fazla 5 dakika");
  });

  it("süresi dolan bağlantıda kopyala/paylaş pasifleşir", () => {
    expect(creator).toContain("generatedExpired");
    expect(creator).toContain("disabled={generatedExpired}");
    expect(creator).toContain("Bu bağlantının süresi doldu");
  });

  it("kurun elle girilen demo kuru olduğu iddiası kalmadı", () => {
    expect(payer).not.toContain("demo kuru");
    expect(creator).not.toContain("demo kuru");
    expect(conversion).not.toContain("canlı kur\n * çekilmez");
  });
});

describe("imza sonrası yayım kapısı", () => {
  it("bağlantı üretilmeden önce yeniden doğrulanır", () => {
    expect(creator).toContain("ensureSignedRequestPublishable");
    // Kapı, URL kurulmadan ÖNCE çağrılır.
    expect(creator.indexOf("ensureSignedRequestPublishable")).toBeLessThan(
      creator.indexOf("buildShareUrl(window.location.origin"),
    );
  });

  it("yeni denemede eski bağlantı ekranda bırakılmaz", () => {
    expect(creator).toContain("debtKeyForRun");
  });
});

describe("çift gönderim koruması", () => {
  it("kilit, submit içindeki ilk await'ten önce alınır", () => {
    // Karşılaştırma yalnızca submit gövdesi içinde yapılır; sayfa açılışındaki
    // ilk doğrulama efekti de `await` içerdiği için dosya geneli yanıltır.
    const submitBody = payer.slice(payer.indexOf("const submit = async () => {"));
    const guardAt = submitBody.indexOf("submitGuard.current.tryEnter()");
    const firstAwaitAt = submitBody.indexOf("await ");
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(firstAwaitAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(firstAwaitAt);
  });

  it("doğrulama sırasında görünür durum değişir ve düğme pasifleşir", () => {
    expect(payer).toContain('setStatus("verifying")');
    expect(payer).toContain('status === "verifying"');
    expect(payer).toContain("Talep ve kur yeniden doğrulanıyor");
  });

  it("başarıdan sonra kilit bırakılmaz", () => {
    expect(payer).toContain("keepLocked = true");
    expect(payer).toContain("submitGuard.current.release()");
  });
});

describe("tahmin çift tık koruması", () => {
  it("tahmin için ayrı kilit vardır ve ilk await'ten önce alınır", () => {
    const body = payer.slice(payer.indexOf("const estimate = async () => {"));
    const guardAt = body.indexOf("estimateGuard.current.tryEnter()");
    const firstAwaitAt = body.indexOf("await ");
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(guardAt).toBeLessThan(firstAwaitAt);
  });

  it("bayat sonuç daha yeni durumun üzerine yazmaz", () => {
    expect(payer).toContain("runToken");
    expect(payer).toContain("isStale()");
    // Hesap ve ağ değişimi devam eden çalışmayı bayatlatır.
    expect(payer).toContain("runToken.current += 1");
  });
});

describe("belirsiz gönderim sonucu", () => {
  it("kilit açılmaz ve kullanıcı cüzdan/ArcScan kontrolüne yönlendirilir", () => {
    expect(payer).toContain("keepsSubmissionLocked");
    expect(payer).toContain("recordSubmission");
    expect(payer).toContain("readSubmission");
  });

  it("önceki gönderim uyarısı yetkili olmadığını söyler", () => {
    expect(payer).toContain("yalnızca bu tarayıcıda tutulur");
    expect(payer).toContain("başka bir cihazdan");
  });
});

describe("istek oturumu yalıtımı", () => {
  it("dış kabuk oturumu encoded ile anahtarlar", () => {
    // key değişince React iç bileşeni tamamen söker: A durumu B'ye sızamaz.
    expect(payer).toContain("<RequestSession key={encoded ?? \"__yok__\"}");
    expect(payer).toContain("function RequestSession({ encoded }");
  });

  it("iç bileşen sorgu parametresini kendisi okumaz", () => {
    const session = payer.slice(payer.indexOf("function RequestSession("));
    expect(session).not.toContain("useSearchParams()");
  });

  it("talebe özel tüm durum iç bileşende tanımlıdır", () => {
    const session = payer.slice(payer.indexOf("function RequestSession("));
    for (const state of [
      "verifyState",
      "setStatus",
      "setConfirmed",
      "setEstimateSummary",
      "setTransaction",
      "setSelectedWalletUuid",
      "priorSubmission",
      "submitGuard",
      "estimateGuard",
      "runToken",
    ]) {
      expect(session, state).toContain(state);
    }
  });

  it("kayıt yoksa priorSubmission AÇIKÇA temizlenir", () => {
    // setPriorSubmission(prior) — prior null olabilir; koşullu yazım yok.
    expect(payer).toContain("setPriorSubmission(prior)");
    expect(payer).not.toContain("if (!cancelled && prior !== null)");
  });
});

describe("gönderim rezervasyonu", () => {
  it("rezervasyon ve kit.send TEK atomik kilit çağrısındadır", () => {
    const submitBody = payer.slice(payer.indexOf("const submit = async () => {"));
    const lockAt = submitBody.indexOf("runExclusiveSubmission(");
    const sendAt = submitBody.indexOf("sendArcUsdc(");
    expect(lockAt).toBeGreaterThanOrEqual(0);
    // sendArcUsdc kilit çağrısının İÇİNDE, yani ondan sonra geçer.
    expect(lockAt).toBeLessThan(sendAt);
  });

  it("kilitten AYRI, atomik olmayan bir rezervasyon adımı kalmadı", () => {
    // localStorage tek başına kilit değildir: ayrı reserve/lock adımı yok.
    expect(payer).not.toContain("reserveSubmission");
    expect(payer).not.toContain("withSubmissionLock");
  });

  it("yalnızca yayın öncesi hatalarda rezervasyon bırakılır", () => {
    expect(payer).toContain("clearReservation(");
    // Kalıcı sonuçta kilit korunur, rezervasyon silinmez.
    expect(payer).toContain("keepsSubmissionLocked(outcome.code)");
  });

  it("sekmeler arası değişiklik dinlenir ve Web Locks kullanılır", () => {
    expect(payer).toContain("subscribeToSubmissions");
    expect(payer).toContain("runExclusiveSubmission");
  });

  it("kilit/depo yoksa FAIL-CLOSED: Türkçe tarayıcı uyarısı gösterilir", () => {
    expect(payer).toContain("SUBMISSION_UNAVAILABLE_MESSAGE");
    expect(payer).toContain('guarded.reason === "unavailable"');
    expect(payer).toContain('guarded.reason === "busy"');
  });

  it("belirsiz ve revert sonuçta işlem hash'i ekranda korunur", () => {
    // ArcScan mutabakatının tek ipucu hash'tir; kaybedilmez.
    expect(payer).toContain("setPendingTxHash(outcome.txHash ?? null)");
    expect(payer).toContain("setPendingTxUrl(outcome.explorerUrl ?? null)");
    expect(payer).toContain("{pendingTxHash}");
  });
});

describe("mutabakat kaydı yenilemeden sonra da durur", () => {
  it("durum ve hash DEPODAN geri yüklenir", () => {
    // Yalnızca bellekteki durum değil, kalıcı kayıt okunur.
    expect(payer).toContain("readSubmissionView(");
    expect(payer).toContain("view?.outcome ?? null");
    expect(payer).toContain("setPendingTxHash(view?.txHash ?? null)");
    expect(payer).toContain("setPendingTxUrl(view?.explorerUrl ?? null)");
  });

  it("terminal ve belirsiz sonuçlarda hash KALICI olarak yazılır", () => {
    expect(payer).toContain("txHash: outcome.txHash ?? null");
    expect(payer).toContain("txHash: outcome.value.txHash");
  });

  it("revert, belirsizlikten AYRI kaydedilir", () => {
    expect(payer).toContain('outcome.code === "reverted" ? "reverted" : "unknown"');
    // Revert için ayrı, "ödeme yapılmadı" diyen bir metin vardır.
    expect(payer).toContain('priorSubmission === "reverted"');
    expect(payer).toMatch(/revert\)\. Ödeme yapılmadı/);
  });

  it("belirsizlik başarı ya da başarısızlık İDDİA ETMEZ", () => {
    expect(payer).toContain("ödeme yapılmış da olabilir, yapılmamış da");
  });

  it("kayıt varken tahmin ve gönderim düğmesi kapalı kalır", () => {
    // priorSubmission null değilse canEstimate false olur; gönderim başlamaz.
    expect(payer).toContain("priorSubmission === null");
  });
});

describe("çapraz örnek kota sınırı belgelenir", () => {
  it("README süreç içi korumanın Vercel'de yetmediğini söyler", () => {
    expect(readme).toMatch(/süreç içi/i);
    expect(readme).toContain("Vercel");
    expect(readme).toMatch(/Redis|KV/);
  });

  it("paylaşılan sınırlayıcı DAĞITIM GEREKSİNİMİ olarak işaretlenir", () => {
    expect(readme).toContain("Dağıtım gereksinimi");
    // Tamamlanmış bir garanti gibi sunulmaz.
    expect(readme).toMatch(/karşılanmamıştır|açık kalmaktadır/i);
  });
});
