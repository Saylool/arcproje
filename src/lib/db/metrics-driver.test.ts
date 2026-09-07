import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  buildSharedBillTypedData,
  createSharedBill,
} from "@/lib/arc/shared-bill";

import { createFakeSharedBillRepository } from "./shared-bill-repository.fixture";

/**
 * İŞLETME SAYAÇLARI — sürücü davranışı ve SQL eşleşmesi.
 *
 * İki uygulama vardır: üretimdeki Neon SQL'i ve testlerin kullandığı bellek
 * içi sahte depo. İkisi AYNI kuralı uygulamak zorundadır; aksi hâlde testler
 * yeşil kalırken üretim farklı sayar. Bu depoda tam olarak bu yaşandı.
 *
 * SINIR: burada çalışan bir Postgres YOKTUR, bu yüzden SQL çalıştırılamaz.
 * Eşleşme testleri SQL METNİNİN doğru semantiği kodladığını ölçer.
 */

const NOW = 1_700_000_000_000;
const ADA = "0x0000000000000000000000000000000000000aBc";
const BORA = "0x00000000000000000000000000000000000000De";
const GLOBAL = "@global";
const TODAY = "2023-11-14";

type Repository = ReturnType<typeof createFakeSharedBillRepository>;

/** Ölçüm çağrısının varsayılan eşikleri; her test kendi ilgilendiğini ezer. */
function input(overrides: Partial<Parameters<Repository["readMetrics"]>[0]> = {}) {
  return {
    since24hMs: NOW - 24 * 60 * 60 * 1000,
    since7dMs: NOW - 7 * 24 * 60 * 60 * 1000,
    retentionCutoffMs: NOW,
    quotaDay: TODAY,
    globalQuotaKey: GLOBAL,
    userQuotaLimit: 25,
    providerKey: "coingecko",
    providerWindowFrom: 0,
    providerLimitPerWindow: 4,
    ...overrides,
  };
}

async function writeBill(
  repository: Repository,
  seed: string,
  debtors: { debtor: string; label: string }[],
) {
  const account = privateKeyToAccount(generatePrivateKey());
  const created = createSharedBill({
    recipient: account.address,
    recipientLabel: "Poyraz",
    debts: debtors.map((entry, index) => ({
      debtor: entry.debtor,
      debtorLabel: entry.label,
      debtKey: `${entry.label}->p${index}`,
      tryMinor: "100",
    })),
    nowMs: NOW,
    billId: `0x${seed.repeat(32)}`,
  });
  if (!created.ok) throw new Error(created.problem);
  const typed = buildSharedBillTypedData(created.manifest);
  const signature = await account.signTypedData({
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message,
  });
  const stored = await repository.createSharedBill(
    { manifest: created.manifest, debts: created.debts, signature },
    { createdByUserId: null },
  );
  expect(stored.ok).toBe(true);
  return { billId: created.manifest.billId, expiresAt: created.manifest.expiresAt };
}

/** Borç satırının durumunu doğrudan değiştirir; durum makinesi burada konu değil. */
function setDebtStatus(
  repository: Repository,
  billId: string,
  index: number,
  status: "unpaid" | "reserved" | "paid" | "review_required",
) {
  const bill = repository.bills.get(billId.toLowerCase());
  if (bill === undefined) throw new Error("hesap yok");
  bill.debts[index] = { ...bill.debts[index], paymentStatus: status };
}

describe("olcum: bos depo", () => {
  it("her sey SIFIR doner, hata degil", async () => {
    /*
     * "Hiç yok" ile "okuyamadım" karıştırılmamalı. Boş bir dağıtımda sıfır
     * doğru cevaptır ve bir olay değildir.
     */
    const repository = createFakeSharedBillRepository();
    const outcome = await repository.readMetrics(input());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.counts.users).toEqual({ total: 0, newIn24h: 0, newIn7d: 0 });
    expect(outcome.counts.bills.total).toBe(0);
    expect(outcome.counts.debtsByStatus).toEqual({});
    expect(outcome.counts.attemptsByStatus).toEqual({});
    expect(outcome.counts.analyses.globalUsed).toBe(0);
    expect(outcome.counts.provider.calls).toBe(0);
  });

  it("depo erisilemezse SIFIR demez", async () => {
    /*
     * Erişilemezliği sıfır göstermek en kötü ölçüm hatasıdır: boş bir tabloya
     * bakıp "sorun yok" dedirtir.
     */
    const repository = createFakeSharedBillRepository();
    repository.controls.failWithUnavailable = true;
    expect(await repository.readMetrics(input())).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("olcum: durum kirilimi", () => {
  it("durumlar GERCEK satirlardan sayilir, sabit listeden degil", async () => {
    /*
     * Sabit bir sütun listesi kullanılsaydı, şemaya eklenen yeni bir durum
     * sayımdan sessizce düşerdi. `GROUP BY` onu kendiliğinden gösterir.
     */
    const repository = createFakeSharedBillRepository();
    const bill = await writeBill(repository, "1a", [
      { debtor: ADA, label: "Ada" },
      { debtor: BORA, label: "Bora" },
    ]);
    setDebtStatus(repository, bill.billId, 0, "paid");
    setDebtStatus(repository, bill.billId, 1, "review_required");

    const outcome = await repository.readMetrics(input());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.counts.debtsByStatus).toEqual({
      paid: 1,
      review_required: 1,
    });
    expect(outcome.counts.bills.total).toBe(1);
    expect(outcome.counts.bills.open).toBe(1);
  });
});

describe("olcum: saklama esigi", () => {
  it("SINIRIN KENDISI uygun degildir", async () => {
    /*
     * SQL'de `expires_at < cutoff` KATI küçüktür. Sahte depo gevşek
     * davransaydı, sınırdaki kayıt yalnızca testlerde silinmeye uygun
     * görünürdü.
     */
    const repository = createFakeSharedBillRepository();
    const bill = await writeBill(repository, "2b", [
      { debtor: ADA, label: "Ada" },
    ]);
    const boundary = bill.expiresAt * 1000;

    const atBoundary = await repository.readMetrics(
      input({ retentionCutoffMs: boundary }),
    );
    expect(atBoundary.ok && atBoundary.counts.bills.pastRetention).toBe(0);

    const pastBoundary = await repository.readMetrics(
      input({ retentionCutoffMs: boundary + 1 }),
    );
    expect(pastBoundary.ok && pastBoundary.counts.bills.pastRetention).toBe(1);
  });
});

describe("olcum: analiz kotasi", () => {
  it("genel satir kullanici sayimina KARISMAZ", async () => {
    const repository = createFakeSharedBillRepository();
    repository.analysisQuota.set(`${GLOBAL}|${TODAY}`, 120);
    repository.analysisQuota.set(`user-a|${TODAY}`, 3);
    repository.analysisQuota.set(`user-b|${TODAY}`, 25);

    const outcome = await repository.readMetrics(input());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.counts.analyses.globalUsed).toBe(120);
    expect(outcome.counts.analyses.activeUsers).toBe(2);
    /* `>=`: hakkını TAM dolduran da dolmuş sayılır. */
    expect(outcome.counts.analyses.usersAtCap).toBe(1);
  });

  it("BASKA GUNUN satirlari bugune karismaz", async () => {
    const repository = createFakeSharedBillRepository();
    repository.analysisQuota.set(`${GLOBAL}|2023-11-13`, 999);
    repository.analysisQuota.set(`user-a|2023-11-13`, 10);

    const outcome = await repository.readMetrics(input());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.counts.analyses.globalUsed).toBe(0);
    expect(outcome.counts.analyses.activeUsers).toBe(0);
  });
});

describe("olcum: saglayici butcesi", () => {
  it("yalnizca PENCEREDEN SONRAKI kovalar sayilir", async () => {
    const repository = createFakeSharedBillRepository();
    repository.providerBudget.set("coingecko|100", 4);
    repository.providerBudget.set("coingecko|200", 2);
    repository.providerBudget.set("coingecko|50", 4);
    repository.providerBudget.set("baska|300", 4);

    const outcome = await repository.readMetrics(
      input({ providerWindowFrom: 100 }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    /* 50 numaralı kova pencerenin DIŞINDA, başka sağlayıcı hiç sayılmaz. */
    expect(outcome.counts.provider.calls).toBe(6);
    expect(outcome.counts.provider.windowsAtCap).toBe(1);
  });
});

describe("olcum: KISISEL VERI tasimaz", () => {
  it("sayaclarda adres, hesap kimligi veya kullanici kimligi YOKTUR", async () => {
    /*
     * Bu uç tanımı gereği ayrıcalıklıdır; ayrıcalıklı bir ucun sızdırdığı şey
     * en çok sızan şeydir. Sayım için gereken "kaç tane", "kim" değil.
     */
    const repository = createFakeSharedBillRepository();
    const bill = await writeBill(repository, "3c", [
      { debtor: ADA, label: "Ada" },
    ]);
    repository.appUsers.add("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    repository.analysisQuota.set("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|" + TODAY, 3);

    const outcome = await repository.readMetrics(input());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const serialized = JSON.stringify(outcome.counts).toLowerCase();
    for (const secret of [
      bill.billId.toLowerCase(),
      ADA.toLowerCase(),
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "ada",
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }
  });
});

describe("olcum: SQL ile bellek ici depo AYNI davranmali", () => {
  const neon = readFileSync("src/lib/db/neon-shared-bill-repository.ts", "utf8");

  const NAMES = [
    "METRICS_USERS",
    "METRICS_BILLS",
    "METRICS_DEBTS",
    "METRICS_ATTEMPTS",
    "METRICS_ANALYSES",
    "METRICS_PROVIDER",
  ] as const;

  function sqlBlock(name: string): string {
    const start = neon.indexOf(`const ${name} = \``);
    expect(start, name).toBeGreaterThan(-1);
    const end = neon.indexOf("`;", start);
    return neon.slice(start, end);
  }

  it("alti sorgunun HEPSI vardir", () => {
    for (const name of NAMES) {
      expect(sqlBlock(name).length, name).toBeGreaterThan(0);
    }
  });

  it("hicbiri KIMLIK TASIYAN bir sutuna dokunmaz", () => {
    /*
     * `quota_key` bilerek listede yok: kullanıcı kimliğidir ama yalnızca
     * `FILTER`/`WHERE` içinde kullanılır ve hiçbir zaman DÖNDÜRÜLMEZ — bunu
     * bir sonraki test, çıktı sütunlarını kısıtlayarak zorlar.
     */
    const forbidden = [
      "debtor_address",
      "recipient_address",
      "recipient_label",
      "debtor_label",
      "paid_tx_hash",
      "tx_hash",
      "session_hash",
      "created_by_user_id",
      "normalized_email",
      "nonce",
    ];
    for (const name of NAMES) {
      const sql = sqlBlock(name);
      for (const column of forbidden) {
        expect(sql, `${name} / ${column}`).not.toContain(column);
      }
    }
  });

  it("cikti sutunlari yalnizca SAYI ve DURUM olabilir", () => {
    /*
     * En sıkı sınır burada: `AS` ile dışarı verilen her ad izinli listede
     * olmalı. Biri `AS debtor_address` eklemeye kalkarsa bu test düşer.
     */
    const allowed = new Set([
      "total",
      "open",
      "new_24h",
      "new_7d",
      "created_24h",
      "created_7d",
      "past_retention",
      "status",
      "global_used",
      "active_users",
      "users_at_cap",
      "calls",
      "windows_at_cap",
    ]);
    for (const name of NAMES) {
      const aliases = [...sqlBlock(name).matchAll(/\bAS\s+([a-z0-9_]+)/g)].map(
        (match) => match[1],
      );
      for (const alias of aliases) {
        expect(allowed, `${name} -> ${alias}`).toContain(alias);
      }
    }
  });

  it("zaman pencereleri MILISANIYEDEN cevrilir", () => {
    /*
     * Eşikler çağırandan Unix milisaniye olarak gelir; `to_timestamp` saniye
     * bekler. Bölme unutulursa pencere binlerce yıl ileriye kayar ve sayım
     * sessizce hep sıfır döner.
     */
    for (const name of ["METRICS_USERS", "METRICS_BILLS"]) {
      const sql = sqlBlock(name);
      expect(sql, name).toMatch(/created_at > to_timestamp\(\$1 \/ 1000\.0\)/);
      expect(sql, name).toMatch(/created_at > to_timestamp\(\$2 \/ 1000\.0\)/);
    }
  });

  it("saklama olcutu KATI kucuktur", () => {
    /*
     * `<=` olsaydı sınırdaki kayıt silinmeye uygun görünürdü; sayım ile
     * gerçek temizlik farklı kümeler sayardı.
     */
    expect(sqlBlock("METRICS_BILLS")).toMatch(
      /expires_at < to_timestamp\(\$3 \/ 1000\.0\)/,
    );
  });

  it("kirilimlar GROUP BY iledir, sabit sutun listesiyle degil", () => {
    expect(sqlBlock("METRICS_DEBTS")).toContain("GROUP BY payment_status");
    expect(sqlBlock("METRICS_ATTEMPTS")).toContain("GROUP BY status");
  });

  it("tavan sayimlari `>=` kullanir", () => {
    expect(sqlBlock("METRICS_ANALYSES")).toMatch(/used >= \$2/);
    expect(sqlBlock("METRICS_PROVIDER")).toMatch(/used >= \$1/);
  });

  it("hicbiri YAZMAZ", () => {
    /*
     * Ölçmek için ölçüleni değiştirmek olmaz. Bir gün buraya `UPDATE`
     * sızarsa sayaçlar kendi kendini besler.
     */
    for (const name of NAMES) {
      const sql = sqlBlock(name);
      for (const verb of ["INSERT", "UPDATE", "DELETE"]) {
        expect(sql, `${name} / ${verb}`).not.toContain(verb);
      }
    }
  });
});
