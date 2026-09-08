import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ARC_RPC_TIMEOUT_MS } from "@/lib/arc/arc-rpc";
import { PROVIDER_TIMEOUT_MS } from "@/lib/rates/coingecko";
import { ANALYSIS_TIMEOUT_MS } from "@/lib/receipt/extract";

/**
 * HER ROTANIN KENDİ SÜRE TAVANI VARDIR.
 *
 * Vercel'in varsayılanı — fluid compute açıkken, her planda — **300
 * saniyedir**. Bu uygulamadaki hiçbir rotanın bütçesi 60 saniyeyi geçmez,
 * yani varsayılan gerçek ihtiyacın 5-20 KATIDIR. Aradaki fark bedava değildir:
 * asılı kalan bir istek beş dakika boyunca bir örneği meşgul eder ve kullanıcı
 * bu süre boyunca temiz hata mesajını GÖREMEZ.
 *
 * KURAL: tavan, rotanın KENDİ zaman aşımı bütçesinin hemen üstündedir.
 *
 * Sıra önemlidir. Uygulama kendi zaman aşımını yakalayıp anlamlı bir hata
 * döndürebilmelidir; platform onu daha önce keserse o özenli hata yolu HİÇ
 * çalışmaz ve kullanıcı kopuk bir bağlantı görür. Tavan bu yüzden bütçeden
 * BÜYÜK, ama boşuna beklemeyi önleyecek kadar da yakın olmalıdır.
 *
 * Aşağıdaki testler tavanları koddaki gerçek zaman aşımı sabitlerine BAĞLAR.
 * Biri değişirse (ör. analiz 30 sn'den 90 sn'ye çıkarsa) burası düşer; sessizce
 * kesilmeye başlayan bir rota bırakılmaz.
 *
 * KAPSAM: rota işleyicileri (`route.ts`). Sayfalar platform varsayılanında
 * kalır ve bu bilinçlidir — sunucu tarafında dış çağrı yapmazlar, oturum
 * durumu JWT'den okunur.
 */

/** İzin verilen kademeler. Yeni bir sayı, gerekçesiyle buraya eklenir. */
const TIERS = {
  /** Yalnızca veritabanı; ve varsa 5 sn'lik kur çağrısı. */
  fast: 15,
  /** Arc RPC'ye giden yol. */
  rpc: 30,
  /** Dış model çağrısı ya da toplu silme. */
  slow: 60,
} as const;

/** `finalize` makbuzu doğrularken yaptığı ARDIŞIK RPC çağrısı sayısı. */
const FINALIZE_RPC_CALLS = 3;

function routeFiles(directory = "src/app"): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...routeFiles(path));
    } else if (entry.name === "route.ts") {
      found.push(path);
    }
  }
  return found.sort();
}

/** Bildirilen değer; yoksa `null`. SADECE sayı sabiti kabul edilir. */
function declaredDuration(path: string): number | null {
  const source = readFileSync(path, "utf8");
  const match = /^export const maxDuration = (\d+);$/m.exec(source);
  return match === null ? null : Number(match[1]);
}

const files = routeFiles();

describe("her rota kendi sure tavanini bildirir", () => {
  it("rota bulundu", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("HICBIR rota tavansiz degildir", () => {
    /*
     * Bildirmeyen rota 300 saniyeye düşer ve bunu hiçbir yerde söylemez.
     * Yeni bir rota eklenip bu satır unutulursa burada görülür.
     */
    const missing = files.filter((path) => declaredDuration(path) === null);
    expect(missing, "maxDuration bildirmeyen rota").toEqual([]);
  });

  it("deger SAYI SABITIDIR, degisken degil", () => {
    /*
     * Next.js rota segmenti yapılandırmasını DERLEME ANINDA statik olarak
     * okur; içe aktarılmış bir sabit çözülemez. Yukarıdaki düzenli ifade
     * yalnızca sayı kabul ettiği için, `= DURATION_FAST` yazan bir rota
     * "bildirmemiş" sayılır ve bir önceki test onu yakalar. Bu test o
     * kararın NEDENİNİ kayda geçirir.
     */
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/^export const maxDuration = [A-Za-z_]/m);
    }
  });

  it("yalnizca tanimli kademeler kullanilir", () => {
    const allowed = Object.values(TIERS) as number[];
    for (const path of files) {
      expect(allowed, path).toContain(declaredDuration(path));
    }
  });
});

describe("tavanlar kodun KENDI zaman asimlarina bagli", () => {
  it("analiz tavani OpenAI zaman asimini KAPSAR", () => {
    /*
     * Tavan analizin kendi zaman aşımından küçük olsaydı, `ANALYSIS_TIMEOUT`
     * hata yolu (504 ve "tekrar dene" mesajı) hiç çalışmazdı: platform
     * bağlantıyı önce keserdi.
     */
    const declared = declaredDuration("src/app/api/receipts/analyze/route.ts");
    expect(declared).toBe(TIERS.slow);
    expect(declared).toBeGreaterThan(ANALYSIS_TIMEOUT_MS / 1000);
  });

  it("finalize tavani UC ardisik RPC cagrisini kapsar", () => {
    /*
     * Makbuz doğrulaması zincire üç kez sorar: chainId, makbuz ve blok
     * yüksekliği. Hepsi ardışıktır, yani en kötü hâlde üç zaman aşımı
     * üst üste binebilir.
     */
    const declared = declaredDuration(
      "src/app/api/shared-bills/[billId]/payment/finalize/route.ts",
    );
    expect(declared).toBe(TIERS.rpc);
    expect(declared).toBeGreaterThan(
      (FINALIZE_RPC_CALLS * ARC_RPC_TIMEOUT_MS) / 1000,
    );
  });

  it("en dusuk kademe bile kur cagrisini KAPSAR", () => {
    /*
     * Teklif basan yollar CoinGecko'ya gider. En dar tavan bile o çağrının
     * zaman aşımından rahatça büyük olmalı, yoksa sağlayıcı yavaşladığında
     * istek platformdan kesilir.
     */
    expect(TIERS.fast).toBeGreaterThan((PROVIDER_TIMEOUT_MS / 1000) * 2);
  });

  it("hicbir kademe platform varsayilanina yaklasmaz", () => {
    /*
     * Maddenin bütün amacı bu: 300 saniye bu uygulamada hiçbir işin
     * gerektirmediği bir süredir.
     */
    const PLATFORM_DEFAULT_SECONDS = 300;
    for (const tier of Object.values(TIERS)) {
      expect(tier).toBeLessThanOrEqual(PLATFORM_DEFAULT_SECONDS / 4);
    }
  });
});
