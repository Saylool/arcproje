import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checkSplitReady } from "@/lib/split/participants";

import {
  MANUAL_RECEIPT_CURRENCY,
  createManualReceipt,
} from "./manual-receipt";
import { ReceiptSchema } from "./schema";

/**
 * ANALİZ OLMADAN BAŞLANAN FİŞ.
 *
 * Akışın tamamı bir analizin BAŞARILI olmasına bağlıydı: her ekran
 * `receipt !== null` şartına bakıyordu ve `receipt` yalnızca sunucudan dönen
 * bir analizle doluyordu. Günlük tavan dolduğunda ya da OpenAI'ye
 * ulaşılamadığında uygulama tümüyle duruyordu — oysa bölüşme, borç hesabı ve
 * imzalı ödeme talebi fişin nereden geldiğini bilmez.
 */

describe("bos fis GECERLIDIR", () => {
  it("semayi gecer", () => {
    /*
     * Uygulamanın içinde yalnızca doğrulanmış fiş dolaşır. Elle başlatılan
     * fiş de aynı kapıdan geçmeli; geçmeseydi analiz yolundan gelenle iki
     * farklı sınıf veri olurdu.
     */
    expect(ReceiptSchema.safeParse(createManualReceipt()).success).toBe(true);
  });

  it("TEK bos satirla baslar", () => {
    /*
     * Sıfır satırlı bir editör kullanıcıya nereye yazacağını göstermez.
     */
    const receipt = createManualReceipt();
    expect(receipt.items).toHaveLength(1);
    expect(receipt.items[0].name).toBe("");
    expect(receipt.items[0].totalMinor).toBe(0);
    expect(receipt.items[0].id.length).toBeGreaterThan(0);
  });

  it("satirin sekli EDITORUN urettigiyle ayni", () => {
    /*
     * Ayrışsalardı elle eklenen ilk satır sonrakilerden farklı davranırdı.
     * Editördeki ürün ekleme düğmesi kaynakta aynı üçlüyü üretir.
     */
    const editor = readFileSync("src/components/ReceiptEditor.tsx", "utf8");
    expect(editor).toContain(
      "{ id: createItemId(), name: \"\", totalMinor: 0 }",
    );
    const item = createManualReceipt().items[0];
    expect(Object.keys(item).sort()).toEqual(["id", "name", "totalMinor"]);
  });

  it("her cagri BENZERSIZ kimlik uretir", () => {
    /*
     * Kimlikler atamaların anahtarıdır; çakışan iki kimlik bir kişiye yanlış
     * ürünü bağlardı.
     */
    const ids = new Set(
      Array.from({ length: 50 }, () => createManualReceipt().items[0].id),
    );
    expect(ids.size).toBe(50);
  });
});

describe("varsayilanlar", () => {
  it("vergi, servis ve indirim SIFIRDIR", () => {
    const receipt = createManualReceipt();
    expect(receipt.taxMinor).toBe(0);
    expect(receipt.serviceChargeMinor).toBe(0);
    expect(receipt.discountMinor).toBe(0);
    expect(receipt.totalMinor).toBe(0);
  });

  it("islem `included_in_items`, `unknown` DEGIL", () => {
    /*
     * Sıfır tutarda ikisi de aynı toplamı verir; seçim kullanıcı sonradan bir
     * vergi yazdığında anlamlı olur. Türkiye'deki fişlerde KDV ürün
     * fiyatlarının İÇİNDEDİR ve toplama tekrar eklenmez.
     *
     * `unknown` ise kullanıcıya, kendi girdiği bir sayı için "fişten
     * anlaşılamadı" demek olurdu — ortada fiş yok.
     */
    const receipt = createManualReceipt();
    expect(receipt.taxTreatment).toBe("included_in_items");
    expect(receipt.serviceChargeTreatment).toBe("included_in_items");
    expect(receipt.discountTreatment).toBe("included_in_items");
  });

  it("UYARI listesi bostur", () => {
    /*
     * Uyarılar modelin okuma güçlüğünü anlatır. Okunacak bir şey olmadığı
     * için hiçbiri doğru olmaz.
     */
    expect(createManualReceipt().warnings).toEqual([]);
  });

  it("para birimi uygulamanin kendi birimidir", () => {
    expect(createManualReceipt().currency).toBe(MANUAL_RECEIPT_CURRENCY);
    expect(MANUAL_RECEIPT_CURRENCY).toBe("TRY");
  });

  it("satici adi NULL: uydurulmaz", () => {
    expect(createManualReceipt().merchantName).toBeNull();
  });
});

describe("akisa girer ama BOS HALIYLE ilerlemez", () => {
  it("bos fis bolusme kapisindan GECMEZ", () => {
    /*
     * Doğru davranış bu: kullanıcı önce ürünleri yazar. Kapının boş fişi
     * kabul etmesi, kimseye bir şey atanmamış bir bölüşmeye yol açardı.
     */
    const gate = checkSplitReady(createManualReceipt(), new Set());
    expect(gate.ok).toBe(false);
  });

  it("urunler yazilinca kapiyi GECER", () => {
    /*
     * Ve asıl iddia budur: analizden gelmiş bir fişle elle girilmiş fiş,
     * bu noktadan sonra ayırt edilemez.
     */
    const receipt = createManualReceipt();
    const filled = {
      ...receipt,
      items: [{ ...receipt.items[0], name: "Çay", totalMinor: 2500 }],
      totalMinor: 2500,
    };
    expect(checkSplitReady(filled, new Set()).ok).toBe(true);
  });
});

describe("SUNUCUYA gitmez", () => {
  const source = readFileSync("src/lib/receipt/manual-receipt.ts", "utf8");

  it("hicbir ag cagrisi ya da kota dokunusu yoktur", () => {
    /*
     * Bu yolun varlık sebebi, o çağrıların YAPILAMADIĞI durumlar. Bir gün
     * buraya bir istek sızarsa yol kendi amacını kaybeder.
     */
    for (const forbidden of ["fetch(", "/api/", "quota", "analyze"]) {
      expect(source.toLowerCase(), forbidden).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });

  it("akis dugmeyi FOTOGRAFTAN BAGIMSIZ gosterir", () => {
    /*
     * `file !== null` bloğunun İÇİNE konsaydı, kullanıcı önce fotoğraf
     * seçmek zorunda kalırdı — analiz servisi kapalıyken anlamsız bir adım.
     */
    const flow = readFileSync("src/components/ReceiptFlow.tsx", "utf8");
    const button = flow.indexOf("startManualEntry");
    const fileBlock = flow.indexOf("{file !== null && (");
    expect(button).toBeGreaterThan(-1);
    expect(fileBlock).toBeGreaterThan(-1);
    expect(button).toBeLessThan(fileBlock);
  });
});
