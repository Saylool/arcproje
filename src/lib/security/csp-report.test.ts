import { existsSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createCspReportPost } from "@/app/api/csp-report/route";

import { parseCspReport, toOrigin } from "./csp-report";
import {
  CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY_REPORT_ONLY,
  CSP_REPORT_PATH,
} from "./headers";

/**
 * CSP IHLAL RAPORLARI.
 *
 * Bu ucun varlik sebebi olculebilirlik: `connect-src` engelleyici olmadan
 * once tarayicinin GERCEKTEN nereye bagladigini bilmemiz gerekiyor ve
 * telefonda konsola bakmak neredeyse imkansiz.
 *
 * En onemli kisit GIZLILIK. Rapor gövdesi sayfanin TAM ADRESINI tasir; ortak
 * hesap adresleri `billId` icerir ve o baglantiyi bilen herkes hesabi acabilir.
 * Gunluge yazmak onu sizdirmak olurdu.
 */

function request(body: unknown, asText?: string): Request {
  return new Request("https://ornek.invalid/api/csp-report", {
    method: "POST",
    body: asText ?? JSON.stringify(body),
  });
}

const LEGACY = {
  "csp-report": {
    "document-uri":
      "https://ornek.invalid/pay/0xGIZLI_BILL_ID_BURADA_OLMAMALI",
    referrer: "https://baska.invalid/gizli",
    "violated-directive": "connect-src",
    "blocked-uri": "https://rpc.testnet.arc.network/gizli/yol?anahtar=deger",
    disposition: "report",
  },
};

describe("ayristirma: iki bicim de anlasilir", () => {
  it("eski report-uri bicimi", () => {
    expect(parseCspReport(LEGACY)).toEqual({
      directive: "connect-src",
      origin: "https://rpc.testnet.arc.network",
      disposition: "report",
    });
  });

  it("Reporting API bicimi (dizi)", () => {
    const report = parseCspReport([
      {
        type: "csp-violation",
        body: {
          documentURL: "https://ornek.invalid/pay/0xGIZLI",
          effectiveDirective: "script-src-elem",
          blockedURL: "https://kotu.invalid/x.js",
          disposition: "enforce",
        },
      },
    ]);
    expect(report).toEqual({
      directive: "script-src-elem",
      origin: "https://kotu.invalid",
      disposition: "enforce",
    });
  });

  it("taninmayan yuk SESSIZCE atilir", () => {
    for (const junk of [null, 42, "metin", {}, [], { body: {} }, { "csp-report": {} }]) {
      expect(parseCspReport(junk)).toBeNull();
    }
  });

  it("yonerge ya da adres eksikse rapor sayilmaz", () => {
    expect(
      parseCspReport({ "csp-report": { "violated-directive": "connect-src" } }),
    ).toBeNull();
    expect(
      parseCspReport({ "csp-report": { "blocked-uri": "https://a.invalid" } }),
    ).toBeNull();
  });
});

describe("gizlilik: adres KOKENINE indirgenir", () => {
  it("yol ve sorgu ATILIR", () => {
    /* Yol ve sorgu kimlik tasiyabilir; kokende o risk yok. */
    expect(toOrigin("https://a.invalid/gizli/yol?anahtar=deger")).toBe(
      "https://a.invalid",
    );
  });

  it("anahtar kelimeler oldugu gibi kalir", () => {
    /* Bunlar adres degil ve kisisel veri tasimazlar. */
    for (const keyword of ["inline", "eval", "data", "wasm-eval"]) {
      expect(toOrigin(keyword)).toBe(keyword);
    }
  });

  it("ayristirilamayan dizge ATILIR", () => {
    /* Tanimadigimiz bir seyi gunluge yazmayiz. */
    expect(toOrigin("boyle bir sey degil")).toBeNull();
    expect(toOrigin("")).toBeNull();
    expect(toOrigin(null)).toBeNull();
  });
});

describe("uc: yalnizca gunluge yazar", () => {
  const okBody = async () => ({
    status: "ok" as const,
    text: JSON.stringify(LEGACY),
  });

  it("SAYFANIN ADRESI gunluge YAZILMAZ", async () => {
    /*
     * Bu testin dustugu gun, ortak hesap baglantilari sunucu gunluklerine
     * sizmis demektir.
     */
    const log = vi.fn();
    const POST = createCspReportPost({ readBody: okBody, log });

    await POST(request(LEGACY));

    const line = log.mock.calls[0]?.[0] ?? "";
    expect(line).not.toContain("GIZLI_BILL_ID");
    expect(line).not.toContain("/pay/");
    expect(line).not.toContain("baska.invalid");
  });

  it("yonergeyi ve KOKENI yazar", async () => {
    const log = vi.fn();
    const POST = createCspReportPost({ readBody: okBody, log });

    await POST(request(LEGACY));

    const line = log.mock.calls[0]?.[0] ?? "";
    expect(line).toContain("connect-src");
    expect(line).toContain("https://rpc.testnet.arc.network");
    /* Engellenen adresin YOLU da yazilmaz. */
    expect(line).not.toContain("/gizli/yol");
  });

  it("her yolda 204 doner", async () => {
    const cases: { text: string }[] = [
      { text: JSON.stringify(LEGACY) },
      { text: "{ bozuk json" },
      { text: "{}" },
      { text: "" },
    ];
    for (const body of cases) {
      const POST = createCspReportPost({
        readBody: async () => ({ status: "ok" as const, text: body.text }),
        log: vi.fn(),
      });
      expect((await POST(request(null, body.text))).status).toBe(204);
    }
  });

  it("bozuk ya da tanınmayan yuk icin HIC yazilmaz", async () => {
    for (const text of ["{ bozuk", "{}", "[]", "null"]) {
      const log = vi.fn();
      const POST = createCspReportPost({
        readBody: async () => ({ status: "ok" as const, text }),
        log,
      });
      await POST(request(null, text));
      expect(log).not.toHaveBeenCalled();
    }
  });

  it("gövde sinira takilirsa HIC yazilmaz", async () => {
    const log = vi.fn();
    const POST = createCspReportPost({
      readBody: async () => ({ status: "tooLarge" as const }),
      log,
    });

    expect((await POST(request(LEGACY))).status).toBe(204);
    expect(log).not.toHaveBeenCalled();
  });

  it("yanit ONBELLEGE ALINMAZ", async () => {
    const POST = createCspReportPost({ readBody: okBody, log: vi.fn() });
    const response = await POST(request(LEGACY));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("politika gercek uca isaret eder", () => {
  it("iki politika da rapor adresini tasir", () => {
    expect(CONTENT_SECURITY_POLICY).toContain(`report-uri ${CSP_REPORT_PATH}`);
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain(
      `report-uri ${CSP_REPORT_PATH}`,
    );
  });

  it("adres GERCEKTEN var olan bir rotadir", () => {
    /* Olmayan bir adrese rapor gondermek, olcumu sessizce bosa cikarirdi. */
    expect(CSP_REPORT_PATH).toBe("/api/csp-report");
    expect(existsSync("src/app/api/csp-report/route.ts")).toBe(true);
  });
});
