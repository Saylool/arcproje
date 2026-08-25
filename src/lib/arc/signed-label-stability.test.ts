import { describe, expect, it } from "vitest";

import {
  PAYMENT_REQUEST_UNKNOWN_PARTICIPANT_LABEL,
  SHARED_BILL_UNKNOWN_PARTICIPANT_LABEL,
  prepareLabel,
  validateCanonicalLabel,
} from "./labels";
import { MAX_LABEL_LENGTH } from "./payment-request";
import { computeSharedBillRoot, createSharedBill } from "./shared-bill";
import { translate } from "../i18n/dictionary";
import { LOCALES } from "../i18n/locale";

/**
 * İMZALANAN YEDEK ETİKETLERİN BAYT SABİTLİĞİ.
 *
 * Bir katılımcı kimliği bulunamadığında kullanılan yedek ad, İMZALANAN
 * gövdeye girer: paylaşılan hesapta Merkle yaprağına, ödeme talebinde
 * imzalanan alana. Bu yüzden iki şey birden doğrulanır:
 *
 *   1. yedek ad ARAYÜZ DİLİNE göre değişmez;
 *   2. yedek adın BAYTLARI yerelleştirme öncesiyle AYNIDIR — değişselerdi
 *      aynı girdi farklı bir kök üretirdi.
 *
 * Aşağıdaki kök, yerelleştirmeden ÖNCEKİ davranıştan alınmıştır; bu testin
 * amacı onu bir daha kimsenin sessizce değiştirememesidir.
 */

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const DEBTOR = "0x2222222222222222222222222222222222222222";
const BILL_ID = `0x${"ab".repeat(32)}`;
const NOW_MS = 1_700_000_000_000;

/**
 * `main` (a4eeb0d) üzerinde, paylaşılan hesap akışının yedek adıyla
 * ("Bilinmeyen kisi") üretilen kök. Değer altın örnekle ölçülmüştür.
 */
const HISTORICAL_ROOT =
  "0xf91aa7dd4a5d4ae26cd79ea7a103cd8ff4221571358921b0ef83dbfd19a1ac68";

describe("yedek etiketler DİLDEN BAĞIMSIZDIR", () => {
  it("iki akışın yedek adı da sabit metindir", () => {
    expect(SHARED_BILL_UNKNOWN_PARTICIPANT_LABEL).toBe("Bilinmeyen kisi");
    expect(PAYMENT_REQUEST_UNKNOWN_PARTICIPANT_LABEL).toBe("Bilinmeyen kişi");
  });

  it("hiçbir dilde sözlükten TÜRETİLMEZ", () => {
    /*
     * Görünen yedek ad çevrilir; İMZALANAN yedek ad çevrilmez. İkisinin
     * karışması, imzalanan baytları arayüz diline bağlardı.
     */
    for (const locale of LOCALES) {
      const displayed = translate(locale, "common.unknownParticipant");
      expect(displayed.trim(), locale).not.toBe("");
      if (locale === "en") {
        expect(displayed, locale).not.toBe(
          SHARED_BILL_UNKNOWN_PARTICIPANT_LABEL,
        );
        expect(displayed, locale).not.toBe(
          PAYMENT_REQUEST_UNKNOWN_PARTICIPANT_LABEL,
        );
      }
    }
  });

  it("her ikisi de imzalanabilir kanonik etikettir", () => {
    for (const label of [
      SHARED_BILL_UNKNOWN_PARTICIPANT_LABEL,
      PAYMENT_REQUEST_UNKNOWN_PARTICIPANT_LABEL,
    ]) {
      // `prepareLabel` bu metinleri DEĞİŞTİRMEZ: zaten kanoniktir.
      expect(prepareLabel(label, MAX_LABEL_LENGTH), label).toBe(label);
      expect(
        validateCanonicalLabel(label, MAX_LABEL_LENGTH).ok,
        label,
      ).toBe(true);
    }
  });
});

describe("imzalanan kök GEÇMİŞE göre değişmez", () => {
  function rootWithLabel(label: string): string {
    const bill = createSharedBill({
      recipient: RECIPIENT,
      recipientLabel: prepareLabel(label, MAX_LABEL_LENGTH),
      debts: [
        {
          debtor: DEBTOR,
          debtorLabel: prepareLabel(label, MAX_LABEL_LENGTH),
          debtKey: "x->y",
          tryMinor: 100,
        },
      ],
      nowMs: NOW_MS,
      billId: BILL_ID,
    });
    expect(bill.ok).toBe(true);
    if (!bill.ok) throw new Error("fixture must build");
    return computeSharedBillRoot({
      chainId: bill.manifest.chainId,
      billId: bill.manifest.billId,
      debts: bill.debts,
    });
  }

  it("paylaşılan hesap yedeği YERELLEŞTİRME ÖNCESİ kökü üretir", () => {
    expect(rootWithLabel(SHARED_BILL_UNKNOWN_PARTICIPANT_LABEL)).toBe(
      HISTORICAL_ROOT,
    );
  });

  it("etiketin BİR harfi bile kökü değiştirir", () => {
    /*
     * Bu, yukarıdaki sabitin neden gerektiğini gösterir: aksanlı yazım
     * BAŞKA bir kök üretir. Yerelleştirme sırasında iki metin tek anahtara
     * indirgenirse imzalanan gövde sessizce değişirdi.
     */
    expect(rootWithLabel(PAYMENT_REQUEST_UNKNOWN_PARTICIPANT_LABEL)).not.toBe(
      HISTORICAL_ROOT,
    );
  });

  it("manifestin taahhüdü de aynı köke bağlıdır", () => {
    const bill = createSharedBill({
      recipient: RECIPIENT,
      recipientLabel: SHARED_BILL_UNKNOWN_PARTICIPANT_LABEL,
      debts: [
        {
          debtor: DEBTOR,
          debtorLabel: SHARED_BILL_UNKNOWN_PARTICIPANT_LABEL,
          debtKey: "x->y",
          tryMinor: 100,
        },
      ],
      nowMs: NOW_MS,
      billId: BILL_ID,
    });
    expect(bill.ok).toBe(true);
    if (!bill.ok) return;
    expect(bill.manifest.debtsRoot).toBe(HISTORICAL_ROOT);
    expect(bill.debts[0].debtorLabel).toBe("Bilinmeyen kisi");
  });
});
