import { describe, expect, it } from "vitest";

import {
  isKnownApiErrorCode,
  localizeApiError,
  readApiErrorCode,
} from "./api-errors";
import { translate } from "./dictionary";
import { LOCALES } from "./locale";
import {
  messageApi,
  messageKey,
  messageRate,
  resolveMessage,
} from "./messages";
import { tr } from "./tr";

/**
 * SUNUCU HATALARININ SUNUM SINIRI.
 *
 * Sözleşme: KOD makine okunur ve değişmez; METİN istemcide, etkin dilde
 * seçilir. Sunucunun gövdesindeki hazır cümle EKRANA BASILMAZ.
 */

const API_CODES = Object.keys(tr.errors.api);

describe("kod okuma", () => {
  it("`{ error: { code } }` sözleşmesinden kodu okur", () => {
    expect(readApiErrorCode({ error: { code: "NOT_AVAILABLE" } })).toBe(
      "NOT_AVAILABLE",
    );
  });

  it("MESAJI okumaz", () => {
    // Yalnızca kod taşınır; sunucunun metni bilerek yok sayılır.
    const payload = { error: { code: "MALFORMED_JSON", message: "gizli" } };
    expect(readApiErrorCode(payload)).toBe("MALFORMED_JSON");
    for (const locale of LOCALES) {
      expect(localizeApiError(locale, readApiErrorCode(payload))).not.toContain(
        "gizli",
      );
    }
  });

  it("bozuk gövdede kod yoktur", () => {
    for (const payload of [
      null,
      undefined,
      42,
      "metin",
      {},
      { error: null },
      { error: {} },
      { error: { code: "" } },
      { error: { code: 7 } },
      { error: { message: "yalnizca metin" } },
    ]) {
      expect(readApiErrorCode(payload), JSON.stringify(payload)).toBeNull();
    }
  });
});

describe("bilinen kodların yerelleştirilmesi", () => {
  it("her kod iki dilde de bir cümleye çözülür", () => {
    expect(API_CODES.length).toBeGreaterThan(30);
    for (const code of API_CODES) {
      for (const locale of LOCALES) {
        const message = localizeApiError(locale, code);
        expect(message.trim(), `${locale}:${code}`).not.toBe("");
        // Kodun kendisi kullanıcıya gösterilmez.
        expect(message, `${locale}:${code}`).not.toContain(code);
      }
    }
  });

  it("dil değişince mesaj da değişir", () => {
    expect(localizeApiError("tr", "NOT_AUTHENTICATED")).toBe(
      "Önce cüzdanınla giriş yap.",
    );
    expect(localizeApiError("en", "NOT_AUTHENTICATED")).toBe(
      "Sign in with your wallet first.",
    );
  });

  it("kod tanıma yalnızca sözlükteki kodları kabul eder", () => {
    expect(isKnownApiErrorCode("SESSION_EXPIRED")).toBe(true);
    for (const value of ["session_expired", "NOPE", "", null, undefined, 3]) {
      expect(isKnownApiErrorCode(value), String(value)).toBe(false);
    }
  });
});

describe("BİLİNMEYEN kod: güvenli genel karşılık", () => {
  it("her iki dilde de genel mesaja düşer", () => {
    expect(localizeApiError("tr", "BRAND_NEW_CODE")).toBe(
      translate("tr", "errors.generic"),
    );
    expect(localizeApiError("en", "BRAND_NEW_CODE")).toBe(
      translate("en", "errors.generic"),
    );
  });

  it("kod yoksa da genel mesaja düşer", () => {
    for (const value of [undefined, null, "", 42, {}]) {
      for (const locale of LOCALES) {
        expect(localizeApiError(locale, value), `${locale}:${value}`).toBe(
          translate(locale, "errors.generic"),
        );
      }
    }
  });

  it("genel mesaj HİÇBİR teknik ayrıntı sızdırmaz", () => {
    for (const locale of LOCALES) {
      const generic = translate(locale, "errors.generic");
      expect(generic, locale).not.toMatch(/[A-Z_]{4,}/);
      expect(generic, locale).not.toMatch(/\bhttps?:\/\//);
      expect(generic, locale).not.toMatch(/\b(SQL|stack|null|undefined)\b/i);
    }
  });
});

describe("AÇIĞA VURMA EŞİTLİĞİ", () => {
  /**
   * İngilizce karşılık, Türkçeden DAHA FAZLASINI söylememelidir. Aksi hâlde
   * dil değiştirerek üyelik/varlık bilgisi elde edilebilirdi.
   */
  const SENSITIVE = [
    "NOT_AVAILABLE",
    "NOT_AUTHENTICATED",
    "SESSION_EXPIRED",
    "INVALID_CHALLENGE",
    "INVALID_SIGNATURE",
    "CHALLENGE_ALREADY_USED",
    "DEBT_NOT_CLAIMABLE",
    "SERVICE_NOT_CONFIGURED",
  ];

  it("iki dil de aynı sayıda cümle/olgu taşır", () => {
    for (const code of SENSITIVE) {
      const turkish = localizeApiError("tr", code);
      const english = localizeApiError("en", code);
      const sentences = (text: string) =>
        text.split(/[.!?]+/).filter((part) => part.trim() !== "").length;
      expect(sentences(english), code).toBe(sentences(turkish));
    }
  });

  it("hiçbiri hesabın VAR OLDUĞUNU ya da üyeliği doğrulamaz", () => {
    for (const code of SENSITIVE) {
      for (const locale of LOCALES) {
        const message = localizeApiError(locale, code).toLowerCase();
        for (const leak of [
          "does not exist",
          "not a member",
          "no such bill",
          "bulunmayan hesap",
          "üye değil",
        ]) {
          expect(message, `${locale}:${code}`).not.toContain(leak);
        }
      }
    }
  });

  it("DEBT_NOT_CLAIMABLE eyleme dönük yönlendirmeyi KAYBETMEZ", () => {
    /*
     * Sunucu bu üç durumu (ödendi / süren deneme / sonucu doğrulanamamış)
     * TEK bir kod altında, farklı metinlerle anlatır; istemci koddan hangisi
     * olduğunu ayırt EDEMEZ. Bu yüzden gösterilen metin üçünün de gerektirdiği
     * eylemi taşımalıdır. Özellikle "körlemesine tekrar gönderme" uyarısı
     * kaybolamaz: kaybı çift ödeme riski doğurur.
     */
    for (const locale of LOCALES) {
      const message = localizeApiError(locale, "DEBT_NOT_CLAIMABLE");
      expect(message.length, locale).toBeGreaterThan(60);
      expect(message, locale).toMatch(/ArcScan/);
      expect(message, locale).toMatch(
        locale === "tr" ? /cüzdanının işlem geçmişi/i : /transaction history/i,
      );
      expect(message, locale).toMatch(
        locale === "tr" ? /tekrar göndermeden önce/i : /before sending again/i,
      );
    }
  });

  it("yapılandırma sırları hiçbir dilde gösterilmez", () => {
    for (const locale of LOCALES) {
      const message = localizeApiError(locale, "SERVICE_NOT_CONFIGURED");
      for (const secret of [
        "DATABASE_URL",
        "OPENAI_API_KEY",
        "RATE_QUOTE_SECRET",
        "SHARED_BILL_AUTH_SECRET",
        "APP_ORIGIN",
      ]) {
        expect(message, `${locale}:${secret}`).not.toContain(secret);
      }
    }
  });
});

describe("ertelenmiş mesajlar", () => {
  it("anahtar tarifi etkin dilde çözülür", () => {
    const descriptor = messageKey("wallet.connectRejected");
    expect(resolveMessage("tr", descriptor)).toBe(
      translate("tr", "wallet.connectRejected"),
    );
    expect(resolveMessage("en", descriptor)).toBe(
      translate("en", "wallet.connectRejected"),
    );
    expect(resolveMessage("tr", descriptor)).not.toBe(
      resolveMessage("en", descriptor),
    );
  });

  it("değişkenli tarif korunur", () => {
    const descriptor = messageKey("wallet.switchTo", { network: "Arc Testnet" });
    expect(resolveMessage("en", descriptor)).toContain("Arc Testnet");
  });

  it("API tarifi koddan çözülür", () => {
    expect(resolveMessage("en", messageApi("SESSION_EXPIRED"))).toBe(
      translate("en", "errors.api.SESSION_EXPIRED"),
    );
    expect(resolveMessage("tr", messageApi(undefined))).toBe(
      translate("tr", "errors.generic"),
    );
  });

  it("kur tarifi önce kur sorununa, sonra API koduna bakar", () => {
    expect(resolveMessage("en", messageRate("expired"))).toBe(
      translate("en", "errors.quote.expired"),
    );
    expect(resolveMessage("tr", messageRate("SERVICE_UNAVAILABLE"))).toBe(
      translate("tr", "errors.api.SERVICE_UNAVAILABLE"),
    );
    expect(resolveMessage("en", messageRate("bilinmeyen"))).toBe(
      translate("en", "errors.rateMalformed"),
    );
  });
});
