import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Borçlu akışının YETKİLENDİRME yüzeyi.
 *
 * Bu dosyalar Google auth'u hiçbir biçimde tanımaz: borçlu yalnızca cüzdan
 * imzasıyla yetkilenir. Buradaki kısıt gevşetilemez.
 */
const WALLET_ONLY_API_FILES = [
  "src/app/api/shared-bills/[billId]/challenge/route.ts",
  "src/app/api/shared-bills/[billId]/resolve/route.ts",
  "src/app/api/shared-bills/[billId]/me/route.ts",
  "src/app/api/shared-bills/[billId]/payment/claim/route.ts",
  "src/app/api/shared-bills/[billId]/payment/finalize/route.ts",
  "src/app/api/shared-bills/[billId]/payment/outcome/route.ts",
  "src/app/api/shared-bills/[billId]/payment/prepare/route.ts",
  "src/app/api/shared-bills/[billId]/payment/status/route.ts",
  "src/app/api/rates/usdc-try/route.ts",
  "src/app/api/rates/verify/route.ts",
] as const;

/**
 * Ödeme sayfaları oturumu YALNIZCA GÖSTERMEK için okur.
 *
 * Başlıkta giriş/çıkış denetimi bulunur ki kullanıcı nerede olduğunu görsün
 * ve çıkabilsin. Bu bir KAPI DEĞİLDİR: paylaşılan bağlantıyı açan kişinin
 * oturumu olmayabilir ve olması da gerekmez.
 */
const SESSION_DISPLAY_ONLY_PAGES = [
  "src/app/pay/page.tsx",
  "src/app/pay/[billId]/page.tsx",
] as const;

/** Sayfanın erişimi reddetmesine yarayacak her yol. */
const GATING_PATTERNS = [
  /\bredirect\(/,
  /\bnotFound\(/,
  /\bsignIn\(/,
  /AUTH_REQUIRED/,
  /\b401\b/,
  /\b403\b/,
  /status !== "authenticated"/,
  /status === "signedOut"/,
] as const;

describe("Google auth route siniri", () => {
  it("yalnizca creator rotalari Google oturumu ister", () => {
    for (const file of [
      "src/app/api/receipts/analyze/route.ts",
      "src/app/api/shared-bills/route.ts",
    ]) {
      expect(readFileSync(file, "utf8"), file).toContain("authenticateRequest");
      expect(readFileSync(file, "utf8"), file).toContain("AUTH_REQUIRED");
    }
  });

  it("borclu API'leri ve kur API'leri Google auth import etmez", () => {
    for (const file of WALLET_ONLY_API_FILES) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/@\/auth|@\/lib\/auth/);
    }
  });

  it("odeme sayfalari oturumu YALNIZCA GOSTERIM icin okur, kapi kurmaz", () => {
    for (const file of SESSION_DISPLAY_ONLY_PAGES) {
      const source = readFileSync(file, "utf8");

      /* Denetim gorunur: durum basliga veriliyor. */
      expect(source, file).toContain("readSafeAuthState");
      expect(source, file).toMatch(/authState=\{authState\}/);

      /*
       * Ama hicbir sey oturuma BAGLANMIYOR: sayfa oturum durumuna bakarak
       * yonlendirme yapmaz, icerik gizlemez, hata dondurmez.
       */
      for (const gate of GATING_PATTERNS) {
        expect(source, `${file}: ${gate}`).not.toMatch(gate);
      }
    }
  });

  it("pay/[billId] sunucuda hesap verisi okumaya baslamadi", () => {
    const source = readFileSync("src/app/pay/[billId]/page.tsx", "utf8");
    expect(source).toContain("export default async function SharedBillPage");
    /* Borc hala yalnizca cuzdan imzasiyla, istemciden `/me` uzerinden gelir. */
    expect(source).not.toMatch(
      /createNeonSharedBillRepository|readSession\(|resolveSharedBillAccess/,
    );
  });

  it("istemciye yalnizca gorunen ad ve avatar gecer", () => {
    const source = readFileSync("src/lib/auth/safe-auth-state.ts", "utf8");
    /* Uygulama kullanici kimligi, e-posta ve saglayici kimligi SUNUCUDA kalir. */
    expect(source).not.toMatch(/\bemail\b|providerAccountId|user\.id/);
    expect(source).toMatch(/name:\s*authentication\.user\.name/);
    expect(source).toMatch(/image:\s*authentication\.user\.image/);
  });

  it("Google oturumu cüzdan sahiplik kanitinin yerini alamaz", () => {
    const resolve = readFileSync(
      "src/app/api/shared-bills/[billId]/resolve/route.ts",
      "utf8",
    );
    const me = readFileSync(
      "src/app/api/shared-bills/[billId]/me/route.ts",
      "utf8",
    );
    expect(resolve).toMatch(/signature|resolveSharedBillAccess/);
    expect(me).toMatch(/readSharedBillSession|session/i);
    expect(`${resolve}\n${me}`).not.toMatch(/Google|authenticateRequest/);
  });

  it("genis eslesen auth middleware veya proxy yoktur", () => {
    expect(existsSync("src/middleware.ts")).toBe(false);
    expect(existsSync("middleware.ts")).toBe(false);
    expect(existsSync("src/proxy.ts")).toBe(false);
    expect(existsSync("proxy.ts")).toBe(false);
  });

  it("OAuth origin'i istek Host/Origin/forwarded basliklarindan turetilmez", () => {
    const configSource = readFileSync(
      "src/lib/auth/auth-runtime-config.ts",
      "utf8",
    );
    const runtimeSource = readFileSync("src/auth.ts", "utf8");
    expect(configSource).toContain("readAppOrigin(env, nodeEnv)");
    expect(runtimeSource).toContain(
      "process.env.AUTH_URL = configuration.origin",
    );
    expect(`${configSource}\n${runtimeSource}`).not.toMatch(
      /headers\(|x-forwarded-host|referer/i,
    );
  });

  it("auth sirri ortuk okunmaz veya fallback ile doldurulmaz", () => {
    const source = [
      "src/auth.ts",
      "src/lib/auth/auth-config.ts",
      "src/lib/auth/auth-runtime.ts",
    ]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(source).toContain("secret: authentication.secret");
    expect(source).not.toMatch(/invalid\.invalid|changeme|AUTH_SECRET\s*\?\?/);
  });

  it("auth kontrolu semantik tema tokenlarini kullanir", () => {
    const source = readFileSync("src/components/AuthControl.tsx", "utf8");
    expect(source).toMatch(/bg-card/);
    expect(source).toMatch(/text-ink/);
    expect(source).not.toMatch(/bg-white|text-black|dark:/);
  });
});

/**
 * Ödeme yolundaki dosyalar. SAHİPLİĞİ hiç tanımamalıdırlar.
 *
 * Bir hesabı oluşturmuş olmak, o hesapta parayı hareket ettirme yetkisi
 * VERMEZ. Bu dosyalardan biri sahiplik alanını okumaya başlarsa, "hesabın
 * sahibiyim" iddiası sessizce bir ödeme yetkisine dönüşmüş olur.
 */
const OWNERSHIP_BLIND_PAYMENT_FILES = [
  "src/app/api/shared-bills/[billId]/challenge/route.ts",
  "src/app/api/shared-bills/[billId]/resolve/route.ts",
  "src/app/api/shared-bills/[billId]/me/route.ts",
  "src/app/api/shared-bills/[billId]/payment/claim/route.ts",
  "src/app/api/shared-bills/[billId]/payment/finalize/route.ts",
  "src/app/api/shared-bills/[billId]/payment/outcome/route.ts",
  "src/app/api/shared-bills/[billId]/payment/prepare/route.ts",
  "src/app/api/shared-bills/[billId]/payment/status/route.ts",
  "src/lib/db/shared-bill-access-service.ts",
  "src/lib/db/shared-bill-auth.ts",
  "src/lib/db/shared-bill-claim-service.ts",
  "src/lib/db/shared-bill-payment-service.ts",
  "src/lib/db/shared-bill-settlement-service.ts",
] as const;

/** Sahipliğin ödeme yoluna sızdığını gösterecek her iz. */
const OWNERSHIP_PATTERNS = [
  /createdByUserId/,
  /created_by_user_id/,
  /listBillsCreatedBy/,
  /SharedBillAttribution/,
] as const;

describe("hesap sahipligi ODEME YETKISI degildir", () => {
  it("odeme yolundaki hicbir dosya sahiplik alanini okumaz", () => {
    for (const file of OWNERSHIP_BLIND_PAYMENT_FILES) {
      const source = readFileSync(file, "utf8");
      for (const pattern of OWNERSHIP_PATTERNS) {
        expect(source, `${file} / ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("borclunun hesap sorgusu sahiplik sutununu SECMEZ", () => {
    const source = readFileSync(
      "src/lib/db/neon-shared-bill-repository.ts",
      "utf8",
    );
    const start = source.indexOf("const SELECT_BILL_FOR_DEBTOR");
    expect(start).toBeGreaterThan(-1);
    const query = source.slice(start, source.indexOf("`;", start));
    expect(query).not.toContain("created_by_user_id");
  });

  it("sahiplik listesi YALNIZCA okur: transfer veya imza baslatmaz", () => {
    const source = readFileSync("src/components/MyBillsPanel.tsx", "utf8");
    expect(source).not.toMatch(
      /kit\.send|sendTransaction|signTypedData|writeContract|method: "POST"/,
    );
    // Yetki sınırı kullanıcıya da SÖYLENİR.
    expect(source).toContain("myBills.authorityNotice");
  });
});

describe("0003 sahiplik gecisi", () => {
  const sql = readFileSync("migrations/0003_shared_bill_owner.sql", "utf8");

  it("islem icinde calisir ve sutunu NULL SERBEST birakir", () => {
    expect(sql).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS created_by_user_id uuid");
    // NOT NULL olsaydi bu gecisten ONCEKI hesaplar yazilamaz hale gelirdi.
    expect(sql).not.toMatch(/created_by_user_id\s+uuid\s+NOT NULL/i);
  });

  it("kullanici silinirse hesap SILINMEZ, yalnizca atif duser", () => {
    expect(sql).toContain("REFERENCES app_users (user_id)");
    expect(sql).toContain("ON DELETE SET NULL");
    expect(sql).not.toMatch(/ON DELETE CASCADE/i);
  });

  it("imzali sutunlarin hicbirine dokunmaz", () => {
    for (const signed of [
      "debts_root",
      "recipient_signature",
      "recipient_address",
      "bill_id",
    ]) {
      expect(sql, signed).not.toMatch(
        new RegExp(`(ALTER|DROP)\\s+COLUMN\\s+${signed}`, "i"),
      );
    }
  });
});
