import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { createMetricsGet } from "@/app/api/admin/metrics/route";
import {
  buildSharedBillTypedData,
  createSharedBill,
} from "@/lib/arc/shared-bill";

import { createFakeSharedBillRepository } from "./shared-bill-repository.fixture";

/**
 * ÖLÇÜM UCU — kimlik doğrulaması ve gizlilik sınırı.
 *
 * Bu uç tanımı gereği AYRICALIKLIDIR: bütün sayaçları tek yerde toplar. Bu
 * yüzden iki şey ayrı ayrı kanıtlanır — kimliği doğrulanmayan kimse buraya
 * giremez, ve girenin gördüğü şeyde kişiye ait hiçbir veri yoktur.
 */

const NOW = 1_700_000_000_000;
const SECRET = "test-metrics-secret-uzun-ve-rastgele";
const ADA = "0x0000000000000000000000000000000000000aBc";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function request(authorization?: string) {
  return new Request("https://example.test/api/admin/metrics", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("kimlik dogrulamasi", () => {
  it("SIR TANIMLI DEGILSE uc calismaz", async () => {
    /*
     * Açık bir uç, sessizce korumasız kalmış bir uçtan iyidir — aynı karar
     * `/api/cron/retention` için de verilmişti. Ve depoya HİÇ gidilmez.
     */
    const createRepository = vi.fn();
    const GET = createMetricsGet({
      readSecret: () => undefined,
      createRepository: createRepository as never,
      now: () => NOW,
    });

    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "SERVICE_NOT_CONFIGURED" },
    });
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("BOSLUKTAN ibaret sir da yapilandirilmamis sayilir", async () => {
    const GET = createMetricsGet({
      readSecret: () => "   ",
      createRepository: (async () => null) as never,
      now: () => NOW,
    });
    expect((await GET(request("Bearer    "))).status).toBe(503);
  });

  it("basliksiz ve YANLIS jetonlu istek 401 alir", async () => {
    const createRepository = vi.fn();
    const GET = createMetricsGet({
      readSecret: () => SECRET,
      createRepository: createRepository as never,
      now: () => NOW,
    });

    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer yanlis"))).status).toBe(401);
    expect((await GET(request(SECRET))).status).toBe(401);
    /* Yetkisiz istek veritabanına HİÇ dokunmaz. */
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("401 yaniti sirrin var olup olmadigini SIZDIRMAZ", async () => {
    /*
     * "Sır tanımlı değil" ile "jeton yanlış" farkı, saldırgana yapılandırma
     * hakkında bilgi verirdi. Yetkisiz yanıt tek biçimdir.
     */
    const GET = createMetricsGet({
      readSecret: () => SECRET,
      createRepository: (async () => null) as never,
      now: () => NOW,
    });
    const body = await (await GET(request("Bearer yanlis"))).json();
    expect(body).toEqual({ error: { code: "UNAUTHORIZED", message: "Yetkisiz." } });
  });
});

describe("depo durumu", () => {
  it("DATABASE_URL yoksa 503 doner", async () => {
    const GET = createMetricsGet({
      readSecret: () => SECRET,
      createRepository: (async () => null) as never,
      now: () => NOW,
    });
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "SERVICE_NOT_CONFIGURED" },
    });
  });

  it("depo ERISILEMEZSE sifirlarla dolu rapor UYDURMAZ", async () => {
    /*
     * Erişilemezliği sıfır göstermek en kötü ölçüm hatasıdır: boş bir rapora
     * bakıp "sorun yok" dedirtir.
     */
    const repository = createFakeSharedBillRepository();
    repository.controls.failWithUnavailable = true;
    const GET = createMetricsGet({
      readSecret: () => SECRET,
      createRepository: (async () => repository) as never,
      now: () => NOW,
    });
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "SERVICE_UNAVAILABLE" },
    });
  });
});

describe("basarili yanit", () => {
  it("rapor doner ve ASLA onbeleklenmez", async () => {
    const repository = createFakeSharedBillRepository();
    const GET = createMetricsGet({
      readSecret: () => SECRET,
      createRepository: (async () => repository) as never,
      now: () => NOW,
    });

    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "no-store, private, max-age=0",
    );

    const body = (await response.json()) as Record<string, unknown>;
    for (const section of [
      "observedAt",
      "users",
      "bills",
      "debts",
      "attempts",
      "analyses",
      "provider",
      "retention",
    ]) {
      expect(body, section).toHaveProperty(section);
    }
  });

  it("SALT OKUR: sayaclari tuketmez", async () => {
    /*
     * Ölçmek için ölçüleni değiştirmek olmaz. Ölçümden sonra kota ve bütçe
     * satırları olduğu gibi durmalı.
     */
    const repository = createFakeSharedBillRepository();
    repository.analysisQuota.set("@global|2023-11-14", 7);
    repository.providerBudget.set("coingecko|100", 2);

    const GET = createMetricsGet({
      readSecret: () => SECRET,
      createRepository: (async () => repository) as never,
      now: () => NOW,
    });
    await GET(request(`Bearer ${SECRET}`));

    expect(repository.analysisQuota.get("@global|2023-11-14")).toBe(7);
    expect(repository.providerBudget.get("coingecko|100")).toBe(2);
  });
});

describe("GIZLILIK SINIRI", () => {
  it("yanit kimlik tasiyan HICBIR seyi icermez", async () => {
    /*
     * Gerçek şekilli veriyle doldurulur ve yanıtın tamamı taranır: adres,
     * hesap kimliği, kullanıcı kimliği, etiket. Ayrıcalıklı bir ucun
     * sızdırdığı şey en çok sızan şeydir.
     */
    const repository = createFakeSharedBillRepository();
    const account = privateKeyToAccount(generatePrivateKey());
    const created = createSharedBill({
      recipient: account.address,
      recipientLabel: "Poyraz",
      debts: [
        { debtor: ADA, debtorLabel: "Ada", debtKey: "a->p", tryMinor: "100" },
      ],
      nowMs: NOW,
      billId: `0x${"4d".repeat(32)}`,
    });
    if (!created.ok) throw new Error(created.problem);
    const typed = buildSharedBillTypedData(created.manifest);
    const signature = await account.signTypedData({
      domain: typed.domain,
      types: typed.types,
      primaryType: typed.primaryType,
      message: typed.message,
    });
    await repository.createSharedBill(
      { manifest: created.manifest, debts: created.debts, signature },
      { createdByUserId: USER },
    );
    repository.appUsers.add(USER);
    repository.analysisQuota.set(`${USER}|2023-11-14`, 3);

    const GET = createMetricsGet({
      readSecret: () => SECRET,
      createRepository: (async () => repository) as never,
      now: () => NOW,
    });
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);

    const text = (await response.text()).toLowerCase();
    for (const secret of [
      created.manifest.billId.toLowerCase(),
      ADA.toLowerCase(),
      account.address.toLowerCase(),
      USER,
      "poyraz",
      "ada",
      signature.toLowerCase(),
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("sayilar YINE DE dogru: gizlilik olcumu bozmuyor", async () => {
    /*
     * Gizlilik sınırının "hiçbir şey döndürme" ile karşılanmadığı burada
     * görünür: kimlik yok, ama sayım var.
     */
    const repository = createFakeSharedBillRepository();
    repository.appUsers.add(USER);
    repository.analysisQuota.set("@global|2023-11-14", 12);

    const GET = createMetricsGet({
      readSecret: () => SECRET,
      createRepository: (async () => repository) as never,
      now: () => NOW,
    });
    const body = (await (await GET(request(`Bearer ${SECRET}`))).json()) as {
      users: { total: number };
      analyses: { used: number; day: string };
    };
    expect(body.users.total).toBe(1);
    expect(body.analyses.used).toBe(12);
    expect(body.analyses.day).toBe("2023-11-14");
  });
});
