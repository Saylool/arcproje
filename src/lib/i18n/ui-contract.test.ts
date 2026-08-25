import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { flattenKeys } from "./dictionary";
import { tr } from "./tr";

/**
 * ARAYÜZ SÖZLEŞMESİ — i18n.
 *
 * Depoda bileşen testi altyapısı yoktur (vitest `node` ortamında çalışır), bu
 * yüzden DOM davranışı kaynak düzeyinde ve tarayıcı doğrulamasıyla kontrol
 * edilir. Buradaki testler, ileride kolayca bozulabilecek şu güvenceleri
 * kilitler: sabit metin sızmaması, dilin sunucuda çözülmesi, temadan
 * bağımsızlık, URL'lerin değişmemesi ve kriptografik yüklerin dile
 * bağlanmaması.
 */

const read = (path: string) => readFileSync(path, "utf8");

/** Yorumlar SÖZLEŞME DEĞİLDİR: bir kuralı anlatan yorum onu ihlal etmez. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
}

const COMPONENT_FILES = [
  "src/components/AppHeader.tsx",
  "src/components/AssignmentSummary.tsx",
  "src/components/DebtSummary.tsx",
  "src/components/LanguageSelect.tsx",
  "src/components/ParticipantAssignment.tsx",
  "src/components/PayPageChrome.tsx",
  "src/components/PaymentRequestCreator.tsx",
  "src/components/PaymentRequestPayer.tsx",
  "src/components/ProgressSteps.tsx",
  "src/components/ReceiptEditor.tsx",
  "src/components/ReceiptFlow.tsx",
  "src/components/ReceiptUploader.tsx",
  "src/components/SharedBillCreator.tsx",
  "src/components/SharedBillDebtorView.tsx",
  "src/components/SharedBillPaymentPanel.tsx",
  "src/components/ThemeToggle.tsx",
  "src/app/page.tsx",
  "src/app/pay/page.tsx",
  "src/app/pay/[billId]/page.tsx",
  "src/app/layout.tsx",
];

/** Yorumları ve JSX ifadelerini çıkarır; geriye SABİT metin kalır. */
function stripCode(source: string): string {
  return withoutComments(source)
    // JSX ifadeleri (`{t("...")}` dâhil) sabit metin değildir.
    .replace(/\{(?:[^{}]|\{[^{}]*\})*\}/g, "{}");
}

/**
 * Aday gerçekten METİN mi, yoksa kod mu?
 *
 * `useState<Foo>(null)` gibi tip parametreleri de `>` ve `<` arasında metin
 * bırakır. Gerçek arayüz cümlesi noktalı virgül, atama ya da parantez
 * içermez; bunlar görüldüğünde aday koddur ve elenir.
 */
function looksLikeCode(text: string): boolean {
  return /[;=()[\]]|=>|\bconst\b|\breturn\b/.test(text);
}

/**
 * Görünür SABİT metin adayları.
 *
 * İki yer taranır: JSX metin düğümleri ve kullanıcıya okunan öznitelikler.
 * Sınıf adları, içe aktarmalar ve protokol sabitleri taranmaz.
 */
function hardcodedText(source: string): string[] {
  const code = stripCode(source);
  const found: string[] = [];

  for (const match of code.matchAll(/>([^<>{}]+)</g)) {
    const text = match[1].replace(/\s+/g, " ").trim();
    if (text === "") continue;
    // İki ya da daha çok harf dizisi = cümle adayı.
    if (looksLikeCode(text)) continue;
    const words = text.match(/[A-Za-zÇĞİÖŞÜçğıöşü]{2,}/g) ?? [];
    if (words.length >= 2) found.push(text);
  }

  for (const match of code.matchAll(
    /\b(?:aria-label|placeholder|title|alt|aria-description)="([^"]+)"/g,
  )) {
    found.push(match[1]);
  }

  return found;
}

describe("bileşenlerde SABİT kullanıcı metni kalmadı", () => {
  it("hiçbir bileşende çevrilmemiş cümle yoktur", () => {
    const offenders: string[] = [];
    for (const file of COMPONENT_FILES) {
      for (const text of hardcodedText(read(file))) {
        offenders.push(`${file}: ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("bileşenler `useTranslator` ya da `t(` kullanır", () => {
    for (const file of COMPONENT_FILES) {
      const source = read(file);
      if (file.endsWith("layout.tsx")) continue; // yalnızca sağlayıcıyı kurar
      /*
       * Sunucu sayfaları metni doğrudan basmaz: çeviriyi `AppHeader` gibi
       * istemci yaprakları yapar. İkisinden biri yeterlidir.
       */
      expect(source, file).toMatch(/useTranslator|translate\(|<AppHeader/);
    }
  });

  it("çeviri metni HİÇBİR yerde HTML olarak basılmaz", () => {
    for (const file of COMPONENT_FILES) {
      const source = read(file);
      const matches = source.match(/dangerouslySetInnerHTML=\{\{[^}]*\}\}/g) ?? [];
      for (const usage of matches) {
        /*
         * Tek izinli kullanımlar: QR kodunun YERELDE üretilmiş SVG'si ve tema
         * başlatma betiği. İkisi de sözlükten gelmez.
         */
        expect(usage, `${file}: ${usage}`).toMatch(/qrSvg|THEME_INIT_SCRIPT/);
      }
    }
  });
});

describe("dil SUNUCUDA çözülür", () => {
  const layout = read("src/app/layout.tsx");

  it("`<html lang>` çözülen dille yazılır", () => {
    expect(layout).toContain("resolveRequestLocale");
    expect(layout).toContain("<html lang={locale}");
  });

  it("sağlayıcı AYNI değerle kurulur: sunucu ve istemci ayrışamaz", () => {
    expect(layout).toContain("<LocaleProvider initialLocale={locale}>");
  });

  it("dil için ERKEN BAŞLATMA BETİĞİ yoktur: metin zaten sunucuda basılır", () => {
    // Tek betik temaya aittir.
    expect(layout.match(/dangerouslySetInnerHTML/g) ?? []).toHaveLength(1);
    expect(layout).toContain("THEME_INIT_SCRIPT");
  });

  it("sağlayıcı çocukları `key` ile SÖKMEZ: durum korunur", () => {
    const provider = read("src/lib/i18n/context.tsx");
    expect(provider).toContain("<LocaleContext.Provider value={value}>");
    // Dil değişince yalnızca bağlam değeri değişir; ağaç yeniden kurulmaz.
    expect(provider).not.toMatch(/key=\{locale\}/);
  });
});

describe("dil ve TEMA birbirinden bağımsızdır", () => {
  const localeContext = withoutComments(read("src/lib/i18n/context.tsx"));
  const localeCore = withoutComments(read("src/lib/i18n/locale.ts"));
  const theme = withoutComments(read("src/lib/theme/theme.ts"));

  it("dil kodu tema deposuna DOKUNMAZ", () => {
    for (const forbidden of ["hb-theme", "localStorage", "data-theme", "colorScheme"]) {
      expect(localeContext, forbidden).not.toContain(forbidden);
      expect(localeCore, forbidden).not.toContain(forbidden);
    }
  });

  it("tema kodu dil çerezine DOKUNMAZ", () => {
    for (const forbidden of ["hb_locale", "document.cookie", "lang"]) {
      expect(theme, forbidden).not.toContain(forbidden);
    }
  });

  it("iki tercih AYRI kanallarda yaşar", () => {
    // Dil: çerez (sunucu okuyabilmeli). Tema: localStorage (yalnızca istemci).
    expect(localeContext).toContain("document.cookie");
    expect(theme).toContain("localStorage");
  });
});

describe("URL'ler ve rotalar DEĞİŞMEDİ", () => {
  it("dil yol ön eki YOKTUR", () => {
    for (const file of [...COMPONENT_FILES, "src/lib/i18n/server.ts"]) {
      const source = withoutComments(read(file));
      expect(source, file).not.toMatch(/["'`]\/(?:tr|en)(?:\/|["'`])/);
    }
  });

  it("orta katman (middleware) eklenmedi: yönlendirme yok", () => {
    for (const path of ["src/middleware.ts", "middleware.ts"]) {
      let exists = true;
      try {
        readFileSync(path, "utf8");
      } catch {
        exists = false;
      }
      expect(exists, path).toBe(false);
    }
  });

  it("paylaşılan hesap yolu değişmedi", () => {
    const sharedBill = read("src/lib/arc/shared-bill.ts");
    expect(sharedBill).toContain('SHARED_BILL_ROUTE = "/pay"');
  });
});

describe("KRİPTOGRAFİK yükler dile bağlanamaz", () => {
  const CRYPTO_FILES = [
    "src/lib/arc/shared-bill.ts",
    "src/lib/arc/shared-bill-merkle.ts",
    "src/lib/arc/shared-bill-signing.ts",
    "src/lib/arc/shared-bill-access.ts",
    "src/lib/arc/payment-request.ts",
    "src/lib/arc/request-signing.ts",
    "src/lib/arc/request-codec.ts",
    "src/lib/arc/minor-units.ts",
    "src/lib/arc/conversion.ts",
    "src/lib/rates/quote-auth.ts",
    "src/lib/db/shared-bill-auth.ts",
  ];

  it("imzalanan/karma alınan hiçbir yapı `locale` alanı taşımaz", () => {
    for (const file of CRYPTO_FILES) {
      const source = withoutComments(read(file));
      /*
       * `locale` YALNIZCA bir gösterim parametresi olarak geçebilir
       * (`locale: Locale = DEFAULT_LOCALE`). İmzalanan ya da karma alınan bir
       * NESNE ALANI olarak geçemez.
       */
      for (const usage of source.match(/\blocale\s*:[^,)\n]*/g) ?? []) {
        expect(usage, `${file}: ${usage}`).toMatch(/locale\s*:\s*Locale/);
      }
      expect(source, file).not.toContain("hb_locale");
    }
  });

  it("EIP-712 tip tanımları ve alan adları dilden bağımsızdır", () => {
    const sharedBill = read("src/lib/arc/shared-bill.ts");
    const typeBlock = sharedBill.slice(
      sharedBill.indexOf("SHARED_BILL_TYPES"),
      sharedBill.indexOf("SHARED_BILL_TYPES") + 1500,
    );
    expect(typeBlock).not.toMatch(/locale|language|dil\b/i);
  });

  it("imzalanan etiketlerin yedek adı DİLDEN BAĞIMSIZDIR", () => {
    /*
     * Yedek ad sözlükten GELMEZ: her akış kendi BAYT SABİTİNİ kullanır
     * (bkz. `signed-label-stability.test.ts`).
     */
    for (const [file, constantName] of [
      [
        "src/components/SharedBillCreator.tsx",
        "SHARED_BILL_UNKNOWN_PARTICIPANT_LABEL",
      ],
      [
        "src/components/PaymentRequestCreator.tsx",
        "PAYMENT_REQUEST_UNKNOWN_PARTICIPANT_LABEL",
      ],
    ] as const) {
      const source = read(file);
      expect(source, file).toContain(constantName);
      // İmza yedeği ÇEVİRİ çağrısıyla kurulamaz.
      const start = source.indexOf("const signingNameOf");
      const body = source.slice(start, source.indexOf("[participants],", start));
      expect(body, file).toContain(constantName);
      expect(body, file).not.toMatch(/\bt\(|translate\(|useTranslator/);

      // `prepareLabel` çağrıları YALNIZCA dilden bağımsız adı kullanır.
      for (const call of source.match(/prepareLabel\([\s\S]{0,120}?\)/g) ?? []) {
        expect(call, `${file}: ${call}`).not.toContain('t("common');
        expect(call, `${file}: ${call}`).toMatch(/signingNameOf|row\.name/);
      }
    }
  });

  it("gönderim anlık görüntüsü protokol biçimlendiricilerini kullanır", () => {
    const payer = read("src/components/PaymentRequestPayer.tsx");
    const snapshot = payer.slice(
      payer.indexOf("const snapshot: ArcPaymentSnapshot"),
      payer.indexOf("}, [request]);"),
    );
    // Dile duyarlı biçimlendirici anlık görüntüye GİREMEZ.
    expect(snapshot).toContain("formatMicroUsdcAmount(micro)");
    expect(snapshot).toContain("formatMicroUsdcForDisplay(micro)");
    expect(snapshot).not.toContain("formatUsdcAmount");
    expect(snapshot).not.toContain("locale");
  });

  it("teklif doğrulaması protokol metinlerini yeniden üretir", () => {
    const client = read("src/lib/arc/shared-bill-payment-client.ts");
    expect(client).toContain("record.amount !== formatMicroUsdcAmount(declared)");
    expect(client).toContain(
      "record.displayAmount !== formatMicroUsdcForDisplay(declared)",
    );
    // Bu dosya dile duyarlı biçimlendirmeyi hiç kullanmaz.
    expect(client).not.toContain("formatUsdcAmount");
  });
});

describe("dil seçicisi", () => {
  const select = read("src/components/LanguageSelect.tsx");

  it("YERLİ bir denetimdir: klavye ve ekran okuyucu bedava gelir", () => {
    expect(select).toContain("<select");
    expect(select).toContain("<option");
  });

  it("erişilebilir etiket ÇEVRİLİR", () => {
    expect(select).toContain('t("language.label")');
    expect(select).toContain("aria-label={label}");
    expect(select).toContain("<label htmlFor={selectId}");
    expect(tr.language.label).toBe("Dil seçimi");
  });

  it("dil adları KENDİ dillerinde yazılır, bayrak kullanılmaz", () => {
    expect(tr.language.tr).toBe("Türkçe");
    expect(tr.language.en).toBe("English");
    expect(select).not.toMatch(/🇹🇷|🇬🇧|🇺🇸|flag/i);
  });

  it("odak halkası ve tema belirteçleri kullanılır", () => {
    expect(select).toContain("focus-visible:outline");
    expect(select).toContain("border-line");
    expect(select).toContain("bg-card");
    // Sabit açık tema rengi YOKTUR.
    expect(select).not.toMatch(/bg-white|text-black|bg-gray-\d/);
  });

  it("başlıkta tema anahtarının YANINDA durur", () => {
    const header = read("src/components/AppHeader.tsx");
    expect(header).toContain("<LanguageSelect />");
    expect(header).toContain("<ThemeToggle />");
    expect(header.indexOf("<LanguageSelect />")).toBeLessThan(
      header.indexOf("<ThemeToggle />"),
    );
  });

  it("HER kullanıcı sayfasında bulunur", () => {
    for (const page of [
      "src/app/page.tsx",
      "src/app/pay/page.tsx",
      "src/app/pay/[billId]/page.tsx",
    ]) {
      expect(read(page), page).toContain("<AppHeader");
    }
  });
});

describe("sözlük kapsamı", () => {
  it("her bölüm doludur", () => {
    const keys = flattenKeys(tr);
    for (const section of [
      "app",
      "language",
      "theme",
      "metadata",
      "common",
      "wallet",
      "progress",
      "flow",
      "upload",
      "editor",
      "participants",
      "assignmentSummary",
      "debts",
      "sharedBill",
      "sharedPay",
      "request",
      "payer",
      "errors",
      "plurals",
    ]) {
      expect(
        keys.filter((key) => key.startsWith(`${section}.`)).length,
        section,
      ).toBeGreaterThan(0);
    }
  });

  it("İNGİLİZCE terimler tutarlıdır", () => {
    const dictionary = readFileSync("src/lib/i18n/en.ts", "utf8");
    // Rolleri tersine çevirebilecek belirsiz "payer" kullanımı yoktur.
    expect(dictionary).not.toMatch(/\bthe payer\b/);
    expect(dictionary).not.toMatch(/\bpayer's wallet address\b/);
    // Zorunlu terimler kullanılır.
    expect(dictionary).toContain("Split the Bill");
    expect(dictionary).toContain("bill payer");
    expect(dictionary).toContain("Debtor");
    expect(dictionary).toContain("Recipient");
    expect(dictionary).toContain("Participants");
  });
});
