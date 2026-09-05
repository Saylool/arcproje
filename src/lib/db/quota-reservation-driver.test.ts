import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseEnv } from "./env";
import { createNeonSharedBillRepository } from "./neon-shared-bill-repository";

/**
 * KOTA AYIRMA — SÜRÜCÜNÜN GERÇEKTEN GÖNDERDİĞİ İSTEK.
 *
 * Bu dosya neden var: kota ayırma, bir deyime bildirdiğinden FAZLA parametre
 * göndererek üretimde her fiş analizini 503'e düşürdü. Kaynak metnine bakan
 * testler bunu göremedi — dahası, biri yanlış çağrı biçimini AÇIKÇA bekliyor
 * ve hatayı yerinde ÇİVİLİYORDU. Doğru sorguyu yazmak o testi kırardı.
 *
 * Buradaki yaklaşım farklı: kodun kendisi çalışır. Yalnızca `fetch`
 * değiştirilir ve yerine PostgreSQL'in Bind kuralını uygulayan sahte bir uç
 * konur:
 *
 *   "bind message supplies N parameters, but prepared statement requires M"
 *
 * Yani gerçek depo, gerçek sürücü, gerçek sorgu metni; sahte olan yalnızca
 * ağın öbür ucu. Bu bir veritabanı DEĞİLDİR ve öyle sunulmaz: kilitleme,
 * eşzamanlılık ve `ON CONFLICT` davranışı burada ÖLÇÜLMEZ. Ölçtüğü tek şey,
 * gönderilen isteğin PostgreSQL'in kabul edeceği biçimde olduğudur — kırılan
 * da tam olarak buydu.
 */

/** Deyimin bildirdiği parametre sayısı: en yüksek `$N`. */
function declaredParameters(sql: string): number {
  const indexes = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  return indexes.length === 0 ? 0 : Math.max(...indexes);
}

type Statement = { query: string; params: unknown[] };

/** Sahte ucun her istekte gördüğü deyimler; iddialar bunun üzerinden kurulur. */
type Traffic = { requests: Statement[][] };

const RESERVE_COLUMNS = [
  "global_before",
  "user_before",
  "bumped_rows",
  "user_after",
];

function postgresFaithfulProxy(traffic: Traffic): typeof fetch {
  return (async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as
      | { queries: Statement[] }
      | Statement;
    const statements = "queries" in body ? body.queries : [body];
    traffic.requests.push(statements);

    for (const statement of statements) {
      const declared = declaredParameters(statement.query);
      if (statement.params.length !== declared) {
        /* PostgreSQL'in gerçek davranışı: uyuşmazlıkta deyim ÇALIŞMAZ. */
        return new Response(
          JSON.stringify({
            message: `bind message supplies ${statement.params.length} parameters, but prepared statement "" requires ${declared}`,
            code: "08P01",
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
    }

    return new Response(
      JSON.stringify({
        results: statements.map(() => ({
          command: "SELECT",
          fields: RESERVE_COLUMNS.map((name) => ({ name, dataTypeID: 23 })),
          /* Kabul edilmiş bir ayırma: iki satır arttı, kişinin kullanımı 1. */
          rows: [[0, 0, 2, 1]],
          rowCount: 1,
        })),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

const RESERVE_INPUT = {
  globalKey: "receipt_analysis_global",
  userKey: "app_user_0123456789abcdef",
  day: "2026-09-05",
  globalLimit: 8,
  userLimit: 3,
};

async function reserve() {
  const environment: DatabaseEnv = {
    /* Gerçek bir sunucuya GİTMEZ; `fetch` zaten değiştirildi. */
    DATABASE_URL: "postgres://u:p@ep-test.eu-central-1.aws.neon.tech/db",
  };
  const repository = await createNeonSharedBillRepository(environment);
  if (repository === null) {
    throw new Error("depo kurulamadi");
  }
  return await repository.reserveAnalysisQuota(RESERVE_INPUT);
}

describe("kota ayirma istegi PostgreSQL'in kabul edecegi bicimde", () => {
  const originalFetch = globalThis.fetch;
  let traffic: Traffic;

  beforeEach(() => {
    traffic = { requests: [] };
    globalThis.fetch = postgresFaithfulProxy(traffic);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("AYIRMA BASARILI olur", async () => {
    /*
     * Kirmizi hali: ilk deyim 3 parametre bildirip 5 aldigi icin reddedilir,
     * `catch` bunu "unavailable"a cevirir ve rota 503 doner.
     */
    await expect(reserve()).resolves.toEqual({ ok: true, userUsed: 1 });
  });

  it("HER deyim bildirdigi KADAR parametre alir", async () => {
    await reserve();
    const statements = traffic.requests[0];
    expect(statements).toHaveLength(4);
    for (const [index, statement] of statements.entries()) {
      expect(statement.params.length, `deyim ${index + 1}`).toBe(
        declaredParameters(statement.query),
      );
    }
  });

  it("SINIRLAR yalnizca ayirma deyimine gider", async () => {
    await reserve();
    const [lockUser, seed, lock, reserveStatement] = traffic.requests[0];
    /*
     * ÖNCE hesap satırı kilitlenir. Varlık kontrolü ayrı bir istekteyken
     * arada hesap silinebiliyordu; o aralıkta silinmiş bir hesap adına satır
     * yaratılıp sağlayıcıya para harcatılabiliyordu.
     */
    expect(lockUser.query).toContain("FROM app_users");
    expect(lockUser.query).toContain("FOR KEY SHARE");
    expect(lockUser.params).toEqual([RESERVE_INPUT.userKey]);
    /*
     * Ilk iki deyim satirlari yalnizca ADRESLER. Sinirlari da almalari
     * zararsiz gorunur ama tam olarak bu, uretimi kiran seydi.
     */
    expect(seed.params).toEqual([
      RESERVE_INPUT.globalKey,
      RESERVE_INPUT.userKey,
      RESERVE_INPUT.day,
    ]);
    expect(lock.params).toEqual(seed.params);
    /* Sürücü parametreleri METİN olarak taşır; tel üzerindeki biçim budur. */
    expect(reserveStatement.params).toEqual([
      ...seed.params,
      String(RESERVE_INPUT.globalLimit),
      String(RESERVE_INPUT.userLimit),
    ]);
  });

  it("uc deyim TEK istekte, yani tek islemde gider", async () => {
    await reserve();
    /*
     * Bunu kaynak metninde `sql.transaction(` arayarak da "olcebilirdik";
     * o test yaziliydi ve hatayi gormedi. Burada sayilan sey gercek: ayri
     * cagrilar olsaydi ag ucunda ayri istekler gorunurdu ve kilitler arada
     * birakilirdi.
     */
    expect(traffic.requests).toHaveLength(1);
  });

  it("hesap YOKSA userMissing doner, tukenme DEGIL", async () => {
    /*
     * Gerçek Neon kodunun bu dalı başka hiçbir yerde çalışmıyor: sahte depo
     * kendi kuralını uygular, SQL metni ise yalnızca okunur. Burada asıl
     * uygulama, sunucunun döndüreceği satırla besleniyor.
     *
     * Boş bir kümede `max(used)` NULL döner ve sıfır olarak okunur; bu yüzden
     * "hiçbir sınır dolmamış" görünür. `user_present` bakılmasaydı sonuç
     * "erişilemiyor" olurdu ve kullanıcı silinmiş hesabıyla bekletilirdi.
     */
    globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body) as { queries: Statement[] };
      return new Response(
        JSON.stringify({
          results: body.queries.map(() => ({
            command: "SELECT",
            fields: [
              ...RESERVE_COLUMNS.map((name) => ({ name, dataTypeID: 23 })),
              { name: "user_present", dataTypeID: 23 },
            ],
            /* global_before, user_before, bumped_rows, user_after, user_present */
            rows: [[0, 0, 0, null, 0]],
            rowCount: 1,
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await expect(reserve()).resolves.toEqual({
      ok: false,
      reason: "userMissing",
    });
  });

  it("hesap YOKKEN genel tavan doluysa yine userMissing doner", async () => {
    /*
     * SIRA ONEMLI. Genel satir kullaniciya bagli degildir ve baskalari onu
     * doldurmus olabilir; hesap silinmis olsa bile `global_before` sinirda
     * gorunur. Tukenme once bakilsaydi kullaniciya "yarin gel" denirdi —
     * oysa donecek bir hesap yok. Bu test tam olarak o sirayi sabitler.
     */
    globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body) as { queries: Statement[] };
      return new Response(
        JSON.stringify({
          results: body.queries.map(() => ({
            command: "SELECT",
            fields: [
              ...RESERVE_COLUMNS.map((name) => ({ name, dataTypeID: 23 })),
              { name: "user_present", dataTypeID: 23 },
            ],
            /* Genel sayac TAM sinirda, hesap ise YOK. */
            rows: [[RESERVE_INPUT.globalLimit, 0, 0, null, 0]],
            rowCount: 1,
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await expect(reserve()).resolves.toEqual({
      ok: false,
      reason: "userMissing",
    });
  });

  it("SURUCU HATASI erisilememe olarak doner, sizmaz", async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ message: "connection refused", code: "08006" }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    await expect(reserve()).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
