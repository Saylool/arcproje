import { describe, expect, it } from "vitest";

import {
  DROPPED_REQUEST_FIELDS,
  MAX_SCRUB_DEPTH,
  TRUNCATED,
  scrubEvent,
  scrubText,
  scrubValue,
} from "./scrub";

/**
 * GİZLİLİK SINIRI — hata olayları.
 *
 * Hata takibi uygulamanın iç durumunu ÜÇÜNCÜ BİR TARAFA gönderir. Bu depoda
 * sınır açıkça çizilmiş: gerçek cüzdan adresleri, ödeme linkleri, requestId'ler
 * ve işlem yükleri dışarı yazılmaz. Aşağıdaki testler o sınırın Sentry
 * bağlandıktan sonra da durduğunu kanıtlar.
 */

const BILL_ID = `0x${"4d".repeat(32)}`;
const TX_HASH = `0x${"ab".repeat(32)}`;
const ADDRESS = "0x0000000000000000000000000000000000000aBc";
const SIGNATURE = `0x${"1f".repeat(65)}`;
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMAIL = "birisi@example.com";

describe("sekil tanima", () => {
  it("hesap kimligi, islem hash'i ve adres DEGERI birakmaz", () => {
    expect(scrubText(BILL_ID)).toBe("0x<hex:64>");
    expect(scrubText(TX_HASH)).toBe("0x<hex:64>");
    expect(scrubText(ADDRESS)).toBe("0x<hex:40>");
    expect(scrubText(SIGNATURE)).toBe("0x<hex:130>");
  });

  it("UZUNLUGU birakir: hangi tur kimlik oldugu anlasilsin", () => {
    /*
     * Değeri silmek yeterli olurdu ama hata ayıklayan kişi "burada bir hesap
     * kimliği vardı" ile "burada bir adres vardı"yı ayırt edebilmeli.
     */
    expect(scrubText(BILL_ID)).not.toBe(scrubText(ADDRESS));
  });

  it("KISA onaltilik sayilar korunur", () => {
    /*
     * chainId gibi değerler kimlik değildir ve hata ayıklarken gerçekten
     * gerekir. Hepsini silen bir kural, olayları okunamaz hâle getirirdi.
     */
    expect(scrubText("chainId 0x2b74 bekleniyordu")).toBe(
      "chainId 0x2b74 bekleniyordu",
    );
    expect(scrubText("0x1")).toBe("0x1");
  });

  it("uuid ve e-posta degistirilir", () => {
    expect(scrubText(USER_ID)).toBe("<uuid>");
    expect(scrubText(`kullanici ${EMAIL} girdi`)).toBe("kullanici <email> girdi");
  });

  it("bir dizede AYNI ANDA birden fazla kimlik temizlenir", () => {
    const line = `${ADDRESS} -> ${BILL_ID} (${USER_ID}) ${EMAIL}`;
    const cleaned = scrubText(line);
    expect(cleaned).toBe("0x<hex:40> -> 0x<hex:64> (<uuid>) <email>");
  });
});

describe("EN SINSI YOL: URL", () => {
  it("yol parametresindeki hesap kimligi temizlenir", () => {
    /*
     * `bill_id` bir YOL parametresidir. İstisna mesajında hiçbir şey olmasa
     * bile varsayılan bir kurulumda her olayla birlikte giderdi.
     */
    expect(
      scrubText(`https://example.test/api/shared-bills/${BILL_ID}/payment/prepare`),
    ).toBe("https://example.test/api/shared-bills/0x<hex:64>/payment/prepare");
    expect(scrubText(`/pay/${BILL_ID}`)).toBe("/pay/0x<hex:64>");
  });

  it("sorgu dizesindeki kimlik de temizlenir", () => {
    expect(scrubText(`/x?debtor=${ADDRESS}&bill=${BILL_ID}`)).toBe(
      "/x?debtor=0x<hex:40>&bill=0x<hex:64>",
    );
  });
});

describe("agacin TAMAMI taranir", () => {
  it("ic ice nesne ve dizilerde temizlenir", () => {
    const input = {
      a: { b: [{ c: BILL_ID }, ADDRESS] },
      d: 42,
      e: null,
      f: true,
    };
    expect(scrubValue(input)).toEqual({
      a: { b: [{ c: "0x<hex:64>" }, "0x<hex:40>"] },
      d: 42,
      e: null,
      f: true,
    });
  });

  it("NESNE ANAHTARLARI da temizlenir", () => {
    /*
     * Bir kimlik anahtar olarak da görünebilir — ör. adres başına sayaç
     * tutan bir nesne. Yalnızca değerlere bakan bir temizlik onu kaçırırdı.
     */
    expect(scrubValue({ [ADDRESS]: 3 })).toEqual({ "0x<hex:40>": 3 });
  });

  it("derinlik SINIRINI asan dal ATILIR, oldugu gibi birakilmaz", () => {
    /*
     * Sınıra ulaşan dalı olduğu gibi bırakmak, temizlenmemiş veri göndermek
     * olurdu. Dalı kaybetmek yeğdir.
     */
    let deep: unknown = BILL_ID;
    for (let i = 0; i <= MAX_SCRUB_DEPTH + 2; i += 1) {
      deep = { nested: deep };
    }
    expect(JSON.stringify(scrubValue(deep))).toContain(TRUNCATED);
    expect(JSON.stringify(scrubValue(deep))).not.toContain(BILL_ID);
  });
});

describe("tumuyle ATILAN alanlar", () => {
  it("kullanici HIC gonderilmez", () => {
    /*
     * "Kim" bilgisi bir hatayı anlamak için gerekli değil; Sentry ise
     * varsayılan olarak IP ve kimlik ekleyebilir.
     */
    const event = scrubEvent({ user: { id: USER_ID, ip_address: "1.2.3.4" } });
    expect(event.user).toBeUndefined();
  });

  it("cerez, baslik, govde ve ortam SILINIR", () => {
    /*
     * Bunlar şekil tanımayla korunamaz: bir yetkilendirme başlığı ya da
     * istek gövdesi, tanınacak hiçbir desene uymadan sır taşır.
     */
    const event = scrubEvent({
      request: {
        url: `/pay/${BILL_ID}`,
        method: "POST",
        cookies: { session: "gizli" },
        headers: { authorization: "Bearer gizli" },
        data: { receipt: "..." },
        env: { DATABASE_URL: "postgres://gizli" },
      },
    });
    const request = event.request as Record<string, unknown>;
    for (const field of DROPPED_REQUEST_FIELDS) {
      expect(request[field], field).toBeUndefined();
    }
    /* URL KALIR ama temizlenmiştir: hangi rotanın düştüğü görülmeli. */
    expect(request.url).toBe("/pay/0x<hex:64>");
    expect(request.method).toBe("POST");
  });
});

describe("girdi DEGISTIRILMEZ", () => {
  it("ozgun olay oldugu gibi kalir", () => {
    /*
     * `beforeSend` uygulamanın kendi nesnesini alır. Yerinde değiştirmek,
     * aynı nesneyi kullanan başka bir yolu sessizce bozardı.
     */
    const original = { message: BILL_ID, user: { id: USER_ID } };
    const scrubbed = scrubEvent(original);
    expect(original.message).toBe(BILL_ID);
    expect(original.user.id).toBe(USER_ID);
    expect(scrubbed.message).toBe("0x<hex:64>");
  });
});

describe("gercek bir olayda HICBIR kimlik hayatta kalmaz", () => {
  it("mesaj, yigin izi, breadcrumb ve etiketlerin hepsi temizlenir", () => {
    const event = {
      message: `hesap ${BILL_ID} icin teklif basilamadi`,
      transaction: `GET /api/shared-bills/${BILL_ID}/payment/status`,
      exception: {
        values: [
          {
            type: "Error",
            value: `${ADDRESS} adresine gonderim reddedildi (${TX_HASH})`,
            stacktrace: {
              frames: [{ filename: `/app/pay/${BILL_ID}/page.tsx` }],
            },
          },
        ],
      },
      breadcrumbs: [
        { message: `imza ${SIGNATURE}` },
        { message: `kullanici ${USER_ID} / ${EMAIL}` },
      ],
      tags: { billId: BILL_ID },
      extra: { debtors: [ADDRESS, USER_ID] },
      request: {
        url: `https://example.test/pay/${BILL_ID}`,
        headers: { cookie: "gizli" },
      },
      user: { id: USER_ID, email: EMAIL },
    };

    const serialized = JSON.stringify(scrubEvent(event));
    for (const secret of [
      BILL_ID,
      TX_HASH,
      ADDRESS,
      SIGNATURE,
      USER_ID,
      EMAIL,
      "gizli",
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }

    /* Ama olay hâlâ İŞE YARAR: hangi rota, hangi hata türü görünüyor. */
    expect(serialized).toContain("teklif basilamadi");
    expect(serialized).toContain("payment/status");
    expect(serialized).toContain("Error");
  });
});
