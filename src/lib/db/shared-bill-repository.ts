import type { SharedBillDebt, SharedBillManifest } from "@/lib/arc/shared-bill";

import type {
  DebtPaymentStatus,
  SharedBillPaymentRepository,
} from "./shared-bill-payment-repository";

/**
 * Paylaşılan hesap deposunun SINIRI (repository boundary).
 *
 * İş kuralları bu arayüze bağlıdır, Neon'a değil. Böylece rota ve doğrulama
 * mantığı gerçek bir veritabanı olmadan test edilebilir; testler enjekte
 * edilen sahte bir depo kullanır.
 *
 * Bu modül SAF tiptir: hiçbir sürücü import etmez, bu yüzden istemci paketine
 * girse bile veritabanı kodu taşımaz.
 */

/** Depoya yazılacak eksiksiz kayıt. Kur, fiş ve ürün verisi İÇERMEZ. */
export type SharedBillRecord = Readonly<{
  manifest: SharedBillManifest;
  debts: readonly SharedBillDebt[];
  signature: string;
}>;

/**
 * Hesabı oluşturan uygulama kullanıcısı. İMZALANAN İÇERİĞİN PARÇASI DEĞİLDİR.
 *
 * Bilerek `SharedBillRecord`un DIŞINDA, ayrı bir argüman olarak taşınır:
 * böylece atıf, manifeste ya da Merkle yapraklarına yanlışlıkla karışamaz.
 * Kayıt imzalanan içeriktir; bu ise yalnızca sunucunun tuttuğu bir not.
 *
 * `null`: oturum kimliği yoksa ya da tanınmıyorsa. Hesap yine oluşturulur —
 * atıf, hesabın kendisinden daha az önemlidir.
 */
export type SharedBillAttribution = Readonly<{
  /** `app_users.user_id` (uuid) ya da atıf yoksa `null`. */
  createdByUserId: string | null;
}>;

/**
 * Oluşturan kişiye gösterilen hesap ÖZETİ.
 *
 * Bilerek asgaridir: borçlu adresleri, etiketler, borç anahtarları, taahhüt
 * ve imza YOKTUR. Oluşturan kişi bu bilgileri zaten kendi cihazında üretmişti;
 * sunucu onları geri yaymak zorunda değil.
 */
export type CreatedBillSummary = Readonly<{
  billId: string;
  /** Unix saniye; imzalı manifestten. */
  issuedAt: number;
  expiresAt: number;
  status: SharedBillStatus;
  debtCount: number;
  /** `paid` durumundaki borç satırı sayısı. */
  paidCount: number;
  /** KANONİK ondalık tam sayı metni; `number`a ASLA indirgenmez. */
  totalTryMinor: string;
  paidTryMinor: string;
}>;

/**
 * Oluşturan kişinin GEÇMİŞTE kullandığı bir borçlu kaydı.
 *
 * Yeni bir tabloya gerek yoktur: bu bilgi zaten kişinin KENDİ oluşturduğu
 * hesaplarda duruyor. Bu yüzden "rehber" ayrı bir veri deposu değil, mevcut
 * verinin okunmuş hâlidir — yeni bir gizlilik yüzeyi açılmaz.
 *
 * ETİKET BİR YETKİ DEĞİLDİR. Adresin yerine ASLA geçmez; yalnızca kullanıcının
 * kimi kastettiğini hatırlaması içindir. Öneri kabul edildiğinde adres, elle
 * yazılmış gibi AYNI doğrulamadan geçer.
 */
export type RecentDebtorContact = Readonly<{
  /** Checksum'lı adres. */
  address: string;
  /** Bu adres için EN SON kullanılan etiket. */
  label: string;
  /** Unix saniye: adresin en son kullanıldığı hesabın yazım anı. */
  lastUsedAt: number;
}>;

/**
 * KAYITLI KİŞİ — kullanıcının kendi adres defterindeki kalıcı kayıt.
 *
 * Geçmişten türetilen öneriden farkı: bunu kullanıcı BİLEREK kaydetti,
 * adlandırdı ve istediği zaman siler. Öneri katmanı yalnızca burada
 * bulunamayan kişiler için devreye girer.
 *
 * ETİKET BİR YETKİ DEĞİLDİR. Adresin yerine geçmez; seçilen adres her zaman
 * elle yazılmış gibi doğrulanır.
 */
export type SavedContact = Readonly<{
  contactId: string;
  label: string;
  /** Checksum'lı adres. */
  address: string;
}>;

export type ListSavedContactsOutcome =
  | { ok: true; contacts: readonly SavedContact[] }
  | { ok: false; reason: "unavailable" };

export type SaveContactOutcome =
  | { ok: true; contact: SavedContact }
  /** Bu adres zaten kayıtlı. */
  | { ok: false; reason: "duplicateAddress" }
  /** Bu ad başka birine verilmiş. Belirsizlik burada yanlış adres demektir. */
  | { ok: false; reason: "duplicateLabel" }
  /** Defter üst sınıra ulaştı. */
  | { ok: false; reason: "limitReached" }
  | { ok: false; reason: "unavailable" };

export type UpdateContactOutcome =
  | { ok: true; contact: SavedContact }
  | { ok: false; reason: "notFound" }
  | { ok: false; reason: "duplicateAddress" }
  | { ok: false; reason: "duplicateLabel" }
  | { ok: false; reason: "unavailable" };

export type DeleteContactOutcome =
  | { ok: true; deleted: number }
  | { ok: false; reason: "unavailable" };

export type ListRecentDebtorsOutcome =
  | { ok: true; contacts: readonly RecentDebtorContact[] }
  /** Depo yapılandırılmamış veya erişilemiyor. Boş listeyle KARIŞTIRILMAZ. */
  | { ok: false; reason: "unavailable" };

export type ListCreatedBillsOutcome =
  | { ok: true; bills: readonly CreatedBillSummary[] }
  /** Depo yapılandırılmamış veya erişilemiyor. Boş listeyle KARIŞTIRILMAZ. */
  | { ok: false; reason: "unavailable" };

/**
 * Hesabın durumu.
 *
 * `open` yalnızca "hesap hâlâ paylaşılabilir" demektir. Ödemenin yapıldığını
 * ya da borcun kapandığını İDDİA ETMEZ; ödeme kesinleştirme Part 2'dedir.
 */
export type SharedBillStatus = "open" | "closed";

export type CreateSharedBillOutcome =
  /** Yeni kayıt atomik olarak yazıldı. */
  | { ok: true; created: true }
  /**
   * Aynı kimlikte BİREBİR AYNI kayıt zaten vardı (taahhüt ve imza eşleşti):
   * güvenli tekrar (idempotent). Yeniden yazılmadı.
   */
  | { ok: true; created: false }
  /**
   * Aynı kimlikte FARKLI bir kayıt var. Bu 256 bitlik bir kimlikte pratikte
   * imkânsızdır; yine de sessizce üzerine YAZILMAZ.
   */
  | { ok: false; reason: "idConflict" }
  /** Veritabanı kısıtı reddetti (benzersizlik, pozitiflik, yabancı anahtar). */
  | { ok: false; reason: "constraint" }
  /** Depo yapılandırılmamış veya erişilemiyor. */
  | { ok: false; reason: "unavailable" };

/** Depodan okunan tek borç satırı; kanonik Merkle indeksiyle birlikte. */
export type StoredSharedBillDebt = Readonly<{
  debtor: string;
  debtorLabel: string;
  debtKey: string;
  /** KANONİK ondalık tam sayı metni; `number`a ASLA indirgenmez. */
  tryMinor: string;
  /** Kanıt üretimi için saklanan kanonik indeks. */
  leafIndex: number;
  /** Ödeme durum makinesi (Part 3). */
  paymentStatus: DebtPaymentStatus;
  /** YALNIZCA sunucu tarafında doğrulanmış makbuzla dolar. */
  paidTxHash: string | null;
  /** Unix saniye. */
  paidAt: number | null;
}>;

/** Depodan okunan hesap. Fiş, ürün veya kur verisi İÇERMEZ. */
export type StoredSharedBill = Readonly<{
  manifest: SharedBillManifest;
  signature: string;
  status: SharedBillStatus;
  /** TÜM satırlar — YALNIZCA sunucu tarafında; kanıt üretimi için gerekir. */
  debts: readonly StoredSharedBillDebt[];
}>;

export type ResolveAccessInput = Readonly<{
  billId: string;
  debtor: string;
  /** Tek kullanımlık değer; atomik olarak tüketilir. */
  nonce: string;
  nonceExpiresAt: number;
  /** Oturum jetonunun SHA-256 özeti; ham jeton ASLA gönderilmez. */
  sessionHash: string;
  sessionExpiresAt: number;
  chainId: number;
  nowMs: number;
}>;

/**
 * Erişim çözümlemesinin sonucu.
 *
 * `notFound` GENEL bir hatadır: hesabın olmaması, kapalı olması, süresinin
 * dolmuş olması ve bu adrese ait borç bulunmaması AYNI cevabı verir. Böylece
 * bir saldırgan "bu cüzdan bu hesapta var mı?" sorusunu YANIT ÜZERİNDEN
 * ayırt edemez.
 */
export type ResolveAccessOutcome =
  | { ok: true; bill: StoredSharedBill; debt: StoredSharedBillDebt }
  /** Nonce daha önce kullanılmış: tekrar oynatma. */
  | { ok: false; reason: "replay" }
  | { ok: false; reason: "notFound" }
  | { ok: false; reason: "unavailable" };

export type SessionLookupOutcome =
  | {
      ok: true;
      bill: StoredSharedBill;
      /** Oturumun bağlı olduğu, kimliği doğrulanmış borçlu. */
      debtor: string;
      debt: StoredSharedBillDebt;
    }
  | { ok: false; reason: "notFound" }
  | { ok: false; reason: "unavailable" };

/**
 * Paylaşılan hesap deposunun TAM sözleşmesi: erişim + ödeme yaşam döngüsü.
 *
 * Ödeme tarafı ayrı bir modülde tanımlıdır (`./shared-bill-payment-repository`)
 * ama TEK bir sınır olarak sunulur: rotalar tek bir depo alır.
 */
export type SharedBillRepository = SharedBillPaymentRepository &
  Readonly<{
  /**
   * Hesabı ve TÜM borç satırlarını ATOMİK olarak yazar.
   *
   * Kısmi bir yazma bırakmaz: satırlardan biri reddedilirse hesap da
   * yazılmaz. Çağıran, doğrulamanın TAMAMINI bu çağrıdan ÖNCE yapmış olmalıdır.
   */
  createSharedBill(
    record: SharedBillRecord,
    attribution: SharedBillAttribution,
  ): Promise<CreateSharedBillOutcome>;

  /**
   * Yalnızca VERİLEN uygulama kullanıcısının oluşturduğu hesapları döndürür.
   *
   * Süzme depo sorgusunun KENDİSİNDE yapılır; çağıranın döndükten sonra
   * filtrelemesi beklenmez. Kimliği istemci veremez: rota onu her zaman
   * sunucudaki oturumdan alır.
   *
   * Süresi dolmuş ve kapanmış hesaplar da DÖNER: oluşturan kişi kendi
   * geçmişini görmelidir. Borçlu tarafındaki `notFound` gizliliği bu listeyi
   * bağlamaz, çünkü burada okuyan kişi hesabın sahibidir.
   */
  listBillsCreatedBy(input: {
    createdByUserId: string;
    /** Üst sınır; çağıran her zaman sonlu bir değer verir. */
    limit: number;
  }): Promise<ListCreatedBillsOutcome>;

  /**
   * Kişinin KENDİ hesaplarında geçmişte kullandığı borçluları döndürür.
   *
   * Adres başına TEK satır; etiket ve zaman EN SON kullanımdan gelir. Süzme
   * depo sorgusunun kendisinde yapılır ve kimliği istemci veremez.
   *
   * Süresi dolmuş hesaplar da sayılır: kişi hâlâ aynı kişidir, hesabın
   * geçerliliği rehberi ilgilendirmez.
   */
  /**
   * Kullanıcının KAYITLI kişileri, ada göre sıralı.
   *
   * Her işlem `user_id` ile sınırlıdır: başkasının kişisine, kimliği bilinse
   * bile dokunulamaz. Bu kısıt sorgunun İÇİNDEDİR, çağıranın nezaketine
   * bırakılmaz.
   */
  listSavedContacts(input: {
    userId: string;
    limit: number;
  }): Promise<ListSavedContactsOutcome>;

  /** Yeni kişi ekler. Adres ve ad kullanıcı başına BENZERSİZ olmalıdır. */
  saveContact(input: {
    userId: string;
    contactId: string;
    label: string;
    address: string;
    limit: number;
  }): Promise<SaveContactOutcome>;

  /** Var olan kişinin adını ve/veya adresini değiştirir. */
  updateContact(input: {
    userId: string;
    contactId: string;
    label: string;
    address: string;
  }): Promise<UpdateContactOutcome>;

  /**
   * Kişi siler. `contactId` verilmezse kullanıcının TÜM defteri silinir.
   *
   * Toplu silme, bu tablonun açtığı gizlilik yüzeyinin karşılığıdır: kalıcı
   * bir kayıt tutuyorsak kullanıcı onu tümüyle geri alabilmelidir.
   */
  deleteContacts(input: {
    userId: string;
    contactId?: string;
  }): Promise<DeleteContactOutcome>;

  listRecentDebtorsFor(input: {
    createdByUserId: string;
    limit: number;
    /**
     * Unix saniye: bu andan ESKİ kullanımlar hiç dönmez.
     *
     * Bayat adres yanlış transfer demektir ve transfer geri alınamaz. Bu
     * yüzden sınır çağıranın tercihi değil, deponun sözleşmesinin parçasıdır.
     */
    notUsedBefore: number;
  }): Promise<ListRecentDebtorsOutcome>;

  /**
   * Erişimi ATOMİK olarak çözer: nonce'u tüketir VE oturumu yaratır.
   *
   * Nonce tüketimi ile oturum yaratma aynı işlemdedir; ikisi birden olur ya
   * da hiçbiri olmaz. Aynı nonce ile eşzamanlı iki istek gelirse EN FAZLA
   * BİRİ başarılı olur.
   *
   * Çağıran, meydan okuma etiketini ve borçlunun EIP-712 imzasını bu
   * çağrıdan ÖNCE doğrulamış olmalıdır.
   */
  resolveAccess(input: ResolveAccessInput): Promise<ResolveAccessOutcome>;

  /**
   * Oturum özetinden hesabı ve kimliği doğrulanmış borçlunun satırını okur.
   *
   * Süresi dolmuş oturum ve hesap FİZİKSEL olarak silinmemiş olsa bile
   * KULLANILAMAZ sayılır.
   */
  readSession(input: {
    sessionHash: string;
    nowMs: number;
  }): Promise<SessionLookupOutcome>;
  }>;
