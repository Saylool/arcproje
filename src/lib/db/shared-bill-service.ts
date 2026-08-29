import { scanForDuplicateKeys } from "@/lib/arc/json-duplicate-keys";
import {
  buildSharedBillPath,
  describeSharedBillProblem,
  validateSharedBillSubmission,
} from "@/lib/arc/shared-bill";
import { verifySharedBillSignature } from "@/lib/arc/shared-bill-signing";

import type { SharedBillRepository } from "./shared-bill-repository";

/**
 * Paylaşılan hesap oluşturma iş mantığı. HTTP'den BAĞIMSIZ.
 *
 * Rota yalnızca taşıma katmanıdır (içerik türü, boyut, başlıklar); doğrulama,
 * imza kontrolü ve depoya yazma sırası burada yaşar ve gerçek bir veritabanı
 * olmadan, enjekte edilen sahte bir depoyla test edilebilir.
 *
 * SIRA KRİTİKTİR: gövde çözülür → yinelenen anahtar taranır → manifest, borç
 * satırları ve taahhüt KATI biçimde doğrulanır → alıcı imzası doğrulanır →
 * ANCAK ONDAN SONRA veritabanı işlemi açılır. Doğrulanmamış hiçbir veri
 * depoya ulaşmaz.
 *
 * GİZLİLİK: bu modül adres, etiket, imza, manifest veya üretilen bağlantı
 * LOGLAMAZ. Hata mesajları belirli bir cüzdanın bir hesapta olup olmadığını
 * açığa vurmaz.
 */

export type SharedBillServiceSuccess = Readonly<{
  ok: true;
  billId: string;
  path: string;
  expiresAt: number;
  /** Yeni mi yazıldı, yoksa birebir aynı kayıt zaten var mıydı? */
  created: boolean;
}>;

export type SharedBillServiceFailure = Readonly<{
  ok: false;
  status: number;
  code: string;
  message: string;
}>;

export type SharedBillServiceResult =
  | SharedBillServiceSuccess
  | SharedBillServiceFailure;

function failure(
  status: number,
  code: string,
  message: string,
): SharedBillServiceFailure {
  return Object.freeze({ ok: false as const, status, code, message });
}

/** Depoya ait ayrıntı DIŞARI SIZMAZ; yalnızca kontrollü kodlar döner. */
const STORAGE_MESSAGES = {
  idConflict:
    "Bu paylaşılan hesap oluşturulamadı. Lütfen yeniden dene.",
  constraint:
    "Paylaşılan hesap kaydedilemedi; borç listesi kabul edilmedi.",
  unavailable:
    "Paylaşılan hesap servisi şu anda kullanılamıyor. Lütfen birazdan tekrar dene.",
} as const;

export async function createSharedBillFromSubmission(input: {
  bodyText: string;
  repository: SharedBillRepository;
  nowMs: number;
  /**
   * Hesabı oluşturan uygulama kullanıcısı. Rota bunu HER ZAMAN sunucudaki
   * oturumdan verir; istek gövdesinden ASLA okunmaz.
   *
   * Atıf, doğrulamanın hiçbir adımını etkilemez: imza, taahhüt, tutarlar ve
   * zaman penceresi bu değer `null` olsa da aynı şekilde denetlenir.
   */
  createdByUserId: string | null;
}): Promise<SharedBillServiceResult> {
  const { bodyText, repository, nowMs, createdByUserId } = input;

  /*
   * Yinelenen anahtar taraması AYRIŞTIRMADAN ÖNCE çalışır: `JSON.parse` bu
   * belirsizliği sessizce yutar ve aynı gövde iki okuyucuda farklı
   * yorumlanabilir.
   */
  const scan = scanForDuplicateKeys(bodyText);
  if (scan === "duplicate") {
    return failure(
      400,
      "DUPLICATE_FIELD",
      "İstek gövdesinde yinelenen alan var.",
    );
  }
  if (scan === "malformed") {
    return failure(400, "MALFORMED_JSON", "İstek gövdesi okunamadı.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return failure(400, "MALFORMED_JSON", "İstek gövdesi okunamadı.");
  }

  // Manifest, borç satırları, taahhüdün YENİDEN HESAPLANMASI ve zaman penceresi.
  const validated = validateSharedBillSubmission(parsed, nowMs);
  if (!validated.ok) {
    return failure(
      400,
      "INVALID_SHARED_BILL",
      describeSharedBillProblem(validated.problem),
    );
  }
  const bill = validated.bill;

  /*
   * Alıcı imzası. Kurtarılan imzalayan manifestin alıcısı DEĞİLSE hiçbir şey
   * yazılmaz. Hata mesajı hangi adresin beklendiğini açığa vurmaz.
   */
  const verified = await verifySharedBillSignature(
    bill.manifest,
    bill.signature,
  );
  if (!verified.ok) {
    return failure(
      400,
      "INVALID_SIGNATURE",
      "Paylaşılan hesabın imzası doğrulanamadı. Hesap oluşturulmadı.",
    );
  }

  // Doğrulama BİTTİKTEN sonra veritabanı işlemi açılır.
  const stored = await repository.createSharedBill(
    {
      manifest: bill.manifest,
      debts: bill.debts,
      signature: bill.signature,
    },
    /*
     * Atıf imzalı kaydın DIŞINDA, ayrı bir argüman olarak geçer. `bill` yalnız
     * doğrulanmış ve imzalanmış içeriktir; sahiplik ona karışmaz.
     */
    { createdByUserId },
  );

  if (!stored.ok) {
    if (stored.reason === "idConflict") {
      return failure(409, "BILL_ID_UNAVAILABLE", STORAGE_MESSAGES.idConflict);
    }
    if (stored.reason === "constraint") {
      return failure(400, "STORAGE_REJECTED", STORAGE_MESSAGES.constraint);
    }
    return failure(503, "SERVICE_UNAVAILABLE", STORAGE_MESSAGES.unavailable);
  }

  /*
   * Yanıt ASGARİDİR: borç listesi, adresler, etiketler, taahhüt ve imza
   * DÖNMEZ. Yalnızca paylaşılabilir kimlik, göreli yol ve bitiş anı.
   */
  return Object.freeze({
    ok: true as const,
    billId: bill.manifest.billId,
    path: buildSharedBillPath(bill.manifest.billId),
    expiresAt: bill.manifest.expiresAt,
    created: stored.created,
  });
}
