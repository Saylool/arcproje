import type { SharedBillManifest } from "@/lib/arc/shared-bill";

import type {
  DeleteAppUserOutcome,
  DeleteContactOutcome,
  ListSavedContactsOutcome,
  SaveContactOutcome,
  SavedContact,
  UpdateContactOutcome,
  CreatedBillSummary,
  CreateSharedBillOutcome,
  ListCreatedBillsOutcome,
  ListRecentDebtorsOutcome,
  RecentDebtorContact,
  ResolveAccessInput,
  ResolveAccessOutcome,
  SessionLookupOutcome,
  SharedBillAttribution,
  SharedBillRecord,
  SharedBillRepository,
  SharedBillStatus,
  StoredSharedBill,
  StoredSharedBillDebt,
} from "./shared-bill-repository";
import {
  debtStatusAfterSettlement,
  isActiveAttemptStatus,
  isAllowedSettlement,
  type ClaimPaymentAttemptInput,
  type ClaimPaymentAttemptOutcome,
  type CreatePaymentOfferInput,
  type CreatePaymentOfferOutcome,
  type DebtPaymentStatus,
  type ReadPaymentAttemptOutcome,
  type ReadPaymentOfferOutcome,
  type RecordSubmissionInput,
  type RecordSubmissionOutcome,
  type SettleAttemptInput,
  type SettleAttemptOutcome,
  type StoredPaymentAttempt,
  type StoredPaymentOffer,
} from "./shared-bill-payment-repository";

/**
 * YALNIZCA TEST İÇİN bellek içi paylaşılan hesap deposu.
 *
 * Üretim yollarına ASLA bağlanmaz: rotalar depoyu yalnızca
 * `createNeonSharedBillRepository` üzerinden alır ve `DATABASE_URL` yoksa
 * kontrollü 503 döner. Bu sahte depo bellekte tuttuğu için hiçbir kalıcılık
 * ya da tekrar oynatma garantisi vermez.
 *
 * Gerçek deponun sözleşmesini taklit eder: atomiklik, hesap kimliği
 * benzersizliği, hesap içi borçlu/borç kimliği benzersizliği, idempotent
 * tekrar kararı, TEK KULLANIMLIK nonce ve süresi dolmuş kayıtların
 * kullanılamaz sayılması.
 */

export type FakeStoredBill = {
  billId: string;
  manifest: SharedBillManifest;
  signature: string;
  status: SharedBillStatus;
  /**
   * Hesabı oluşturan uygulama kullanıcısı. İMZALANAN İÇERİĞİN PARÇASI
   * DEĞİLDİR ve borçlu akışının hiçbir yolunda okunmaz.
   */
  createdByUserId: string | null;
  /** Yazım sırası; gerçek deponun `created_at DESC` sıralamasının karşılığı. */
  writeSequence: number;
  /** Ödeme durumu değiştiği için satırlar DEĞİŞTİRİLEBİLİR tutulur. */
  debts: StoredSharedBillDebt[];
};

export type FakeSession = {
  sessionHash: string;
  billId: string;
  debtor: string;
  chainId: number;
  expiresAtMs: number;
};

export type FakeRepositoryControls = {
  /** Her çağrıda `unavailable` döndürür (veritabanı erişilemez). */
  failWithUnavailable?: boolean;
  /** Her çağrıda `constraint` döndürür (veritabanı kısıtı reddetti). */
  failWithConstraint?: boolean;
  /** Yazma sırasında geri alır; atomiklik testinde kullanılır. */
  throwDuringWrite?: boolean;
};

export type FakeSharedBillRepository = SharedBillRepository & {
  readonly bills: ReadonlyMap<string, FakeStoredBill>;
  readonly sessions: ReadonlyMap<string, FakeSession>;
  readonly consumedNonces: ReadonlySet<string>;
  readonly offers: ReadonlyMap<string, StoredPaymentOffer>;
  readonly attempts: ReadonlyMap<string, StoredPaymentAttempt>;
  readonly calls: number;
  /** app_users karşılığı; testler doğrudan ekleyip çıkarabilir. */
  readonly appUsers: Set<string>;
  controls: FakeRepositoryControls;
};

function nonceKey(billId: string, nonce: string): string {
  return `${billId.toLowerCase()}|${nonce.toLowerCase()}`;
}

export function createFakeSharedBillRepository(
  controls: FakeRepositoryControls = {},
): FakeSharedBillRepository {
  const bills = new Map<string, FakeStoredBill>();
  const sessions = new Map<string, FakeSession>();
  const consumedNonces = new Set<string>();
  const offers = new Map<string, StoredPaymentOffer>();
  const attempts = new Map<string, StoredPaymentAttempt>();
  /** Deneme yaratılma sırası; "en son deneme" belirlenimci olsun diye. */
  const attemptOrder: string[] = [];
  let calls = 0;
  let writeSequence = 0;
  /* Kayıtlı kişiler: kullanıcı kimliği → kayıtlar. */
  const savedContacts = new Map<string, SavedContact[]>();
  /*
   * app_users tablosunun karşılığı. Şemada gerçek bir satır var ve silmenin
   * "bir şey sildi mi" cevabı ona bağlı; sahte depo bunu taklit etmezse
   * eşleşme testi olmayan bir satırı silmeyi başarı sayar.
   */
  const appUsers = new Set<string>();

  function toStored(bill: FakeStoredBill): StoredSharedBill {
    return Object.freeze({
      manifest: bill.manifest,
      signature: bill.signature,
      status: bill.status,
      // Kopya: çağıran ödeme durumunu kazara değiştiremez.
      debts: Object.freeze([...bill.debts]),
    });
  }

  /** Hesap KULLANILABİLİR mi? Süresi dolmuş veya kapalı hesap kullanılamaz. */
  function usable(bill: FakeStoredBill, nowMs: number): boolean {
    return (
      bill.status === "open" && bill.manifest.expiresAt * 1000 > nowMs
    );
  }

  const repository = {
    controls,
    bills,
    sessions,
    consumedNonces,
    offers,
    attempts,
    get calls() {
      return calls;
    },
    savedContacts,
    appUsers,

    async createSharedBill(
      record: SharedBillRecord,
      attribution: SharedBillAttribution,
    ): Promise<CreateSharedBillOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }
      if (repository.controls.failWithConstraint === true) {
        return { ok: false, reason: "constraint" };
      }

      const { manifest, debts, signature } = record;
      const existing = bills.get(manifest.billId.toLowerCase());
      if (existing !== undefined) {
        /*
         * Tekrar YALNIZCA taahhüt, alıcı, imza ve borç sayısı birebir
         * eşleşirse güvenli sayılır. Aksi hâlde üzerine yazılmaz.
         */
        const identical =
          existing.manifest.debtsRoot.toLowerCase() ===
            manifest.debtsRoot.toLowerCase() &&
          existing.signature.toLowerCase() === signature.toLowerCase() &&
          existing.manifest.recipient.toLowerCase() ===
            manifest.recipient.toLowerCase() &&
          existing.manifest.debtCount === manifest.debtCount;
        /*
         * Tekrar kabul edilse bile SAHİP DEĞİŞMEZ. Aynı imzalı gövdeyi ele
         * geçiren başka bir oturum, hesabı kendi üstüne alamaz.
         */
        return identical
          ? { ok: true, created: false }
          : { ok: false, reason: "idConflict" };
      }

      // Kısıtlar ikinci savunma hattıdır; TypeScript doğrulamasına güvenilmez.
      const seenDebtors = new Set<string>();
      const seenKeys = new Set<string>();
      for (const debt of debts) {
        const debtor = debt.debtor.toLowerCase();
        if (seenDebtors.has(debtor) || seenKeys.has(debt.debtKey)) {
          return { ok: false, reason: "constraint" };
        }
        if (BigInt(debt.tryMinor) <= BigInt(0)) {
          return { ok: false, reason: "constraint" };
        }
        seenDebtors.add(debtor);
        seenKeys.add(debt.debtKey);
      }
      if (debts.length !== manifest.debtCount) {
        return { ok: false, reason: "constraint" };
      }

      if (repository.controls.throwDuringWrite === true) {
        // Atomiklik: hiçbir şey yazılmadan geri alınır.
        return { ok: false, reason: "unavailable" };
      }

      writeSequence += 1;
      bills.set(manifest.billId.toLowerCase(), {
        billId: manifest.billId,
        manifest,
        signature,
        status: "open",
        createdByUserId: attribution.createdByUserId,
        writeSequence,
        // KANONİK indeks: satırlar zaten kanonik sırada gelir.
        debts: debts.map((debt, leafIndex) =>
          Object.freeze({
            debtor: debt.debtor,
            debtorLabel: debt.debtorLabel,
            debtKey: debt.debtKey,
            tryMinor: debt.tryMinor,
            leafIndex,
            paymentStatus: "unpaid" as DebtPaymentStatus,
            paidTxHash: null,
            paidAt: null,
          }),
        ),
      });
      return { ok: true, created: true };
    },

    async listBillsCreatedBy(input: {
      createdByUserId: string;
      limit: number;
    }): Promise<ListCreatedBillsOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }

      /*
       * Süzme burada da SORGUNUN karşılığında yapılır: eşleşmeyen hiçbir satır
       * çağırana ulaşmaz. Boş bir kimlik hiçbir şeyle eşleşmez.
       */
      const owned =
        input.createdByUserId.length === 0
          ? []
          : [...bills.values()].filter(
              (bill) => bill.createdByUserId === input.createdByUserId,
            );

      const summaries: CreatedBillSummary[] = owned
        // `created_at DESC` karşılığı: en son yazılan önce.
        .sort((left, right) => right.writeSequence - left.writeSequence)
        .slice(0, Math.max(0, input.limit))
        .map((bill) => {
          // Para BigInt ile toplanır; kayan nokta hiç devreye girmez.
          let total = BigInt(0);
          let paid = BigInt(0);
          let paidCount = 0;
          for (const debt of bill.debts) {
            total += BigInt(debt.tryMinor);
            if (debt.paymentStatus === "paid") {
              paid += BigInt(debt.tryMinor);
              paidCount += 1;
            }
          }
          return Object.freeze({
            billId: bill.billId,
            issuedAt: bill.manifest.issuedAt,
            expiresAt: bill.manifest.expiresAt,
            status: bill.status,
            debtCount: bill.manifest.debtCount,
            paidCount,
            totalTryMinor: total.toString(),
            paidTryMinor: paid.toString(),
          });
        });

      return { ok: true, bills: Object.freeze(summaries) };
    },

    async listSavedContacts(input: {
      userId: string;
      limit: number;
    }): Promise<ListSavedContactsOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }
      const own = savedContacts.get(input.userId) ?? [];
      const sorted = [...own]
        .sort((left, right) =>
          left.label.toLowerCase() < right.label.toLowerCase() ? -1 : 1,
        )
        .slice(0, Math.max(0, input.limit));
      return { ok: true, contacts: Object.freeze(sorted) };
    },

    async saveContact(input: {
      userId: string;
      contactId: string;
      label: string;
      address: string;
      limit: number;
    }): Promise<SaveContactOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }
      const own = savedContacts.get(input.userId) ?? [];
      if (
        own.some(
          (contact) =>
            contact.address.toLowerCase() === input.address.toLowerCase(),
        )
      ) {
        return { ok: false, reason: "duplicateAddress" };
      }
      if (
        own.some(
          (contact) =>
            contact.label.toLowerCase() === input.label.toLowerCase(),
        )
      ) {
        return { ok: false, reason: "duplicateLabel" };
      }
      if (own.length >= input.limit) {
        return { ok: false, reason: "limitReached" };
      }
      const contact = Object.freeze({
        contactId: input.contactId,
        label: input.label,
        address: input.address,
      });
      savedContacts.set(input.userId, [...own, contact]);
      return { ok: true, contact };
    },

    async updateContact(input: {
      userId: string;
      contactId: string;
      label: string;
      address: string;
    }): Promise<UpdateContactOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }
      const own = savedContacts.get(input.userId) ?? [];
      const index = own.findIndex(
        (contact) => contact.contactId === input.contactId,
      );
      if (index === -1) {
        // Yok ya da BASKASININ: ikisi de ayni cevabi verir.
        return { ok: false, reason: "notFound" };
      }
      const clash = own.some(
        (contact, position) =>
          position !== index &&
          contact.address.toLowerCase() === input.address.toLowerCase(),
      );
      if (clash) {
        return { ok: false, reason: "duplicateAddress" };
      }
      const labelClash = own.some(
        (contact, position) =>
          position !== index &&
          contact.label.toLowerCase() === input.label.toLowerCase(),
      );
      if (labelClash) {
        return { ok: false, reason: "duplicateLabel" };
      }
      const contact = Object.freeze({
        contactId: input.contactId,
        label: input.label,
        address: input.address,
      });
      const next = [...own];
      next[index] = contact;
      savedContacts.set(input.userId, next);
      return { ok: true, contact };
    },

    async deleteContacts(input: {
      userId: string;
      contactId?: string;
    }): Promise<DeleteContactOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }
      const own = savedContacts.get(input.userId) ?? [];
      if (input.contactId === undefined) {
        savedContacts.set(input.userId, []);
        return { ok: true, deleted: own.length };
      }
      const next = own.filter(
        (contact) => contact.contactId !== input.contactId,
      );
      savedContacts.set(input.userId, next);
      return { ok: true, deleted: own.length - next.length };
    },

    async deleteAppUser(input: {
      userId: string;
    }): Promise<DeleteAppUserOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }
      const existed = appUsers.delete(input.userId);
      /*
       * Şemadaki yabancı anahtarların YAPTIĞI iş burada elle yapılır:
       * saved_contacts ON DELETE CASCADE, shared_bills ON DELETE SET NULL.
       * Hesap satırlarının KENDİSİ durur.
       */
      savedContacts.delete(input.userId);
      for (const bill of bills.values()) {
        if (bill.createdByUserId === input.userId) {
          bill.createdByUserId = null;
        }
      }
      return { ok: true, deleted: existed };
    },

    async listRecentDebtorsFor(input: {
      createdByUserId: string;
      limit: number;
      notUsedBefore: number;
    }): Promise<ListRecentDebtorsOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }
      if (input.createdByUserId.length === 0) {
        return { ok: true, contacts: Object.freeze([]) };
      }

      /*
       * Gerçek sorgunun `DISTINCT ON` davranışı taklit edilir: adres başına
       * TEK satır ve seçilen satır EN SON kullanımdır.
       */
      const newestPerAddress = new Map<string, RecentDebtorContact>();
      const owned = [...bills.values()]
        .filter((bill) => bill.createdByUserId === input.createdByUserId)
        // En eskiden yeniye: sonra gelen, öncekini yerinden eder.
        .sort((left, right) => left.writeSequence - right.writeSequence);

      for (const bill of owned) {
        // Sinirdan ESKI kullanimlar hic sayilmaz (gercek sorgunun karsiligi).
        if (bill.manifest.issuedAt <= input.notUsedBefore) {
          continue;
        }
        for (const debt of bill.debts) {
          newestPerAddress.set(
            debt.debtor.toLowerCase(),
            Object.freeze({
              address: debt.debtor,
              label: debt.debtorLabel,
              lastUsedAt: bill.manifest.issuedAt,
            }),
          );
        }
      }

      const contacts = [...newestPerAddress.values()]
        .reverse()
        .slice(0, Math.max(0, input.limit));
      return { ok: true, contacts: Object.freeze(contacts) };
    },

    async resolveAccess(
      input: ResolveAccessInput,
    ): Promise<ResolveAccessOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }

      /*
       * NONCE TÜKETİMİ ÖNCE ve ATOMİK. JavaScript tek iş parçacıklı olduğu
       * için bu blokta `await` YOKTUR: aynı nonce ile eşzamanlı iki çağrıdan
       * yalnızca biri buradan geçer.
       */
      const key = nonceKey(input.billId, input.nonce);
      if (consumedNonces.has(key)) {
        return { ok: false, reason: "replay" };
      }
      consumedNonces.add(key);

      const bill = bills.get(input.billId.toLowerCase());
      if (bill === undefined || !usable(bill, input.nowMs)) {
        // GENEL hata: hesap yok / kapalı / süresi dolmuş ayırt edilemez.
        return { ok: false, reason: "notFound" };
      }

      const debt = bill.debts.find(
        (row) => row.debtor.toLowerCase() === input.debtor.toLowerCase(),
      );
      if (debt === undefined) {
        // Bu adres bu hesapta yok — AYNI genel hata döner.
        return { ok: false, reason: "notFound" };
      }

      if (repository.controls.throwDuringWrite === true) {
        return { ok: false, reason: "unavailable" };
      }

      // Oturum, nonce tüketimiyle AYNI mantıksal işlemde yaratılır.
      sessions.set(input.sessionHash, {
        sessionHash: input.sessionHash,
        billId: bill.billId,
        debtor: debt.debtor,
        chainId: input.chainId,
        expiresAtMs: input.sessionExpiresAt,
      });

      return { ok: true, bill: toStored(bill), debt };
    },

    async readSession(input: {
      sessionHash: string;
      nowMs: number;
    }): Promise<SessionLookupOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }

      const session = sessions.get(input.sessionHash);
      if (session === undefined || session.expiresAtMs <= input.nowMs) {
        return { ok: false, reason: "notFound" };
      }
      const bill = bills.get(session.billId.toLowerCase());
      if (bill === undefined || !usable(bill, input.nowMs)) {
        return { ok: false, reason: "notFound" };
      }
      const debt = bill.debts.find(
        (row) => row.debtor.toLowerCase() === session.debtor.toLowerCase(),
      );
      if (debt === undefined) {
        return { ok: false, reason: "notFound" };
      }
      return { ok: true, bill: toStored(bill), debtor: session.debtor, debt };
    },

    /*
     * -----------------------------------------------------------------------
     * ÖDEME YAŞAM DÖNGÜSÜ
     * -----------------------------------------------------------------------
     *
     * Gerçek deponun sözleşmesi taklit edilir: KARŞILAŞTIR-VE-YAZ geçişler,
     * borçlu başına TEK aktif deneme, KÜRESEL olarak benzersiz işlem hash'i
     * ve `paid`den geri dönüşün olmaması.
     *
     * ATOMİKLİK: kritik bloklarda `await` YOKTUR. JavaScript tek iş
     * parçacıklı olduğu için bu, eşzamanlı iki çağrıdan yalnızca birinin
     * geçmesini garanti eder — gerçek deponun tek deyimlik CAS'ının bellek
     * içi karşılığı.
     */

    async createPaymentOffer(
      input: CreatePaymentOfferInput,
    ): Promise<CreatePaymentOfferOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }
      if (repository.controls.failWithConstraint === true) {
        return { ok: false, reason: "constraint" };
      }

      const { offer, nowMs } = input;
      const bill = bills.get(offer.billId.toLowerCase());
      if (bill === undefined || !usable(bill, nowMs)) {
        return { ok: false, reason: "notFound" };
      }
      const debt = findDebt(bill, offer.debtor);
      if (debt === undefined) {
        return { ok: false, reason: "notFound" };
      }
      // Alıcı ve tutar DEPODAN gelir; teklifin bildirdiği değerle eşleşmeli.
      if (
        debt.tryMinor !== offer.tryMinor ||
        bill.manifest.recipient.toLowerCase() !== offer.recipient.toLowerCase()
      ) {
        return { ok: false, reason: "constraint" };
      }
      if (debt.paymentStatus !== "unpaid") {
        return {
          ok: false,
          reason: "notClaimable",
          debtStatus: debt.paymentStatus,
        };
      }
      if (offers.has(offer.offerId)) {
        return { ok: false, reason: "constraint" };
      }
      /*
       * VERİTABANI KISITLARININ BELLEK İÇİ KARŞILIĞI.
       *
       * Bunlar `shared_bill_payment_offers` tablosundaki CHECK kısıtlarını
       * birebir yansıtır. Sahte depo daha gevşek olursa testler yeşil kalır
       * ama ÜRETİM kısıtı reddeder — tam olarak yakalanması gereken sınıf.
       */
      const OFFER_MAX_LIFETIME_SECONDS = 5 * 60;
      if (
        // ..._within_quote: teklif dayandığı kurdan UZUN yaşayamaz.
        offer.expiresAt > offer.quoteExpiresAt ||
        // ..._window_ordered
        offer.expiresAt <= offer.issuedAt ||
        // ..._lifetime_max_5_min
        offer.expiresAt > offer.issuedAt + OFFER_MAX_LIFETIME_SECONDS ||
        // ..._amounts_positive
        BigInt(offer.tryMinor) <= BigInt(0) ||
        BigInt(offer.microUsdc) <= BigInt(0)
      ) {
        return { ok: false, reason: "constraint" };
      }
      if (repository.controls.throwDuringWrite === true) {
        return { ok: false, reason: "unavailable" };
      }

      const stored: StoredPaymentOffer = Object.freeze({
        ...offer,
        consumedAt: null,
      });
      offers.set(stored.offerId, stored);
      return { ok: true, offer: stored };
    },

    async readPaymentOffer(input: {
      offerId: string;
      billId: string;
      debtor: string;
    }): Promise<ReadPaymentOfferOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }
      const offer = offers.get(input.offerId);
      if (
        offer === undefined ||
        offer.billId.toLowerCase() !== input.billId.toLowerCase() ||
        offer.debtor.toLowerCase() !== input.debtor.toLowerCase()
      ) {
        return { ok: false, reason: "notFound" };
      }
      return { ok: true, offer };
    },

    async claimPaymentAttempt(
      input: ClaimPaymentAttemptInput,
    ): Promise<ClaimPaymentAttemptOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }

      /*
       * KRİTİK BLOK — `await` YOK. Eşzamanlı iki claim'den yalnızca biri
       * borcu `reserved` yapabilir; ikincisi `alreadyActive` görür.
       */
      const bill = bills.get(input.billId.toLowerCase());
      if (bill === undefined || !usable(bill, input.nowMs)) {
        return { ok: false, reason: "notFound" };
      }
      const debtIndex = bill.debts.findIndex(
        (row) => row.debtor.toLowerCase() === input.debtor.toLowerCase(),
      );
      if (debtIndex === -1) {
        return { ok: false, reason: "notFound" };
      }
      const debt = bill.debts[debtIndex];

      const offer = offers.get(input.offerId);
      if (
        offer === undefined ||
        offer.billId.toLowerCase() !== input.billId.toLowerCase() ||
        offer.debtor.toLowerCase() !== input.debtor.toLowerCase() ||
        offer.consumedAt !== null ||
        offer.expiresAt * 1000 <= input.nowMs
      ) {
        return { ok: false, reason: "offerUnusable" };
      }
      // Teklifin tutarı depodaki borçla HÂLÂ birebir aynı olmalı.
      if (offer.tryMinor !== debt.tryMinor) {
        return { ok: false, reason: "offerUnusable" };
      }

      if (debt.paymentStatus !== "unpaid") {
        // Rezerve borç için aktif bir deneme vardır; ayrımı çağıran yapar.
        return debt.paymentStatus === "reserved"
          ? { ok: false, reason: "alreadyActive" }
          : {
              ok: false,
              reason: "notClaimable",
              debtStatus: debt.paymentStatus,
            };
      }
      // İkinci savunma hattı: aktif deneme benzersizliği.
      if (
        [...attempts.values()].some(
          (row) =>
            row.billId.toLowerCase() === input.billId.toLowerCase() &&
            row.debtor.toLowerCase() === input.debtor.toLowerCase() &&
            isActiveAttemptStatus(row.status),
        )
      ) {
        return { ok: false, reason: "alreadyActive" };
      }
      if (attempts.has(input.attemptId)) {
        return { ok: false, reason: "notFound" };
      }
      if (repository.controls.throwDuringWrite === true) {
        return { ok: false, reason: "unavailable" };
      }

      const attempt: StoredPaymentAttempt = Object.freeze({
        attemptId: input.attemptId,
        billId: bill.billId,
        debtor: debt.debtor,
        recipient: bill.manifest.recipient,
        offerId: offer.offerId,
        quoteId: offer.quoteId,
        rateNumerator: offer.rateNumerator,
        rateDenominator: offer.rateDenominator,
        // TUTARLAR DEPODAN: istemcinin bildirdiği hiçbir değer kullanılmaz.
        tryMinor: offer.tryMinor,
        microUsdc: offer.microUsdc,
        status: "reserved",
        txHash: null,
        reservedAt: Math.floor(input.nowMs / 1000),
        expiresAt: offer.expiresAt,
        confirmedAt: null,
      });

      // Deneme, borcun rezervasyonu ve teklifin tüketimi BİRLİKTE yazılır.
      attempts.set(attempt.attemptId, attempt);
      attemptOrder.push(attempt.attemptId);
      offers.set(offer.offerId, {
        ...offer,
        consumedAt: Math.floor(input.nowMs / 1000),
      });
      bill.debts[debtIndex] = Object.freeze({
        ...debt,
        paymentStatus: "reserved",
      });
      return { ok: true, attempt };
    },

    async readPaymentAttempt(input: {
      attemptId: string;
      billId: string;
      debtor: string;
    }): Promise<ReadPaymentAttemptOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }
      const attempt = attempts.get(input.attemptId);
      if (
        attempt === undefined ||
        attempt.billId.toLowerCase() !== input.billId.toLowerCase() ||
        attempt.debtor.toLowerCase() !== input.debtor.toLowerCase()
      ) {
        return { ok: false, reason: "notFound" };
      }
      return { ok: true, attempt };
    },

    async readLatestAttempt(input: {
      billId: string;
      debtor: string;
    }): Promise<ReadPaymentAttemptOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }
      for (let index = attemptOrder.length - 1; index >= 0; index -= 1) {
        const attempt = attempts.get(attemptOrder[index]);
        if (
          attempt !== undefined &&
          attempt.billId.toLowerCase() === input.billId.toLowerCase() &&
          attempt.debtor.toLowerCase() === input.debtor.toLowerCase()
        ) {
          return { ok: true, attempt };
        }
      }
      return { ok: false, reason: "notFound" };
    },

    async recordAttemptSubmission(
      input: RecordSubmissionInput,
    ): Promise<RecordSubmissionOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }
      const attempt = attempts.get(input.attemptId);
      if (
        attempt === undefined ||
        attempt.billId.toLowerCase() !== input.billId.toLowerCase() ||
        attempt.debtor.toLowerCase() !== input.debtor.toLowerCase()
      ) {
        return { ok: false, reason: "notFound" };
      }
      // Aynı hash'le tekrar bildirim GÜVENLİDİR.
      if (
        attempt.status === "submitted" &&
        attempt.txHash?.toLowerCase() === input.txHash.toLowerCase()
      ) {
        return { ok: true, attempt };
      }
      if (attempt.status !== "reserved") {
        return {
          ok: false,
          reason: "invalidTransition",
          status: attempt.status,
        };
      }
      if (hashTakenByOther(input.txHash, attempt.attemptId)) {
        return { ok: false, reason: "hashInUse" };
      }

      const next: StoredPaymentAttempt = Object.freeze({
        ...attempt,
        status: "submitted",
        txHash: input.txHash.toLowerCase(),
      });
      attempts.set(next.attemptId, next);
      return { ok: true, attempt: next };
    },

    async settleAttempt(
      input: SettleAttemptInput,
    ): Promise<SettleAttemptOutcome> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return { ok: false, reason: "unavailable" };
      }

      const attempt = attempts.get(input.attemptId);
      if (
        attempt === undefined ||
        attempt.billId.toLowerCase() !== input.billId.toLowerCase() ||
        attempt.debtor.toLowerCase() !== input.debtor.toLowerCase()
      ) {
        return { ok: false, reason: "notFound" };
      }
      const bill = bills.get(attempt.billId.toLowerCase());
      const debtIndex =
        bill?.debts.findIndex(
          (row) => row.debtor.toLowerCase() === attempt.debtor.toLowerCase(),
        ) ?? -1;
      if (bill === undefined || debtIndex === -1) {
        return { ok: false, reason: "notFound" };
      }

      const hash = input.txHash?.toLowerCase() ?? null;

      /*
       * IDEMPOTENS: aynı sonuç ve aynı hash ile tekrar çağrılmak yeniden
       * yazmaz. `confirmed` bir deneme ikinci bir finalize çağrısında da
       * `confirmed` kalır ve borç ASLA `unpaid`e dönmez.
       */
      if (attempt.status === input.settlement) {
        const sameHash =
          (attempt.txHash ?? null) === hash || hash === null;
        if (sameHash) {
          return {
            ok: true,
            attempt,
            debtStatus: bill.debts[debtIndex].paymentStatus,
            billClosed: bill.status === "closed",
            alreadySettled: true,
          };
        }
      }

      if (!isAllowedSettlement(attempt.status, input.settlement)) {
        return {
          ok: false,
          reason: "invalidTransition",
          status: attempt.status,
        };
      }
      if (hash !== null && hashTakenByOther(hash, attempt.attemptId)) {
        return { ok: false, reason: "hashInUse" };
      }
      if (repository.controls.throwDuringWrite === true) {
        return { ok: false, reason: "unavailable" };
      }

      const settledAt = Math.floor(input.nowMs / 1000);
      const nextAttempt: StoredPaymentAttempt = Object.freeze({
        ...attempt,
        status: input.settlement,
        // Hash hiçbir koşulda KAYBEDİLMEZ; `released` zaten hash taşıyamaz.
        txHash: input.settlement === "released" ? null : hash ?? attempt.txHash,
        confirmedAt: input.settlement === "confirmed" ? settledAt : null,
      });

      const debtStatus = debtStatusAfterSettlement(input.settlement);
      const debt = bill.debts[debtIndex];
      // `paid` SON durumdur; hiçbir yerleşim onu geri alamaz.
      if (debt.paymentStatus === "paid") {
        return {
          ok: false,
          reason: "invalidTransition",
          status: attempt.status,
        };
      }

      attempts.set(nextAttempt.attemptId, nextAttempt);
      bill.debts[debtIndex] = Object.freeze({
        ...debt,
        paymentStatus: debtStatus,
        paidTxHash: debtStatus === "paid" ? nextAttempt.txHash : null,
        paidAt: debtStatus === "paid" ? settledAt : null,
      });

      /*
       * Hesap YALNIZCA her borç BAĞIMSIZ olarak onaylandıysa kapanır.
       * Tek bir `review_required` ya da `unpaid` satır kapanmayı engeller.
       */
      let billClosed = bill.status === "closed";
      if (
        !billClosed &&
        bill.debts.every((row) => row.paymentStatus === "paid")
      ) {
        bill.status = "closed";
        billClosed = true;
      }

      return {
        ok: true,
        attempt: nextAttempt,
        debtStatus,
        billClosed,
        alreadySettled: false,
      };
    },

    async cleanupExpiredPaymentRecords(input: {
      nowMs: number;
      limit: number;
    }): Promise<void> {
      calls += 1;
      if (repository.controls.failWithUnavailable === true) {
        return;
      }
      let removed = 0;
      for (const [offerId, offer] of offers) {
        if (removed >= input.limit) break;
        // YALNIZCA süresi dolmuş ve HİÇ KULLANILMAMIŞ teklifler.
        if (offer.consumedAt === null && offer.expiresAt * 1000 < input.nowMs) {
          offers.delete(offerId);
          removed += 1;
        }
      }
      removed = 0;
      for (const [attemptId, attempt] of attempts) {
        if (removed >= input.limit) break;
        /*
         * YALNIZCA KESİN olarak serbest bırakılmış denemeler. `confirmed`,
         * `reverted` ve `unknown` kanıtı ASLA otomatik silinmez.
         */
        if (attempt.status === "released" && attempt.expiresAt * 1000 < input.nowMs) {
          attempts.delete(attemptId);
          const position = attemptOrder.indexOf(attemptId);
          if (position !== -1) attemptOrder.splice(position, 1);
          removed += 1;
        }
      }
    },
  };

  /** Bu hash BAŞKA bir denemeye mi ait? (küresel benzersizlik) */
  function hashTakenByOther(txHash: string, attemptId: string): boolean {
    const target = txHash.toLowerCase();
    for (const row of attempts.values()) {
      if (
        row.attemptId !== attemptId &&
        row.txHash !== null &&
        row.txHash.toLowerCase() === target
      ) {
        return true;
      }
    }
    return false;
  }

  function findDebt(
    bill: FakeStoredBill,
    debtor: string,
  ): StoredSharedBillDebt | undefined {
    return bill.debts.find(
      (row) => row.debtor.toLowerCase() === debtor.toLowerCase(),
    );
  }

  return repository as FakeSharedBillRepository;
}
