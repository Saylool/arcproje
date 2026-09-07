import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { createReviewGet } from "@/app/api/admin/review/route";
import {
  buildSharedBillTypedData,
  createSharedBill,
} from "@/lib/arc/shared-bill";

import { createFakeSharedBillRepository } from "./shared-bill-repository.fixture";
import type { StoredSharedBillDebt } from "./shared-bill-repository";

/**
 * ELLE MUTABAKAT BEKLEYEN BORÇLAR.
 *
 * `review_required` şemada baştan beri vardı ama kimse bakmıyordu. Bu duruma
 * düşen her satır gerçek bir insanın "ödedim ama görünmüyor" anıdır.
 *
 * Testlerin ağırlığı iki yerde: liste GERÇEKTEN doğru kayıtları veriyor mu, ve
 * gizlilik istisnası DAR kalıyor mu.
 */

const NOW = 1_700_000_000_000;
const SECRET = "test-review-secret-uzun-ve-rastgele";
const ADA = "0x0000000000000000000000000000000000000aBc";
const BORA = "0x00000000000000000000000000000000000000De";
const DEBTOR_LABEL = "Ada";
const RECIPIENT_LABEL = "Poyraz";

type Repository = ReturnType<typeof createFakeSharedBillRepository>;

function request(authorization?: string) {
  return new Request("https://example.test/api/admin/review", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

async function seedBill(repository: Repository) {
  const account = privateKeyToAccount(generatePrivateKey());
  const created = createSharedBill({
    recipient: account.address,
    recipientLabel: RECIPIENT_LABEL,
    debts: [
      { debtor: ADA, debtorLabel: DEBTOR_LABEL, debtKey: "a->p", tryMinor: "12345" },
      { debtor: BORA, debtorLabel: "Bora", debtKey: "b->p", tryMinor: "6789" },
    ],
    nowMs: NOW,
    billId: `0x${"7a".repeat(32)}`,
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
    { createdByUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  );
  expect(stored.ok).toBe(true);
  return { billId: created.manifest.billId, recipient: account.address };
}

/**
 * Borcu ADRESINDEN bulur, sirasindan degil.
 *
 * `createSharedBill` borc satirlarini KANONIK siraya dizer (Merkle yapragi
 * icin); indekse guvenen bir test sessizce baska bir borcu isaretlerdi.
 */
function setStatus(
  repository: Repository,
  billId: string,
  debtor: string,
  status: StoredSharedBillDebt["paymentStatus"],
) {
  const bill = repository.bills.get(billId.toLowerCase());
  if (bill === undefined) throw new Error("hesap yok");
  const index = bill.debts.findIndex(
    (debt) => debt.debtor.toLowerCase() === debtor.toLowerCase(),
  );
  if (index === -1) throw new Error(`borc yok: ${debtor}`);
  bill.debts[index] = { ...bill.debts[index], paymentStatus: status };
}

describe("liste DOGRU kayitlari verir", () => {
  it("yalnizca review_required donen satirlar", async () => {
    const repository = createFakeSharedBillRepository();
    const bill = await seedBill(repository);
    setStatus(repository, bill.billId, ADA, "review_required");
    setStatus(repository, bill.billId, BORA, "paid");

    const found = await repository.listDebtsAwaitingReview({ limit: 50 });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.debts).toHaveLength(1);
    expect(found.debts[0].debtor.toLowerCase()).toBe(ADA.toLowerCase());
  });

  it("hicbiri beklemiyorsa BOS liste doner, hata degil", async () => {
    const repository = createFakeSharedBillRepository();
    await seedBill(repository);
    expect(await repository.listDebtsAwaitingReview({ limit: 50 })).toEqual({
      ok: true,
      debts: [],
    });
  });

  it("HASH'SIZ satir da gorunur", async () => {
    /*
     * Bir borç, hash bildirilmeden de `review_required`a düşmüş olabilir.
     * O satırı gizlemek, incelenecek EN TUHAF vakayı görünmez kılardı: boş
     * hash'in kendisi bir bilgidir — zincirde bakılacak bir şey yok demektir.
     */
    const repository = createFakeSharedBillRepository();
    const bill = await seedBill(repository);
    setStatus(repository, bill.billId, ADA, "review_required");

    const found = await repository.listDebtsAwaitingReview({ limit: 50 });
    expect(found.ok && found.debts[0].txHash).toBeNull();
    expect(found.ok && found.debts[0].tryMinor).toBe("12345");
  });

  it("depo erisilemezse BOS demez", async () => {
    /*
     * Boş liste "bakılacak bir şey yok" demektir. Erişilemezliği öyle
     * göstermek, biriken kayıtları görünmez kılardı.
     */
    const repository = createFakeSharedBillRepository();
    repository.controls.failWithUnavailable = true;
    expect(await repository.listDebtsAwaitingReview({ limit: 50 })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("GIZLILIK ISTISNASI dar kalir", () => {
  it("yanit INSAN ADI ve kullanici kimligi TASIMAZ", async () => {
    /*
     * İstisna kimlik döndürmektir, kişi göstermek değil: mutabakat zincire
     * karşı yapılır. Etiketler ve uygulama kullanıcısı kimliği buradan
     * geçseydi, dar tutulan istisna genişlemiş olurdu.
     */
    const repository = createFakeSharedBillRepository();
    const bill = await seedBill(repository);
    setStatus(repository, bill.billId, ADA, "review_required");

    const GET = createReviewGet({
      readSecret: () => SECRET,
      createRepository: (async () => repository) as never,
    });
    const text = (await (await GET(request(`Bearer ${SECRET}`))).text());

    for (const secret of [
      DEBTOR_LABEL,
      RECIPIENT_LABEL,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "debtKey",
      "a->p",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("ama ZINCIRDE ACIK olanlar doner: aksi halde is yapilamaz", async () => {
    const repository = createFakeSharedBillRepository();
    const bill = await seedBill(repository);
    setStatus(repository, bill.billId, ADA, "review_required");

    const GET = createReviewGet({
      readSecret: () => SECRET,
      createRepository: (async () => repository) as never,
    });
    const body = (await (await GET(request(`Bearer ${SECRET}`))).json()) as {
      debts: { billId: string; debtor: string; recipient: string }[];
      count: number;
    };
    expect(body.count).toBe(1);
    expect(body.debts[0].billId.toLowerCase()).toBe(bill.billId.toLowerCase());
    expect(body.debts[0].debtor.toLowerCase()).toBe(ADA.toLowerCase());
    expect(body.debts[0].recipient.toLowerCase()).toBe(
      bill.recipient.toLowerCase(),
    );
  });

  it("SQL etiket sutunlarina hic dokunmaz", () => {
    /*
     * Kaynakta tutulur: bir gün `debtor_label` seçilirse bu test düşer ve
     * istisnanın genişletildiği kararı yeniden sorulur.
     */
    const neon = readFileSync(
      "src/lib/db/neon-shared-bill-repository.ts",
      "utf8",
    );
    const start = neon.indexOf("const SELECT_DEBTS_AWAITING_REVIEW = `");
    expect(start).toBeGreaterThan(-1);
    const sql = neon.slice(start, neon.indexOf("`;", start));
    for (const column of [
      "debtor_label",
      "recipient_label",
      "created_by_user_id",
      "debt_key",
      "recipient_signature",
    ]) {
      expect(sql, column).not.toContain(column);
    }
  });

  it("yanit GUNLUGE yazilmaz", () => {
    /*
     * Kimlik taşıyan bir yanıtı cron günlüklerine düşürmek, dar tutulan
     * istisnayı kalıcı bir kayda çevirirdi.
     */
    const route = readFileSync("src/app/api/admin/review/route.ts", "utf8");
    expect(route).not.toContain("console.log");
  });
});

describe("kimlik dogrulamasi", () => {
  it("AYRI bir sir kullanir, METRICS_SECRET degil", () => {
    /*
     * Ölçüm ucu hiçbir kişisel veri sızdırmaz, burası kimlik döndürür:
     * farklı duyarlılık, farklı anahtar, farklı patlama yarıçapı.
     */
    const route = readFileSync("src/app/api/admin/review/route.ts", "utf8");
    /*
     * Aranan sey OKUNAN degisken; yorumda gerekcesiyle birlikte anilmasi
     * sorun degil, hatta istenen sey.
     */
    expect(route).toContain("process.env.REVIEW_SECRET");
    expect(route).not.toContain("process.env.METRICS_SECRET");
  });

  it("sir yoksa uc CALISMAZ ve depoya gidilmez", async () => {
    const createRepository = vi.fn();
    const GET = createReviewGet({
      readSecret: () => undefined,
      createRepository: createRepository as never,
    });
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("basliksiz ve YANLIS jetonlu istek 401 alir", async () => {
    const createRepository = vi.fn();
    const GET = createReviewGet({
      readSecret: () => SECRET,
      createRepository: createRepository as never,
    });
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer yanlis"))).status).toBe(401);
    expect((await GET(request(SECRET))).status).toBe(401);
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("yanit ASLA onbeleklenmez", async () => {
    const repository = createFakeSharedBillRepository();
    const GET = createReviewGet({
      readSecret: () => SECRET,
      createRepository: (async () => repository) as never,
    });
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.headers.get("cache-control")).toBe(
      "no-store, private, max-age=0",
    );
  });
});
