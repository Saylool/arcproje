import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SHARED_BILL_ACCESS_MAX_LIFETIME_MS } from "@/lib/arc/shared-bill-access";
import { SHARED_BILL_MAX_LIFETIME_MS } from "@/lib/arc/shared-bill";
import { SHARED_BILL_SESSION_LIFETIME_MS } from "@/lib/db/shared-bill-access-service";
import { LOCALE_COOKIE_MAX_AGE_SECONDS, LOCALES } from "@/lib/i18n/locale";
import { QUOTE_LIFETIME_MS } from "@/lib/rates/quote";
import {
  DISCLOSED_HOSTS,
  POLICY_DURATIONS,
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_POLICY,
  SESSION_MINUTES,
} from "./privacy";
import type { PolicyBlock, PrivacyPolicy } from "./privacy-types";

/**
 * GİZLİLİK POLİTİKASININ SÖZLEŞMESİ.
 *
 * Bir gizlilik politikası yanlışsa yoktan kötüdür. Buradaki testler metnin
 * kodla AYNI şeyi söylediğini ölçer: süreler sabitlerden gelir, dışarıya
 * bağlanan her servis metinde geçer, ve yumuşatılması en muhtemel iki sınır
 * (zincirin kalıcılığı, süresi dolan kaydın silinmemesi) yerinde durur.
 */

const source = readFileSync("src/lib/legal/privacy.ts", "utf8");

function allBlocks(policy: PrivacyPolicy): PolicyBlock[] {
  return policy.sections.flatMap((section) => [...section.blocks]);
}

function sectionText(policy: PrivacyPolicy, id: string): string {
  const section = policy.sections.find((s) => s.id === id);
  if (section === undefined) {
    throw new Error(`bölüm yok: ${id}`);
  }
  return section.blocks
    .flatMap((block) => {
      if (block.kind === "paragraph" || block.kind === "warning") return [block.text];
      if (block.kind === "list") return [...block.items];
      return [...block.head, ...block.rows.flat()];
    })
    .join("\n");
}

function policyText(policy: PrivacyPolicy): string {
  const parts = [policy.title, policy.intro];
  for (const section of policy.sections) {
    parts.push(section.heading);
    for (const block of section.blocks) {
      if (block.kind === "paragraph" || block.kind === "warning") {
        parts.push(block.text);
      } else if (block.kind === "list") {
        parts.push(...block.items);
      } else {
        parts.push(...block.head, ...block.rows.flat());
      }
    }
  }
  return parts.join("\n");
}

/** Testler ve `node_modules` dışında kalan tüm kaynak. */
function sourceFiles(dir = "src"): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) {
      found.push(path);
    }
  }
  return found;
}

describe("iki dil AYNI belgeyi anlatır", () => {
  const [first, ...rest] = LOCALES.map((locale) => PRIVACY_POLICY[locale]);

  it("bölümler aynı kimliklerle ve aynı SIRADA gelir", () => {
    const ids = first.sections.map((s) => s.id);
    expect(new Set(ids).size, "kimlikler benzersiz olmalı").toBe(ids.length);
    for (const policy of rest) {
      expect(policy.sections.map((s) => s.id)).toEqual(ids);
    }
  });

  it("her bölümde aynı türde bloklar aynı sırada bulunur", () => {
    const shape = first.sections.map((s) => s.blocks.map((b) => b.kind));
    for (const policy of rest) {
      expect(policy.sections.map((s) => s.blocks.map((b) => b.kind))).toEqual(shape);
    }
  });

  it("tablolar aynı biçimdedir", () => {
    const tableShape = (p: PrivacyPolicy) =>
      allBlocks(p)
        .filter((b) => b.kind === "table")
        .map((b) => ({ cols: b.head.length, rows: b.rows.map((r) => r.length) }));
    for (const policy of rest) {
      expect(tableShape(policy)).toEqual(tableShape(first));
    }
  });

  it("hiçbir dilde BOŞ metin yoktur", () => {
    for (const locale of LOCALES) {
      const policy = PRIVACY_POLICY[locale];
      expect(policy.title.trim(), locale).not.toBe("");
      expect(policy.intro.trim(), locale).not.toBe("");
      for (const line of policyText(policy).split("\n")) {
        expect(line.trim(), locale).not.toBe("");
      }
    }
  });

  it("yürürlük tarihi iki dilde de aynı ve geçerlidir", () => {
    for (const locale of LOCALES) {
      expect(PRIVACY_POLICY[locale].effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(PRIVACY_POLICY[locale].effectiveDate).toBe(first.effectiveDate);
    }
  });
});

describe("dışarı bağlanan HER servis metinde geçer", () => {
  it("kaynak kodda geçen her dış alan adı bildirilmiştir", () => {
    /*
     * Bu testin amacı: yeni bir servise bağlanan kod, politikayı
     * güncellemeden geçemesin.
     */
    const hosts = new Set<string>();
    for (const file of sourceFiles()) {
      for (const match of readFileSync(file, "utf8").matchAll(
        /https?:\/\/([a-zA-Z0-9.-]+)/g,
      )) {
        const host = match[1].toLowerCase();
        if (host !== "localhost") {
          hosts.add(host);
        }
      }
    }
    expect(hosts.size).toBeGreaterThan(0);
    for (const host of hosts) {
      expect(DISCLOSED_HOSTS, `${host} politikada bildirilmemiş`).toContain(host);
    }
  });

  it("kütüphaneden gelen, kaynakta görünmeyen taraflar da bildirilmiştir", () => {
    // Grep bunları bulamaz: SDK'ların ve barındırmanın içinden gelirler.
    for (const host of [
      "api.openai.com",
      "accounts.google.com",
      "relay.walletconnect.org",
      "neon.tech",
      "vercel.com",
    ]) {
      expect(DISCLOSED_HOSTS).toContain(host);
    }
  });
});

describe("süreler koddan gelir", () => {
  it("her süre koddaki SABİTİN karşılığıdır", () => {
    /*
     * Sabiti yalnızca içe aktarmış olmak yetmez — elle yazılmış bir sayı da
     * o içe aktarmanın yanında durabilir. Türetilen değerler karşılaştırılır.
     */
    expect(POLICY_DURATIONS.billDays).toBe(
      SHARED_BILL_MAX_LIFETIME_MS / (24 * 60 * 60 * 1000),
    );
    expect(POLICY_DURATIONS.accessMinutes).toBe(
      SHARED_BILL_ACCESS_MAX_LIFETIME_MS / 60000,
    );
    expect(POLICY_DURATIONS.quoteMinutes).toBe(QUOTE_LIFETIME_MS / 60000);
    expect(POLICY_DURATIONS.cookieDays).toBe(
      LOCALE_COOKIE_MAX_AGE_SECONDS / (24 * 60 * 60),
    );
    // Değer eşitliği yetmez: aynı sayıyı elle yazan bir değişikliği ayırt
    // edemez. Türetimin sabite dayandığı kaynakta da aranır.
    expect(source).toContain("billDays: SHARED_BILL_MAX_LIFETIME_MS /");
    expect(source).toContain("accessMinutes: SHARED_BILL_ACCESS_MAX_LIFETIME_MS /");
    expect(source).toContain("quoteMinutes: QUOTE_LIFETIME_MS /");
    expect(source).toContain("cookieDays: LOCALE_COOKIE_MAX_AGE_SECONDS /");
    for (const literal of ["7 gün", "7 days", "365 gün", "365 days"]) {
      expect(source, literal).not.toContain(literal);
    }
  });

  it("borçlu oturumunun süresi koddaki sabitle aynıdır", () => {
    expect(SESSION_MINUTES).toBe(SHARED_BILL_SESSION_LIFETIME_MS / 60000);
  });

  it("metinde yazan süreler sabitlerin karşılığıdır", () => {
    const days = SHARED_BILL_MAX_LIFETIME_MS / (24 * 60 * 60 * 1000);
    const accessMinutes = SHARED_BILL_ACCESS_MAX_LIFETIME_MS / 60000;
    const quoteMinutes = QUOTE_LIFETIME_MS / 60000;

    expect(policyText(PRIVACY_POLICY.tr)).toContain(`${days} gün`);
    expect(policyText(PRIVACY_POLICY.en)).toContain(`${days} days`);
    expect(policyText(PRIVACY_POLICY.tr)).toContain(`${accessMinutes} dakika`);
    expect(policyText(PRIVACY_POLICY.en)).toContain(`${quoteMinutes} minutes`);
  });
});

describe("yumuşatılmaması gereken iki sınır", () => {
  it("zincirin KALICI ve HERKESE AÇIK olduğu söylenir", () => {
    const trText = policyText(PRIVACY_POLICY.tr);
    expect(trText).toContain("KALICI");
    expect(trText).toContain("silme hakkın oraya ulaşmaz");
    expect(policyText(PRIVACY_POLICY.en)).toContain("permanently");
  });

  it("süresi dolan kaydın SİLİNMEDİĞİ söylenir", () => {
    /*
     * Kodda `shared_bills` için hiçbir silme yolu yok; "otomatik silinir"
     * demek yanlış beyan olurdu. Bu testin düşmesi metnin gerçekten
     * yumuşatıldığı anlamına gelir.
     */
    expect(policyText(PRIVACY_POLICY.tr)).toContain("otomatik olarak SİLİNMEZ");
    expect(policyText(PRIVACY_POLICY.en)).toContain("NOT deleted automatically");
  });

  it("test ağı uyarısı KENDİ bölümünde durur", () => {
    // Özet listesinde de geçiyor; uyarının kendisinin silinmesi oradan
    // gizlenmemeli.
    expect(sectionText(PRIVACY_POLICY.tr, "test-agi")).toContain(
      "parasal değeri yoktur",
    );
    expect(sectionText(PRIVACY_POLICY.en, "test-agi")).toContain(
      "no monetary value",
    );
  });
});

describe("sorumlu ve iletişim", () => {
  it("adres, SORUMLU bölümünün kendisinde yazar", () => {
    // Metnin herhangi bir yerinde geçmesi yetmez: veri sorumlusunu arayan
    // kişi onu sorumlu bölümünde bulmalı.
    expect(PRIVACY_CONTACT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    for (const locale of LOCALES) {
      expect(sectionText(PRIVACY_POLICY[locale], "sorumlu"), locale).toContain(
        PRIVACY_CONTACT_EMAIL,
      );
    }
  });

  it("KVKK ve GDPR hakları sayılır", () => {
    for (const locale of LOCALES) {
      const text = policyText(PRIVACY_POLICY[locale]);
      expect(text, locale).toContain("KVKK");
      expect(text, locale).toContain("GDPR");
    }
  });
});

describe("sayfa ve altbilgi", () => {
  it("politika sayfası metnin KENDİSİNİ barındırmaz", () => {
    // Sayfa yalnızca çizer; cümleler tek kaynakta durur.
    const page = readFileSync("src/app/privacy/page.tsx", "utf8");
    expect(page).toContain("PRIVACY_POLICY[locale]");
    expect(page).not.toContain("KVKK");
  });

  it("altbilgi politikaya bağlanır", () => {
    const footer = readFileSync("src/components/SiteFooter.tsx", "utf8");
    expect(footer).toContain('href="/privacy"');
  });

  it("altbilgi her sayfada çizilir", () => {
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain("<SiteFooter />");
  });
});
