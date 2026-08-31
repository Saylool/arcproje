/**
 * TÜRKÇE SÖZLÜK — uygulamanın TEK metin kaynağı.
 *
 * Bu nesne aynı zamanda `Dictionary` TİPİNİ üretir; `en.ts` bu tiple
 * bildirildiği için eksik veya fazla anahtar DERLENMEZ. Böylece iki dil
 * arasındaki anahtar eşliği derleme zamanında zorunlu olur.
 *
 * KURALLAR:
 * - Metinler DÜZ METİNDİR. HTML etiketi içermezler ve hiçbir zaman
 *   `dangerouslySetInnerHTML` ile basılmazlar; React metin düğümü olarak
 *   basar ve kaçışlar otomatiktir.
 * - Değişkenler `{ad}` biçiminde yazılır ve `translate` tarafından TEK GEÇİŞTE
 *   değiştirilir; yerine konan metin yeniden taranmaz.
 * - Kişi adları, ürün adları, satıcı adları, cüzdan adresleri, işlem
 *   kimlikleri, ağ adları ve `USDC` gibi jeton kodları BURADA BULUNMAZ; onlar
 *   veridir ve çevrilmez.
 * - `plurals` bölümü sayıya bağlı metinler içindir ve `translatePlural` ile
 *   okunur; `translate` bu bölüme İNMEZ.
 */

export const tr = {
  /* --------------------------------------------------------------------- */
  /* Uygulama kabuğu                                                         */
  /* --------------------------------------------------------------------- */
  app: {
    name: "Hesabı Böl",
    tagline: "Fişini yükle, ürünleri arkadaşlarına dağıt, herkesin payını hesapla.",
  },

  language: {
    /** Dil seçicinin erişilebilir etiketi. */
    label: "Dil seçimi",
    tr: "Türkçe",
    en: "English",
  },

  theme: {
    toDark: "Karanlık moda geç",
    toLight: "Aydınlık moda geç",
    neutral: "Temayı değiştir",
  },

  auth: {
    continueWithGoogle: "Google ile devam et",
    loading: "İşleniyor…",
    signOut: "Çıkış yap",
    signedInState: "Google oturumu",
    safeFallbackName: "Oturum açık",
    unavailableShort: "Giriş kullanılamıyor",
    unavailable:
      "Kimlik doğrulama şu anda kullanılamıyor. Lütfen daha sonra yeniden dene.",
    analysisRequired: "Fişi analiz etmek için Google ile oturum açmalısın.",
    chooseAgainAfterSignIn:
      "Gizliliğin için seçtiğin görsel giriş yönlendirmesinde tutulmaz. Döndüğünde fiş görselini yeniden seçmen gerekecek.",
    failureTitle: "Oturum açılamadı",
    failureMessage:
      "Kimlik doğrulama şu anda tamamlanamadı. Lütfen ana sayfaya dönüp yeniden dene.",
    backHome: "Ana sayfaya dön",
  },

  metadata: {
    homeTitle: "Hesabı Böl — Fişini yükle",
    homeDescription:
      "Fişini yükle, ürünleri arkadaşlarına dağıt, herkesin payını hesapla.",
    payTitle: "Ödeme talebi — Hesabı Böl",
    payDescription:
      "Sana gönderilen imzalı ödeme talebini kendi cüzdanınla öde.",
    sharedBillTitle: "Ortak hesap — Hesabı Böl",
    sharedBillDescription:
      "Kendi borcunu görmek için cüzdanını bağla ve kimlik doğrulama mesajı imzala.",
    authErrorTitle: "Oturum hatası — Hesabı Böl",
  },

  /* --------------------------------------------------------------------- */
  /* Ortak                                                                   */
  /* --------------------------------------------------------------------- */
  common: {
    back: "Geri don",
    copy: "Kopyala",
    copied: "Kopyalandı",
    share: "Paylaş",
    remove: "Kaldır",
    change: "Değiştir",
    delete: "Sil",
    unnamed: "(isimsiz)",
    unknownParticipant: "Bilinmeyen kişi",
    notSelected: "Seçilmedi",
    notEntered: "Girilmedi",
    notConnected: "Bağlanmadı",
    dash: "—",
    /** Cüzdan adresi alanları için biçim ipucu; iki dilde de aynıdır. */
    addressPlaceholder: "0x…",
    testNetworkBadge: "TEST AĞI",
    copyAddress: "Adresi kopyala",
    addressCopied: "Adres panoya kopyalandı.",
    addressCopyFailed:
      "Tarayıcı pano erişimine izin vermedi. Adresi yukarıdan seçip elle kopyalayabilirsin.",
    linkCopyFailed: "Bağlantı kopyalanamadı. Elle seçip kopyalayabilirsin.",
    faucet: "Circle Faucet",
    arcDocs: "Arc dokümanı",
    arcSetup: "Arc Testnet kurulumu",
    viewOnArcScan: "ArcScan'de gör",
    openOnArcScan: "İşlemi ArcScan'de aç",
    showOnArcScan: "ArcScan'de görüntüle",
    transaction: "İşlem:",
    unknownChain: "bilinmiyor",
  },

  /* --------------------------------------------------------------------- */
  /* Cüzdan — üç ekranda ortak                                               */
  /* --------------------------------------------------------------------- */
  wallet: {
    fallbackName: "Cüzdan",
    connect: "Cüzdanı bağla",
    connectAccount: "Hesabı bağla",
    connectShort: "Bağla",
    select: "Cüzdan seç",
    notFound: "Tarayıcıda cüzdan bulunamadı.",
    notFoundInstall:
      "Tarayıcında cüzdan bulunamadı. MetaMask gibi bir EIP-6963 cüzdanı kurup sayfayı yenile.",
    multipleFound: "Birden fazla cüzdan bulundu, birini seç:",
    connectRejected: "Cüzdan bağlantısı reddedildi.",
    connectFailed: "Cüzdana bağlanılamadı.",
    switchTo: "{network} ağına geç",
    switchToArc: "Arc Testnet'e geç",
    switchRejected: "Ağ değişikliği reddedildi.",
    switchFailed: "Arc Testnet'e geçilemedi.",
    switchFailedPickManually: "Ağ değiştirilemedi. Cüzdandan Arc Testnet'i seç.",
    connectedAccount: "Bağlı hesap:",
    connectedWallet: "Bağlı cüzdan:",
    notArcWithChain: "Arc Testnet değil (zincir {chainId})",
    recipientIs: "Alici:",
    recipientIsYou: "Alıcı (sen):",
  },

  /* --------------------------------------------------------------------- */
  /* İlerleme çubuğu                                                         */
  /* --------------------------------------------------------------------- */
  progress: {
    label: "İlerleme durumu",
    receipt: "Fiş",
    participants: "Kişiler",
    payment: "Ödeme",
    current: "(şu anki adım)",
    completed: "(tamamlandı)",
    upcoming: "(sonraki aşama, henüz hazır değil)",
    notCompleted: "(henüz tamamlanmadı)",
  },

  /* --------------------------------------------------------------------- */
  /* Akış başlıkları ve analiz                                               */
  /* --------------------------------------------------------------------- */
  flow: {
    receiptTitle: "Fişini yükle",
    receiptDescription:
      "Fişin fotoğrafını ekle. Sonraki adımlarda ürünleri kişilere dağıtıp herkesin payını hesaplayacağız.",
    participantsTitle: "Ürünleri kişilere dağıt",
    participantsDescription:
      "Kişileri ekle ve her ürünü kimin aldığını işaretle. Bir ürünü birden fazla kişiye atayabilirsin.",
    summaryTitle: "Ürünleri kişilere dağıt",
    summaryDescription:
      "Atamaların hazır. Kontrol edip herkesin payını hesaplayabilirsin.",
    debtsTitle: "Payları kontrol et",
    debtsDescription:
      "Herkesin payı ve fişi ödeyene olan borcu aşağıda. Tutarlar kuruşuna kadar dağıtıldı.",
    paymentTitle: "Ödeme talebi oluştur",
    paymentDescription:
      "Fişi sen ödedin. Her borçlu için ayrı bir ödeme talebi imzala; borçlu kendi cüzdanında onaylasın.",

    analyze: "Fişi analiz et",
    analyzing: "Analiz ediliyor…",
    retry: "Tekrar dene",
    reanalyze: "Yeniden analiz et",
    uploadNotice:
      "Fiş görselin analiz için OpenAI'ye gönderilir. Görsel sunucuda saklanmaz.",
    reading: "Fişteki ürünler okunuyor, bu birkaç saniye sürebilir…",
    toParticipants: "Kişilere dağıt",
    checkBeforeSplit: "Ürünleri kişilere dağıtmadan önce tutarları kontrol et.",

    liveAnalyzing: "Fiş analiz ediliyor.",
    livePayment: "Ödeme talebi adımındasın.",
    liveDebts: "Paylar hesaplandı.",
    liveSummary: "Atamalar hazır. Özet gösteriliyor.",
    liveParticipants: "Kişi atama adımındasın.",
    liveReady: "Fiş analizi tamamlandı. Ürünleri düzenleyebilirsin.",
  },

  /* --------------------------------------------------------------------- */
  /* Fiş yükleme                                                             */
  /* --------------------------------------------------------------------- */
  upload: {
    sectionLabel: "Fiş yükleme",
    inputLabel: "Fiş görseli seç",
    dropHere: "Fişini buraya sürükle",
    orPick: "ya da cihazından bir görsel seç",
    pickButton: "Fiş görseli seç",
    hint: "JPG, PNG veya WEBP · en fazla 10 MB",
    previewAlt: "Seçilen fiş görseli: {name}",
    selectedLive: "{name} seçildi. Fiş yüklemeye hazır.",

    unsupportedType:
      "Bu dosya türü desteklenmiyor. Lütfen JPG, PNG veya WEBP formatında bir fiş görseli seç.",
    emptyFile: "Dosya boş görünüyor. Lütfen fişin okunabilir bir fotoğrafını seç.",
    tooLarge: "Görsel çok büyük ({size}). En fazla 10 MB yükleyebilirsin.",
  },

  /* --------------------------------------------------------------------- */
  /* Fiş düzenleyici                                                         */
  /* --------------------------------------------------------------------- */
  editor: {
    sectionLabel: "Fiş içeriği",
    unknownMerchant: "Satıcı adı okunamadı",
    currencyLine: "Para birimi: {currency} · Analiz sonucunu kontrol edip düzeltebilirsin.",
    unknownCurrency: "belirlenemedi",
    analysisNotes: "Analiz notları",
    items: "Ürünler",
    emptyItems: "Ürün listesi boş. Aşağıdan ürün ekleyebilirsin.",
    itemNamePlaceholder: "Ürün adı",
    itemNameLabel: "{index}. ürünün adı",
    itemAmountLabel: "{index}. ürünün tutarı",
    itemDeleteLabel: "{index}. ürünü sil",
    addItem: "+ Ürün ekle",
    itemsSubtotal: "Ürünler toplamı",
    tax: "Vergi (KDV)",
    serviceCharge: "Servis ücreti",
    discount: "İndirim",
    total: "Genel toplam",
    addsToTotal: "Ayrı uygula seçilirse genel toplama eklenir.",
    subtractsFromTotal: "Ayrı uygula seçilirse genel toplamdan düşülür.",
    treatmentLabel: "{label} nasıl uygulanacak",
    treatmentLabelWithHint: "{label} nasıl uygulanacak. {hint}",
    treatmentIncluded: "Ürün fiyatlarına dahil",
    treatmentSeparate: "Ayrı uygula",
    treatmentUnknown: "Belirsiz",

    mismatchPrefix: "Ürünler ve ayrı uygulanan kalemler ",
    mismatchMiddle: " ediyor ama fişteki genel toplam ",
    mismatchSuffix:
      ". Değerleri senin onayın olmadan değiştirmiyoruz; kontrol edip düzeltebilirsin.",
    indeterminatePrefix: "Bazı ücretlerin ürün fiyatlarına dahil olup olmadığı belirsiz: ",
    indeterminateSuffix:
      ". Bu yüzden genel toplamı doğrulamıyoruz. Yukarıdaki seçimleri güncelleyerek netleştirebilirsin.",
    adjustmentTax: "vergi",
    adjustmentServiceCharge: "servis ücreti",
    adjustmentDiscount: "indirim",
  },

  /* --------------------------------------------------------------------- */
  /* Kişiler ve atamalar                                                     */
  /* --------------------------------------------------------------------- */
  participants: {
    /** Akış her zaman kullanıcının kendisiyle başlar. */
    defaultName: "Sen",
    sectionLabel: "Kişiler ve ürün atamaları",
    title: "Kişileri ekle, ürünleri dağıt",
    description:
      "Bir ürünü birden fazla kişiye atarsan o ürün seçtiğin kişiler arasında eşit bölünür.",
    heading: "Kişiler",
    empty: "Hiç kişi yok. Aşağıdan kişi ekle.",
    namePlaceholder: "İsim",
    nameLabel: "{index}. kişinin adı",
    deleteLabel: "{name} kişisini sil",
    positionalName: "{index}. kişi",
    newNamePlaceholder: "Yeni kişi adı",
    newNameLabel: "Yeni kişi adı",
    add: "+ Kişi ekle",
    payerLegend: "Fişi kim ödedi?",
    itemsHeading: "Ürünler",
    addPeopleFirst: "Önce kişi ekle.",
    itemUnassigned: "Bu ürün henüz kimseye atanmadı.",
    save: "Atamaları kaydet",
    backToReceipt: "Fişe dön",

    receiptInvalid: "Fiş verisi geçerli değil. Tutarları kontrol edip tekrar dene.",
    receiptNoItems: "Fişte hiç ürün yok. Kişilere dağıtmadan önce en az bir ürün ekle.",
    receiptEmptyNames: "Bazı ürünlerin adı boş. Devam etmeden önce her ürüne bir ad ver.",
    namesInvalid: "Kişi isimleri boş olamaz ve birbirinin aynısı olamaz.",
  },

  /* --------------------------------------------------------------------- */
  /* Atama özeti                                                             */
  /* --------------------------------------------------------------------- */
  assignmentSummary: {
    sectionLabel: "Atama özeti",
    title: "Atamalar hazır",
    description:
      "Ürünlerin kimlere ait olduğunu kaydettik. Şimdi herkesin payını hesaplayabiliriz.",
    payer: "Fişi ödeyen",
    participantCount: "Kişi sayısı",
    assignedItems: "Atanmış ürün",
    sharedItems: "Paylaşılan ürün",
    calculate: "Payları hesapla",
    fixReceipt: "Fişi düzelt",
    editAssignments: "Atamaları düzenle",
  },

  /* --------------------------------------------------------------------- */
  /* Pay ve borç özeti                                                       */
  /* --------------------------------------------------------------------- */
  debts: {
    sectionLabel: "Pay ve borç özeti",
    title: "Kimin ne kadar payı var",
    /** `{payer}` kalın yazılır; şablon yalnızca düz metin taşır. */
    paidBy: "Fişi {payer} ödedi. Diğerleri payları kadar ona borçlu.",
    payerBadge: "ödeyen",
    itemShare: "Ürün payı",
    taxShare: "Vergi payı",
    serviceShare: "Servis payı",
    discountShare: "İndirim payı",
    includedInPrice: "— fiyata dahil",
    totalsMatchPrefix: "Payların toplamı ",
    totalsMatchSuffix: " — fişteki genel toplamla birebir aynı. Hiçbir kuruş kaybolmadı.",
    totalsMismatch:
      "Payların toplamı {allocated}, fişteki genel toplam {stated}. Bu bir hesaplama hatası.",
    heading: "Borçlar",
    none: "Ödeyen dışında kimsenin payı yok, bu yüzden borç oluşmadı.",
    /** Türkçede ad yönelme hâline girer: "Ali, Ayşe'ye". */
    owes: "{from}, {to}",
    /** Tutardan SONRA gelen ek. İngilizcede boştur ve basılmaz. */
    owesSuffix: "borçlu",
    roundingDescription:
      "Bölünemeyen kuruşlar kaybolmaz. Ürünlerde artan kuruş, ürün sırasına göre dönüşümlü olarak farklı kişiye verilir. Ayrı uygulanan vergi ve servis, kişilerin ürün payı oranında en büyük kalan yöntemiyle dağıtılır ve eşitlik durumunda öncelik kalemden kaleme kaydırılır. Ayrı uygulanan indirim ise kişinin indirim öncesi bakiyesi oranında düşülür; böylece kimsenin payı yuvarlama yüzünden eksiye düşmez.",
    createRequest: "Ödeme talebi oluştur",
    editAssignments: "Atamaları düzenle",
    editReceipt: "Fişi düzelt",
    footnote:
      "Her borçlu için ayrı bir ödeme talebi imzalarsın; borçlu kendi cüzdanında onaylar. Arc Testnet test USDC'si kullanılır.",
  },

  /* --------------------------------------------------------------------- */
  /* Ortak hesap oluşturucu (fişi ödeyen)                                    */
  /* --------------------------------------------------------------------- */
  sharedBill: {
    titleOnlyTry: "Ortak odeme baglantisi",
    onlyTry: "Bu adim yalnizca TRY fisleri icin kullanilabilir.",
    title: "Tek baglanti olustur",
    introPrefix:
      "Fisi odeyen cuzdanini bir kez baglarsin, her borclu icin bir adres girersin ve ",
    introSignature: "tek bir imza",
    introMiddle: " atarsin. ",
    introAllSame: "Butun borclular ayni baglantiyi alir.",
    noticePrefix: "Bu imza yalnizca bir ",
    noticeRequest: "talep olusturur",
    noticeSuffix:
      ". Kimsenin cuzdanindan para cekemez ve hicbir transfer yetkisi vermez. Transferi her borclu kendi cuzdaninda imzalar. Ag: {network} — test USDC'sinin gercek parasal degeri yoktur.",
    stepWallet: "1. Fisi odeyen cuzdan",
    stepAddresses: "2. Her borclu icin bir cuzdan adresi",
    stepLink: "3. Tek baglanti — herkese ayni",
    noDebts: "Paylasilacak bir borc yok.",
    signing: "Imzalaniyor…",
    signAndCreate: "Imzala ve tek baglanti olustur",
    stale:
      "Girdiler degisti; onceki baglanti artik gecerli degil. Yeniden imzalayip yeni bir baglanti olustur.",
    qrLabel: "Ortak odeme baglantisinin QR kodu",
    linkNotice:
      "Baglanti borc listesini, adresleri veya isimleri TASIMAZ; yalnizca tahmin edilemez bir kimlik icerir. Baglantiyi acan herkes hesabi gorebilir, bu yuzden yalnizca ilgili kisilerle paylas. En fazla {days} gun gecerlidir.",
    faucetPrefix: "Test USDC'si icin ",
    shareTitle: "Hesabi Bol",
    shareText: "Ortak hesap odeme baglantisi",
    createFailed: "Paylasilan hesap olusturulamadi. Lutfen tekrar dene.",
  },

  /* --------------------------------------------------------------------- */
  /* Ortak hesap — borçlu görünümü                                           */
  /* --------------------------------------------------------------------- */
  /* Oluşturduğun hesaplar — sahiplik listesi                                */
  /* --------------------------------------------------------------------- */
  /* Adres rehberi — geçmiş hesaplardan türetilir                            */
  /* --------------------------------------------------------------------- */
  contacts: {
    hint: "Daha önce kullandığın adresler",
    suggestionsLabel: "Geçmişten adres önerileri",
    useAddress: "{label} kişisinin adresini kullan",
    lastUsed: "son: {date}",
    failed: "Kayıtlı kişiler şu anda okunamıyor.",
    verifyNotice:
      "Öneri yalnızca alanı doldurur. Göndermeden önce tam adresi kendin doğrula; yanlış adrese giden transfer geri alınamaz.",
  },

  /* --------------------------------------------------------------------- */
  myBills: {
    title: "Oluşturduğun hesaplar",
    subtitle:
      "Yalnızca bu Google hesabıyla oluşturduğun ortak ödeme bağlantıları.",
    authorityNotice:
      "Bu liste yalnızca bir kayıttır. Bir hesabı oluşturmuş olmak hiçbir ödeme yetkisi VERMEZ: parayı yalnızca borçlu, kendi cüzdanında imzalayarak gönderir.",
    refresh: "Yenile",
    loading: "Hesapların yükleniyor…",
    empty: "Bu hesapla henüz ortak ödeme bağlantısı oluşturmadın.",
    truncated:
      "Yalnızca en yeni {count} hesap gösteriliyor; daha eskileri bu listede yok.",
    failed: "Hesap listen şu anda okunamıyor. Lütfen birazdan tekrar dene.",
    copyLink: "Bağlantıyı kopyala",
    copied: "Kopyalandı",
    copyFailed:
      "Tarayıcı pano erişimini engelledi. Bağlantıyı açıp adres çubuğundan kopyalayabilirsin.",
    openLink: "Bağlantıyı aç",
    issuedAt: "Veriliş: {date}",
    expiresAt: "Bitiş: {date}",
    statusOpen: "Açık",
    statusClosed: "Kapalı",
    statusExpired: "Süresi doldu",
    amountPaid: "{paid} / {total} ödendi",
    listLabel: "Oluşturduğun ortak hesapların listesi",
  },

  /* --------------------------------------------------------------------- */
  sharedPay: {
    sectionLabel: "Ortak hesap",
    title: "Ortak hesap — kendi borcun",
    introPrefix: "Bu bağlantı gruptaki ",
    introEveryone: "herkese aynı",
    introMiddle: " gönderildi. Kendi borcunu görmek için cüzdanını bağlayıp bir ",
    introAuthMessage: "kimlik doğrulama mesajı",
    introSuffix: " imzalaman gerekiyor.",
    noticePrefix: "Bu imza bir ",
    noticeNotATransaction: "işlem değildir",
    noticeSuffix:
      ": hiçbir token onaylamaz, hiçbir transfer yetkisi vermez ve cüzdanından para çekmez. Yalnızca bu adresi kontrol ettiğini kanıtlar. Kimlik doğrulaması değil, yalnızca adres sahipliği kanıtıdır. Geçerlilik: {minutes} dakika.",
    authenticate: "İmzala ve borcumu gör",
    stepChallenge: "Erişim isteği alınıyor…",
    stepSignature: "Cüzdanda imza bekleniyor…",
    stepLookup: "Borç aranıyor…",
    stepVerify: "İmza ve kanıt doğrulanıyor…",
    yourDebt: "Senin borcun",
    debtorToRecipient: "{debtor} → {recipient} (fişi ödeyen)",
    recipientAddress: "Alıcı cüzdan adresi",
    validUntil: "Bu bağlantı {date} tarihine kadar geçerli.",
    networkNotePrefix: "Ağ: {network}. Test USDC'sinin ",
    networkNoteStrong: "gerçek parasal değeri yoktur",
    networkNoteSuffix: ". Test parası için ",

    /* Ödeme paneli */
    payTitle: "Borcunu öde",
    notOnArcPrefix: "Ödeme için cüzdanın ",
    notOnArcNetwork: "Arc Testnet",
    notOnArcSuffix: " ağında olmalı.",
    getRate: "Güncel kuru al",
    stepRate: "Güncel kur alınıyor…",
    stepEstimate: "İşlem tahmini alınıyor…",
    stepReserve: "Ödeme rezerve ediliyor…",
    stepWalletConfirm: "Cüzdanda onay bekleniyor…",
    rowDebtTry: "Borç (TRY)",
    rowRate: "Kur (1 USDC)",
    rowToSend: "Gönderilecek",
    rowRateExpires: "Kur teklifi biter",
    rowEstimatedFee: "Tahmini ücret",
    recipientAddressFull: "Alıcı cüzdan adresi (tam)",
    rateSourcePrefix: "Kur kaynağı: ",
    rateSourceName: "CoinGecko",
    rateSourceSuffix:
      " (sunucu tarafından doğrulanmış teklif). Tutar, borcun ve bu kurun tam sayı aritmetiğiyle türetilmiştir.",
    estimateButton: "İşlemi tahmin et",
    reviewNoticePrefix: "Gönderen, alıcı, tutar ve ağı yukarıdan ",
    reviewNoticeOneByOne: "tek tek",
    reviewNoticeMiddle: " kontrol et. Onaya bastığında cüzdanın açılacak ve transferi ",
    reviewNoticeOnlyYou: "yalnızca sen",
    reviewNoticeSuffix: " imzalayacaksın.",
    payWithArc: "Arc Testnet ile öde",
    confirmingStrong: "Doğrulanıyor.",
    confirmingMiddle: " Ödeme, sunucu zincirden makbuzu doğrulayana kadar ",
    confirmingNotDone: "tamamlanmış sayılmaz",
    paidStrong: "Ödendi.",
    paidRest:
      " Sunucu işlemi Arc Testnet üzerinde doğruladı: gönderen, alıcı ve tutar birebir eşleşti.",
    noteSubmitted: "İşlem gönderildi; sunucu zincirden doğruluyor…",
    noteAmbiguous: "Sonuç belirsiz; sunucu zincirden doğruluyor…",
    noteNetworkRetry: "Ağ yanıtı alınamadı; yeniden deneniyor…",
    noteWaitingConfirmations: "Zincirde onay bekleniyor ({seen}/{required})…",
    notOnArcNotSent: "Cüzdan Arc Testnet'te değil. Gönderim başlatılmadı.",
    unexpectedReconcile:
      "Sunucudan beklenmeyen bir mutabakat yanıtı geldi. İşlemi ArcScan'de kontrol et.",
    reverted:
      "İşlem zincire ulaştı ama BAŞARISIZ oldu (revert). Ödeme yapılmadı; gas harcanmış olabilir. Ayrıntıyı ArcScan'de gör.",
    reviewRequired:
      "İşlem doğrulandı ama BEKLENEN transferi kanıtlamıyor (tutar, taraf veya token uyuşmuyor). Borç ödenmiş SAYILMADI ve otomatik tekrar KAPALIDIR. ArcScan'den kontrol edip hesabı oluşturan kişiyle görüş.",
    reconcileTimeout:
      "İşlemin sonucu ayrılan sürede doğrulanamadı. TEKRAR DENEME: aynı ödeme iki kez gidebilir. Aşağıdaki bağlantıdan ArcScan'de kontrol et; daha sonra bu sayfayı yenileyip durumu yeniden sorgulayabilirsin.",
    startFailed: "Ödeme başlatılamadı. Lütfen tekrar dene.",
    viewFailed: "Borç görüntülenemedi. Lütfen tekrar dene.",
  },

  /* --------------------------------------------------------------------- */
  /* Ödeme talebi oluşturucu (eski akış)                                     */
  /* --------------------------------------------------------------------- */
  request: {
    sectionLabel: "Ödeme talebi oluştur",
    title: "Ödeme talebi oluştur",
    introPrefix: "Fişi sen ödedin, yani ",
    introRecipient: "alıcı",
    introMiddle: " sensin. Her borç için ayrı bir talep imzalarsın; ",
    introDebtorOpens: "borçlu bu bağlantıyı açıp ödemeyi kendi cüzdanında onaylar.",
    introSuffix: " İmzan yalnızca talebi oluşturur, kimsenin cüzdanından para çekmez.",
    notTry:
      "Bu fişin para birimi TRY değil ({currency}). Arc ödemesi şu an yalnızca TRY fişler için destekleniyor.",
    stepWallet: "1 · Fişi ödeyen / alıcı cüzdanı",
    stepRate: "2 · Kur (otomatik)",
    stepDebt: "3 · Borç ve borçlu / gönderen adresi",
    stepSign: "4 · Talebi imzala",
    stepLink: "5 · Talep bağlantısı",
    rateLoading: "Kur alınıyor…",
    rateRetry: "Kuru yeniden dene",
    rateRefresh: "Kuru yenile",
    rowRate: "Kur",
    rowUpdated: "Güncelleme",
    rowValidity: "Geçerlilik",
    rateExpiredShort: "süresi doldu",
    rateCountdown: "{minutes} dk {seconds} sn",
    rateExpired: "Kur teklifinin süresi doldu. Talep oluşturmak için kuru yenile.",
    rateExplains:
      "Kur sunucuda alınır ve sunucu tarafından imzalanır; ödeme talebine bu imzalı teklif yazılır. Borçlunun tarayıcısı kuru ayrıca sunucuya doğrulatır.",
    coingeckoAttribution: "Data provided by CoinGecko",
    noDebts: "Ödeme talebi gereken borç yok.",
    /** "{from} (borçlu), {to} {amount} borçlu" — Türkçe yönelme hâliyle. */
    debtOptionSuffix: "(borçlu), {to} {amount} borçlu",
    debtorAddressLabel: "{name} cüzdan adresi",
    invalidAddress: "Geçerli bir cüzdan adresi değil.",
    rowDebtTry: "Borç (TRY)",
    rowRateSource: "Kur kaynağı",
    rowAmountRequested: "İstenecek tutar",
    rowDebtor: "Borçlu / gönderen",
    rowDebtorAddress: "Borçlu adresi",
    rowPayer: "Fişi ödeyen / alıcı",
    rowRecipientAddress: "Alıcı adresi",
    rowNetwork: "Ağ",
    signing: "Cüzdanda imzalanıyor…",
    create: "Ödeme talebi oluştur",
    signaturePrefix: "Cüzdanın yalnızca bir ",
    signatureWord: "imza",
    signatureSuffix: " soracak. Bu imza para göndermez.",
    sendToPrefix: "Bu bağlantıyı ",
    sendToSuffix:
      " kişisine gönder. Borçlu bu bağlantıyı açıp ödemeyi kendi cüzdanında onaylar.",
    qrLabel: "Talep bağlantısının QR kodu",
    copyLink: "Talep bağlantısını kopyala",
    linkWarningPrefix:
      "Bu bağlantı kişi adlarını, cüzdan adreslerini ve ödeme tutarını içerir; yalnızca ilgili borçluyla paylaş. ",
    linkWarningStrong:
      "Bağlantı yalnızca kur teklifi geçerli olduğu sürece — en fazla 5 dakika — kullanılabilir.",
    linkWarningEndsAt: " Bitiş: {date}",
    linkWarningExpired: " (süresi doldu)",
    linkWarningRemaining: " ({minutes} dk {seconds} sn kaldı)",
    linkWarningSuffix:
      ". Bağlantı teknik olarak tekrar açılabilir — aynı borç için ikinci bir ödeme yapılmasını engelleyen bir sunucu veya zincir üstü kayıt yoktur.",
    linkExpired:
      "Bu bağlantının süresi doldu ve artık ödenemez. Kuru yenileyip yeni bir talep imzala.",
    liveSigning: "Ödeme talebi cüzdanda imzalanıyor.",
    liveReady: "Ödeme talebi bağlantısı hazır.",
    backToShares: "Paylara dön",
    faucetPrefix: "Test USDC için ",
    faucetMiddle: ", ağ kurulumu için ",
    shareTitle: "Ödeme talebi",
    shareText: "Hesabı Böl ödeme talebi",
    refreshHint: "Kuru yenileyip talebi yeniden imzala.",
  },

  /* --------------------------------------------------------------------- */
  /* Ödeme talebi ödeme sayfası (borçlu)                                     */
  /* --------------------------------------------------------------------- */
  payer: {
    pageTitle: "Ödeme talebini öde",
    pageDescription:
      "Talebi kontrol et ve ödemeyi kendi cüzdanında onayla. Tutarlar Arc Testnet test USDC'sidir.",
    loadingRequest: "Ödeme talebi yükleniyor…",
    sectionLabel: "Ödeme talebi",
    verifying: "Ödeme talebi doğrulanıyor…",
    invalidTitle: "Bu ödeme talebi geçersiz",
    invalidNotice:
      "Güvenlik gereği geçersiz bir talep için cüzdan bağlama veya ödeme seçenekleri gösterilmez. Bağlantıyı sana gönderen kişiden yeni bir talep iste.",
    noRequestInLink: "Bağlantıda ödeme talebi bulunamadı.",
    signerMismatch:
      "Talebi imzalayan hesap, talepteki alıcı değil. Bu bağlantıya güvenme.",
    signatureUnverified:
      "Ödeme talebinin imzası doğrulanamadı. Bu bağlantıya güvenme.",
    title: "Ödeme talebi",
    signatureVerifiedBadge: "cüzdan imzası doğrulandı",
    signedByPrefix: "Bu talep, ",
    signedBySuffix: " adresli cüzdan tarafından imzalandı. Ödemeyi ",
    signedByYouConfirm: "kendi cüzdanında sen onaylarsın",
    signedByEnd: "; kimse senin cüzdanından para çekemez.",
    labelsWarningStrong: "İsimler kimlik kanıtı değildir.",
    labelsWarningMiddle:
      " “{recipient}” ve “{debtor}” bu talebi oluşturan kişinin yazdığı etiketlerdir. İmza yalnızca ",
    labelsWarningAddress: "cüzdan adresinin",
    labelsWarningAfterAddress:
      " bu talebi imzaladığını kanıtlar; kişinin gerçek veya yasal kimliğini kanıtlamaz. Ödemeden önce aşağıdaki tam alıcı adresini, fişi ödeyen kişiyle ",
    labelsWarningChannel: "güvendiğin bir iletişim kanalından",
    labelsWarningEnd: " (yüz yüze, telefon) karşılaştır.",
    rowDebtor: "Borçlu / gönderen",
    rowSenderAddress: "Gönderen adresi",
    rowPayer: "Fişi ödeyen / alıcı",
    rowRecipientAddress: "Alıcı adresi",
    rowDebtTry: "Borç (TRY)",
    rowRate: "Kur",
    rowRateSource: "Kur kaynağı",
    rowRateObservedAt: "Kur gözlem zamanı",
    rowRateValidity: "Kur geçerliliği",
    rowToSend: "Gönderilecek",
    rowNetwork: "Ağ",
    rowValidity: "Geçerlilik",
    recipientDisclosure: "Alıcı (fişi ödeyen) adresinin tamamı",
    senderDisclosure: "Gönderen (senin) adresinin tamamı",
    immutablePrefix:
      "Bu alanlar imzalıdır ve değiştirilemez. Tutar, adresler ve ağ talebi imzalayan kişi tarafından belirlenmiştir. ",
    immutableStrong:
      "Cüzdan imzası tek başına kurun piyasa değeri olduğunu kanıtlamaz.",
    immutableSuffix:
      " Kur, sunucu tarafından CoinGecko'dan alınıp imzalanmıştır ve bu sayfa açılırken sunucuya ayrıca doğrulatılmıştır.",
    connectHeading: "Kendi cüzdanını bağla",
    debtorMismatch:
      "Bağlı hesap, talepteki borçlu adresiyle aynı değil. Bu talebi yalnızca {debtor} ödeyebilir.",
    priorSuccess:
      "Bu talep için bu tarayıcıdan zaten başarılı bir gönderim yapılmış görünüyor. Tekrar göndermeden önce ArcScan'de kontrol et.",
    priorPending:
      "Bu talep için bir gönderim sürüyor (bu sekmede veya başka bir sekmede). Aynı ödemeyi iki kez göndermemek için burada beklet.",
    priorReverted:
      "Bu talep için yapılan gönderim zincire ulaştı ama BAŞARISIZ oldu (revert). Ödeme yapılmadı; tekrar denemeden önce ArcScan'de ve MetaMask geçmişinde kontrol et.",
    priorUnknown:
      "Bu talep için bu tarayıcıdan bir gönderim başlatılmış ama sonucu doğrulanamamış: ödeme yapılmış da olabilir, yapılmamış da. Tekrar göndermeden önce MetaMask işlem geçmişini ve ArcScan'i kontrol et.",
    priorLocalOnly:
      "Bu kayıt yalnızca bu tarayıcıda tutulur; başka bir cihazdan veya gizli sekmeden yapılan gönderimi bilemez.",
    estimating: "Tahmin alınıyor…",
    estimate: "İşlemi tahmin et",
    estimatedFee: "Tahmini ağ ücreti (gas, ayrı hesaplanır ve tutardan düşülmez): {fee}",
    confirmCheckbox:
      "Yukarıdaki imzalı talebi okudum. Kurun sunucu tarafından CoinGecko'dan alınıp doğrulandığını ve gönderilecek tutarın Arc Testnet test USDC'si olduğunu anlıyorum.",
    confirmInWallet: "Cüzdanda onayla",
    reverifying: "Talep ve kur yeniden doğrulanıyor…",
    waitingWallet: "İşlem cüzdanda bekleniyor…",
    sentAmount: "Ödeme gönderildi ({amount} USDC).",
    sentNotice:
      "Bu sayfada aynı talep için tekrar gönderim kapatıldı. Ödeyen kişinin sayfası bu ödemeyi otomatik olarak öğrenmez; ona bilgi vermen gerekir.",
    liveEstimating: "İşlem tahmini alınıyor.",
    liveVerifying: "Talep ve kur yeniden doğrulanıyor.",
    liveSending: "İşlem cüzdanda bekleniyor.",
    liveSent: "Ödeme gönderildi.",
    footnotePrefix: "Test USDC için ",
    footnoteMiddle: ", ağ kurulumu için ",
    footnoteSuffix:
      ". Bu bağlantı teknik olarak tekrar açılabilir; aynı borcun ikinci kez ödenmesini engelleyen bir sunucu veya zincir üstü kayıt yoktur.",
    reverifyFailed:
      "Ödeme talebinin cüzdan imzası artık doğrulanamıyor. Gönderim yapılmadı.",
    differentRequest:
      "Bağlantıdaki talep, incelediğin talep değil. Gönderim yapılmadı; sayfayı yenileyip yeniden incele.",
    otherTabSending:
      "Bu talep için başka bir sekmede gönderim sürüyor. Aynı ödemeyi iki kez göndermemek için burada durduruldu; MetaMask ve ArcScan'i kontrol et.",
    alreadySucceeded:
      "Bu talep için bu tarayıcıdan zaten başarılı bir gönderim kaydı var. Tekrar göndermeden önce ArcScan'de kontrol et.",
    unverifiedSubmission:
      "Bu talep için bu tarayıcıdan sonucu doğrulanmamış bir gönderim var. Tekrar göndermeden önce MetaMask geçmişini ve ArcScan'i kontrol et.",
    askForNewLink: "Talebi oluşturan kişiden yeni bir bağlantı iste.",
  },

  /* --------------------------------------------------------------------- */
  /* Hata sözlükleri — kararlı kodlarla anahtarlanır                          */
  /* --------------------------------------------------------------------- */
  errors: {
    /** Bilinmeyen bir sunucu kodu için güvenli genel karşılık. */
    generic: "Bir şeyler ters gitti. Lütfen tekrar dene.",
    analyzeFailed: "Fiş analiz edilemedi. Lütfen tekrar dene.",
    analyzeTimeout: "Analiz zaman aşımına uğradı. Lütfen tekrar dene.",
    network: "Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.",
    rateService: "Kur servisine ulaşılamadı. Bağlantını kontrol edip tekrar dene.",
    rateMalformed: "Kur servisinden beklenmeyen bir yanıt geldi.",
    submissionUnavailable:
      "Bu tarayıcı, aynı ödemenin iki kez gönderilmesini engelleyecek kilidi (Web Locks) veya doğrulanabilir yerel kaydı sağlamıyor. Güvenlik gereği gönderim BAŞLATILMADI. Güncel bir tarayıcıda, gizli olmayan bir sekmede ve site verilerine izin vererek tekrar dene.",
    unsafeAmount:
      "Tutarlar güvenli sayı aralığını aşıyor, bu yüzden kuruşu kuruşuna hesaplama yapılamıyor. Fişteki tutarları kontrol et.",
    indeterminateTotals:
      "Bazı ücretlerin ürün fiyatlarına dahil olup olmadığı belirsiz. Payları hesaplamadan önce fiş ekranından bunu netleştir.",
    mismatchedTotals:
      "Ürün toplamı ile fişteki genel toplam uyuşmuyor. Payları hesaplamadan önce fiş ekranından tutarları düzelt.",
    allocationMismatch:
      "Dağıtılan paylar fişteki genel toplama eşit çıkmadı. Fiş tutarlarını kontrol et.",
    zeroChargeWeight:
      "Ürün toplamı sıfırken ayrıca uygulanan bir ücret var. Bu tutarın kimlere dağıtılacağı belirlenemiyor.",
    zeroDiscountWeight:
      "Dağıtılabilir tutar sıfırken indirim uygulanıyor. Bu tutarın kimlerden düşüleceği belirlenemiyor.",
    discountExceedsBalance:
      "İndirim, dağıtılabilir tutardan büyük. Fişteki indirim değerini veya uygulama biçimini kontrol et.",
    negativeParticipantShare:
      "Bir kişinin payı eksiye düşüyor. İndirim tutarını veya atamaları kontrol et.",

    conversion: {
      empty: "Kur girilmedi.",
      invalid: "Geçerli bir kur gir (örn. 1 USDC = 34,25 TRY).",
      ambiguous:
        "Bu yazım binlik ayracı mı ondalık mı belli değil. Ondalık kısmı 1, 2 veya 4-6 basamak olacak şekilde yaz.",
      tooManyDecimals: "Kurda en fazla {max} ondalık basamak kullanabilirsin.",
      tooLong: "Kur en fazla {maxLength} karakter ve {maxDigits} tam basamak olabilir.",
      tooLarge: "Girilen kur mantıklı bir aralığın dışında.",
      notPositive: "Kur sıfırdan büyük olmalı.",
    },

    paymentRequest: {
      notAnObject: "Ödeme talebi okunamadı.",
      unexpectedField: "Ödeme talebinde beklenmeyen alan var.",
      missingField: "Ödeme talebinde eksik alan var.",
      unsupportedSchemaVersion: "Bu ödeme talebi sürümü desteklenmiyor.",
      outdatedSchemaVersion:
        "Bu bağlantı, kurun elle girildiği eski bir sürümle oluşturulmuş. Artık kur sunucu tarafından doğrulanıyor; talebi oluşturan kişiden yeni bir bağlantı iste.",
      invalidQuote:
        "Talepteki kur teklifi geçersiz. Bu bağlantıya güvenme; gönderen kişiden yeni bir talep iste.",
      requestOutlivesQuote:
        "Talebin geçerlilik süresi dayandığı kur teklifinden uzun. Bu bağlantıya güvenme.",
      invalidRequestId: "Talep kimliği geçersiz.",
      invalidChainId: "Talep Arc Testnet için oluşturulmamış.",
      invalidRecipient: "Alıcı adresi geçersiz.",
      invalidDebtor: "Borçlu adresi geçersiz.",
      selfTransfer: "Gönderen ve alıcı aynı adres olamaz.",
      invalidDebtKey: "Borç kimliği geçersiz.",
      invalidAmount: "Talepteki tutar geçersiz.",
      inconsistentAmount:
        "Talepteki USDC tutarı, borç ve kurla uyuşmuyor. Bu bağlantıya güvenme; gönderen kişiden yeni bir talep iste.",
      invalidRate: "Talepteki kur geçersiz.",
      invalidLabel: "Talepteki isim alanı geçersiz.",
      invalidTimestamps: "Talebin zaman bilgisi geçersiz.",
      expired: "Bu ödeme talebinin süresi dolmuş.",
      notYetValid: "Bu ödeme talebi henüz geçerli değil.",
      lifetimeTooLong: "Talebin geçerlilik süresi izin verilenden uzun.",
      invalidSignatureFormat: "Talep imzası geçersiz biçimde.",
    },

    codec: {
      tooLong: "Ödeme talebi bağlantısı beklenenden uzun.",
      malformedEncoding: "Ödeme talebi bağlantısı bozuk.",
      malformedJson: "Ödeme talebi içeriği okunamadı.",
      duplicateKey: "Ödeme talebinde yinelenen alan var.",
      invalidEnvelope: "Ödeme talebi yapısı beklenen biçimde değil.",
    },

    requestSigning: {
      noProvider: "Cüzdan bağlantısı bulunamadı. Cüzdanı yeniden bağla.",
      rejected: "İmza cüzdanda reddedildi.",
      noAccount: "Cüzdanda açık bir hesap yok.",
      accountChanged:
        "Cüzdandaki aktif hesap, talebin alıcısı değil. Fişi ödeyen hesaba geçip tekrar dene.",
      networkChanged:
        "Cüzdan Arc Testnet'te değil. Ağı Arc Testnet'e alıp tekrar dene.",
      invalidPayload:
        "Ödeme talebi kendi doğrulamamızdan geçmedi; cüzdana hiçbir şey gönderilmedi. Tutarı, kuru ve adresleri kontrol edip tekrar dene.",
      invalidRecipient: "Alıcı cüzdan adresi geçersiz.",
      signatureFormat: "Cüzdan beklenen biçimde bir imza döndürmedi.",
      signerMismatch:
        "İmzayı atan hesap talebin alıcısıyla eşleşmiyor. Talep oluşturulmadı.",
      signFailed: "Ödeme talebi imzalanamadı. Lütfen tekrar dene.",
    },

    send: {
      noProvider: "Cüzdan bağlantısı bulunamadı. Cüzdanı yeniden bağla.",
      rejected: "İşlem cüzdanda reddedildi.",
      noAccount: "Cüzdanda açık bir hesap yok. Cüzdanı açıp yeniden bağla.",
      accountChanged:
        "Cüzdandaki aktif hesap, onayladığın ödemenin göndericisi değil. Doğru hesaba geçip tekrar dene.",
      networkChanged:
        "Cüzdan Arc Testnet'te değil. Ağı Arc Testnet'e alıp tekrar dene.",
      invalidRecipient: "Alıcı cüzdan adresi geçerli değil.",
      invalidSender: "Gönderen cüzdan adresi geçerli değil.",
      selfTransfer: "Gönderen ve alıcı aynı cüzdan adresi. Kendine ödeme yapılamaz.",
      invalidAmount: "Gönderilecek tutar geçerli değil.",
      invalidRate: "Ödeme talebindeki kur geçerli değil.",
      inconsistentAmount:
        "Gönderilecek tutar, borç ve kurla uyuşmuyor; gönderim yapılmadı. Talebi oluşturan kişiden yeni bir bağlantı iste.",
      invalidRequestId: "Ödeme talebinin kimliği geçersiz.",
      invalidRequestTime:
        "Ödeme talebinin geçerlilik bilgisi geçersiz; gönderim yapılmadı. Talebi oluşturan kişiden yeni bir bağlantı iste.",
      expiredRequest:
        "Bu ödeme talebinin süresi doldu; gönderim yapılmadı. Talebi oluşturan kişiden yeni bir bağlantı iste.",
      invalidQuoteId: "Ödeme talebindeki kur teklifi kimliği geçersiz.",
      expiredQuote:
        "Talebin dayandığı kur teklifinin süresi doldu; gönderim yapılmadı. Talebi oluşturan kişiden yeni bir bağlantı iste.",
      insufficientTimeRemaining:
        "Kur teklifinin bitişine çok az kaldı; işlem onaylanmadan süresi dolabilirdi. Gönderim başlatılmadı. Talebi oluşturan kişiden yeni bir bağlantı iste.",
      submissionUnknown:
        "İşlem cüzdana GÖNDERİLDİ ama sonucu doğrulanamadı. TEKRAR DENEME: aynı ödeme iki kez gidebilir. Önce MetaMask'taki işlem geçmişini ve ArcScan'i kontrol et; işlem görünmüyorsa yeni bir bağlantı iste.",
      reverted:
        "İşlem zincire ulaştı ama BAŞARISIZ oldu (revert). Ödeme yapılmadı ama gas harcanmış olabilir. Aşağıdaki işlem bağlantısından ArcScan'de ayrıntıyı gör; tekrar denemeden önce MetaMask geçmişini de kontrol et.",
      insufficientFunds:
        "Bakiye veya gas yetersiz. Circle Faucet'ten test USDC alıp tekrar dene.",
      estimateFailed: "İşlem tahmini alınamadı. Ağ veya tutarı kontrol edip tekrar dene.",
      sendFailed: "İşlem gönderilemedi. Lütfen tekrar dene.",
    },

    sharedBill: {
      notAnObject: "Paylaşılan hesap okunamadı.",
      unexpectedField: "Paylaşılan hesapta beklenmeyen alan var.",
      missingField: "Paylaşılan hesapta eksik alan var.",
      unsupportedSchemaVersion: "Bu paylaşılan hesap sürümü desteklenmiyor.",
      invalidBillId: "Paylaşılan hesap kimliği geçersiz.",
      invalidChainId: "Paylaşılan hesap Arc Testnet için oluşturulmamış.",
      invalidRecipient: "Alıcı adresi geçersiz.",
      invalidLabel: "İsim alanı geçersiz.",
      invalidDebtor: "Borçlu adresi geçersiz.",
      selfTransfer: "Alıcı kendi kendine borçlu olamaz.",
      duplicateDebtor: "Aynı borçlu adresi birden fazla kez kullanılamaz.",
      duplicateDebtKey: "Aynı borç kimliği birden fazla kez kullanılamaz.",
      invalidDebtKey: "Borç kimliği geçersiz.",
      invalidAmount: "Borç tutarı geçersiz.",
      noDebts: "Paylaşılan hesapta hiç borç yok.",
      tooManyDebts: "Paylaşılan hesapta izin verilenden fazla borç var.",
      debtCountMismatch: "Borç sayısı manifest ile uyuşmuyor.",
      commitmentMismatch:
        "Borç listesi, imzalanan taahhütle uyuşmuyor. Bu hesaba güvenme.",
      invalidProof:
        "Borcun imzalanan köke ait olduğu kanıtlanamadı. Bu hesaba güvenme.",
      legacyAggregateSchema:
        "Bu paylaşılan hesap, artık desteklenmeyen eski bir taahhüt biçimiyle oluşturulmuş. Hesabı oluşturan kişiden yeni bir bağlantı iste.",
      invalidTimestamps: "Paylaşılan hesabın zaman bilgisi geçersiz.",
      expired: "Bu paylaşılan hesabın süresi dolmuş.",
      notYetValid: "Bu paylaşılan hesap henüz geçerli değil.",
      lifetimeTooLong: "Paylaşılan hesabın geçerlilik süresi izin verilenden uzun.",
      invalidSignatureFormat: "Paylaşılan hesap imzası geçersiz biçimde.",
    },

    access: {
      notAnObject: "Erişim isteği okunamadı.",
      unexpectedField: "Erişim isteğinde beklenmeyen alan var.",
      missingField: "Erişim isteğinde eksik alan var.",
      unsupportedVersion: "Bu erişim isteği sürümü desteklenmiyor.",
      invalidBillId: "Hesap kimliği geçersiz.",
      invalidChainId: "Erişim isteği Arc Testnet için oluşturulmamış.",
      invalidDebtor: "Cüzdan adresi geçersiz.",
      invalidNonce: "Erişim isteğinin tek kullanımlık değeri geçersiz.",
      invalidAudience: "Erişim isteğinin hedefi geçersiz.",
      audienceMismatch: "Erişim isteği bu uygulama için oluşturulmamış.",
      invalidTimestamps: "Erişim isteğinin zaman bilgisi geçersiz.",
      expired: "Erişim isteğinin süresi doldu. Yeniden dene.",
      notYetValid: "Erişim isteği henüz geçerli değil.",
      lifetimeTooLong: "Erişim isteğinin ömrü izin verilenden uzun.",
      invalidSignatureFormat: "İmza geçersiz biçimde.",
    },

    accessSigning: {
      noProvider: "Cüzdan bağlantısı bulunamadı. Cüzdanı yeniden bağla.",
      rejected: "İmza cüzdanda reddedildi. Borcunu görmek için imzalaman gerekir.",
      noAccount: "Cüzdanda açık bir hesap yok.",
      accountChanged:
        "Cüzdandaki aktif hesap değişti. Görmek istediğin borcun cüzdanına geçip tekrar dene.",
      networkChanged:
        "Cüzdan Arc Testnet'te değil. Ağı Arc Testnet'e alıp tekrar dene.",
      invalidChallenge:
        "Erişim isteği kendi doğrulamamızdan geçmedi; cüzdana hiçbir şey gönderilmedi.",
      signatureFormat: "Cüzdan beklenen biçimde bir imza döndürmedi.",
      signerMismatch: "İmzayı atan hesap, isteği yapılan adresle eşleşmiyor.",
      signFailed: "İmzalanamadı. Lütfen tekrar dene.",
    },

    view: {
      malformedResponse: "Sunucudan beklenmeyen bir yanıt geldi. Borç gösterilmiyor.",
      invalidManifest:
        "Paylaşılan hesap doğrulanamadı veya süresi dolmuş. Borç gösterilmiyor.",
      invalidRecipientSignature:
        "Hesabın alıcı imzası doğrulanamadı. Bu bağlantıya güvenme; borç gösterilmiyor.",
      invalidProof:
        "Borcun imzalanan hesaba ait olduğu kanıtlanamadı. Borç gösterilmiyor.",
      walletMismatch: "Bu borç bağlı cüzdana ait değil. Doğru cüzdana geçip tekrar dene.",
      wrongChain: "Cüzdan Arc Testnet'te değil. Borç gösterilmiyor.",
      notOpen: "Bu paylaşılan hesap artık açık değil.",
    },

    offer: {
      malformedResponse:
        "Sunucudan beklenmeyen bir ödeme teklifi geldi. Ödeme açılmadı.",
      walletMismatch: "Teklif bağlı cüzdana ait değil. Doğru cüzdana geçip tekrar dene.",
      recipientMismatch:
        "Teklifin alıcısı, imzalı hesaptaki alıcı değil. Bu teklife güvenme; ödeme açılmadı.",
      amountMismatch:
        "Teklifin TRY tutarı, doğrulanmış borcunla uyuşmuyor. Ödeme açılmadı.",
      inconsistentAmount:
        "Teklifin USDC tutarı, borç ve kurdan yeniden hesaplananla uyuşmuyor. Ödeme açılmadı.",
      wrongChain: "Cüzdan Arc Testnet'te değil. Ödeme açılmadı.",
      expired: "Ödeme teklifinin süresi doldu. Kuru yenile.",
      insufficientTime: "Kur teklifinin bitişine çok az kaldı. Kuru yenileyip tekrar dene.",
    },

    claim: {
      malformedResponse:
        "Sunucudan beklenmeyen bir rezervasyon yanıtı geldi. Gönderim yapılmadı.",
      snapshotRejected:
        "Rezervasyon kendi doğrulamamızdan geçmedi; cüzdana hiçbir şey gönderilmedi.",
      changedFromReview:
        "Rezervasyonun içeriği, incelediğin ödemeyle birebir aynı değil; gönderim YAPILMADI. Baştan başla.",
    },

    billSigning: {
      noProvider: "Cüzdan bağlantısı bulunamadı. Cüzdanı yeniden bağla.",
      rejected: "İmza cüzdanda reddedildi.",
      noAccount: "Cüzdanda açık bir hesap yok.",
      accountChanged:
        "Cüzdandaki aktif hesap, hesabın alıcısı değil. Fişi ödeyen hesaba geçip tekrar dene.",
      networkChanged:
        "Cüzdan Arc Testnet'te değil. Ağı Arc Testnet'e alıp tekrar dene.",
      invalidManifest:
        "Paylaşılan hesap kendi doğrulamamızdan geçmedi; cüzdana hiçbir şey gönderilmedi. Adresleri ve tutarları kontrol edip tekrar dene.",
      invalidRecipient: "Alıcı cüzdan adresi geçersiz.",
      signatureFormat: "Cüzdan beklenen biçimde bir imza döndürmedi.",
      signerMismatch:
        "İmzayı atan hesap hesabın alıcısıyla eşleşmiyor. Paylaşılan hesap oluşturulmadı.",
      signFailed: "Paylaşılan hesap imzalanamadı. Lütfen tekrar dene.",
    },

    draft: {
      noDebts: "Paylasilacak bir borc yok.",
      tooManyDebts: "Bir hesapta en fazla {max} borclu olabilir.",
      invalidRecipient: "Once fisi odeyen cuzdani baglaman gerekiyor.",
      missingAddress: "Her borclu icin bir cuzdan adresi girilmeli.",
      invalidAddress: "Bu cuzdan adresi gecerli degil.",
      duplicateAddress: "Ayni cuzdan adresi birden fazla kisiye verilemez.",
      recipientIsDebtor: "Borclu adresi, fisi odeyenin adresiyle ayni olamaz.",
      invalidAmount: "Borc tutari gecerli degil.",
    },

    quote: {
      notAnObject: "Kur teklifi okunamadı.",
      unexpectedField: "Kur teklifinde beklenmeyen alan var.",
      missingField: "Kur teklifinde eksik alan var.",
      unsupportedQuoteVersion: "Bu kur teklifi sürümü desteklenmiyor.",
      invalidQuoteId: "Kur teklifi kimliği geçersiz.",
      invalidCurrencyPair: "Kur teklifi USDC/TRY çifti için değil.",
      invalidSource: "Kur teklifinin kaynağı beklenen sağlayıcı değil.",
      invalidRate: "Kur teklifindeki kur değeri geçersiz.",
      invalidTimestamps: "Kur teklifinin zaman bilgisi geçersiz.",
      observationTooOld: "Kur verisi güncel değil. Kuru yenileyip tekrar dene.",
      observationInFuture: "Kur teklifinin gözlem zamanı gelecekte görünüyor.",
      lifetimeTooLong: "Kur teklifinin geçerlilik süresi izin verilenden uzun.",
      notYetValid: "Kur teklifi henüz geçerli değil.",
      expired: "Kur teklifinin süresi doldu. Kuru yenileyip tekrar dene.",
      invalidTag: "Kur teklifinin sunucu imzası doğrulanamadı.",
    },

    participantName: {
      empty: "İsim boş olamaz.",
      duplicate: "Bu isim zaten listede var.",
    },

    money: {
      empty: "Bir tutar gir.",
      invalid: "Geçerli bir tutar gir (örn. 320,50).",
      tooManyDecimals: "En fazla iki ondalık basamak girebilirsin (örn. 320,50).",
      negative: "Tutar negatif olamaz.",
    },

    assignments: {
      notEnoughParticipants: "Payları hesaplamak için en az {min} kişi gerekiyor.",
      invalidParticipantName: "Kişi isimleri boş olamaz ve birbirinin aynısı olamaz.",
      unknownPayer: "Fişi ödeyen kişi seçili değil.",
      missingAssignment: "Bazı ürünler hiç kimseye atanmamış.",
      duplicateAssignment: "Bir ürün için birden fazla atama kaydı var.",
      duplicateParticipantInAssignment:
        "Bir üründe aynı kişi birden fazla kez atanmış.",
      unknownParticipant: "Atamalarda artık var olmayan bir kişi bulunuyor.",
      unknownItem: "Atamalarda artık var olmayan bir ürün bulunuyor.",
      unassignedItem: "Bazı ürünler hiç kimseye atanmamış.",
      duplicateParticipantId: "Kişi listesinde aynı kimlik birden fazla kez bulunuyor.",
    },

    receipt: {
      schema: "Fiş verisi geçerli değil. Tutarları kontrol edip düzelt.",
      duplicateItemId:
        "Fişte aynı ürün kimliği birden fazla kez geçiyor. Ürünleri kontrol et.",
    },

    /**
     * SUNUCU HATA KODLARI.
     *
     * Anahtarlar sunucunun `error.code` alanıdır ve MAKİNE OKUNUR sözleşmenin
     * parçasıdır: çevrilmez, değiştirilmez. Burada yalnızca kullanıcıya
     * gösterilecek metin bulunur. Listede olmayan bir kod `errors.generic`e
     * düşer; sunucudan gelen ham metin ASLA gösterilmez.
     *
     * Türkçe ve İngilizce karşılıklar AYNI bilgiyi açıklar: İngilizce sürüm
     * hesabın varlığı, üyeliği veya nedeni hakkında Türkçeden FAZLASINI
     * söylemez.
     */
    api: {
      AUTH_REQUIRED: "Bu işlem için Google ile oturum açmalısın.",
      SERVICE_UNAVAILABLE: "Servis şu anda kullanılamıyor. Lütfen birazdan tekrar dene.",
      SERVICE_NOT_CONFIGURED:
        "Bu özellik sunucuda yapılandırılmamış. Lütfen birazdan tekrar dene.",
      INTERNAL_ERROR: "Beklenmeyen bir hata oluştu. Lütfen tekrar dene.",
      NOT_AVAILABLE:
        "Bu bağlantı için bir borç bulunamadı. Bağlantı geçersiz veya süresi dolmuş olabilir.",
      INVALID_REQUEST: "İstek okunamadı. Lütfen tekrar dene.",
      INVALID_CONTENT_TYPE: "İstek beklenen biçimde gönderilmedi.",
      INVALID_ENCODING: "İstek gövdesi geçerli UTF-8 değil.",
      BODY_TOO_LARGE: "İstek gövdesi çok büyük.",
      BODY_READ_TIMEOUT: "İstek gövdesi zamanında okunamadı.",
      MALFORMED_JSON: "İstek gövdesi okunamadı.",
      INVALID_BODY: "İstek gövdesi beklenen biçimde değil.",
      DUPLICATE_FIELD: "İstek gövdesinde yinelenen alan var.",
      UNEXPECTED_FIELD: "İstek gövdesinde beklenmeyen alan var.",
      MISSING_FIELD: "İstek gövdesinde eksik alan var.",
      INVALID_BILL_ID: "Hesap kimliği geçersiz.",
      INVALID_ADDRESS: "Cüzdan adresi geçersiz.",
      INVALID_SIGNATURE_FORMAT: "İmza geçersiz biçimde.",
      INVALID_SIGNATURE: "İmza doğrulanamadı. Bağlı cüzdanla imzaladığından emin ol.",
      INVALID_CHALLENGE: "Erişim isteği doğrulanamadı.",
      CHALLENGE_ALREADY_USED: "Bu erişim isteği zaten kullanılmış. Yeniden dene.",
      NOT_AUTHENTICATED: "Önce cüzdanınla giriş yap.",
      SESSION_EXPIRED: "Oturumun sona erdi. Cüzdanınla yeniden giriş yap.",
      INVALID_SHARED_BILL:
        "Paylaşılan hesabın imzası doğrulanamadı. Hesap oluşturulmadı.",
      BILL_ID_UNAVAILABLE: "Bu paylaşılan hesap oluşturulamadı. Lütfen yeniden dene.",
      STORAGE_REJECTED: "Paylaşılan hesap kaydedilemedi; borç listesi kabul edilmedi.",
      DEBT_NOT_CLAIMABLE:
        "Bu borç şu anda ödenebilir durumda değil: ödenmiş olabilir, başka bir cihazda ya da sekmede süren bir deneme olabilir veya önceki denemenin sonucu doğrulanamamış olabilir. Tekrar göndermeden önce cüzdanının işlem geçmişini ve ArcScan'i kontrol et.",
      OFFER_UNUSABLE:
        "Ödeme teklifi artık kullanılamıyor (süresi dolmuş ya da zaten kullanılmış). Kuru yenileyip tekrar dene.",
      ATTEMPT_ALREADY_ACTIVE:
        "Bu borç için hâlihazırda süren bir ödeme var (başka bir cihaz veya sekme olabilir). Aynı ödemeyi ikinci kez göndermemek için yeni bir deneme açılmadı.",
      INCONSISTENT_OFFER:
        "Teklifin tutarı, borç ve kurdan yeniden hesaplananla uyuşmuyor; ödeme başlatılmadı. Kuru yenileyip tekrar dene.",
      INSUFFICIENT_TIME:
        "Kur teklifinin ya da bağlantının bitişine çok az kaldı; cüzdan onayı sırasında süresi dolabilirdi. Ödeme başlatılmadı.",
      RATE_UNAVAILABLE:
        "Güncel USDC/TRY kuru alınamadı; ödeme başlatılmadı. Elle girilen bir kura DÜŞÜLMEZ. Lütfen birazdan tekrar dene.",
      AMOUNT_UNAVAILABLE:
        "Ödenecek USDC tutarı güvenle hesaplanamadı; ödeme başlatılmadı.",
      INVALID_OFFER_ID: "Ödeme teklifi kimliği geçersiz.",
      ATTEMPT_NOT_FOUND: "Bu ödeme denemesi bulunamadı.",
      INVALID_ATTEMPT_ID: "Deneme kimliği geçersiz.",
      INVALID_TX_HASH: "İşlem kimliği (hash) geçersiz.",
      TX_HASH_IN_USE:
        "Bu işlem kimliği başka bir ödeme denemesine ait. Aynı işlem iki borcu kapatamaz.",
      INVALID_TRANSITION:
        "Bu ödeme denemesi artık bu adımda değil. Durumu yeniden sorgula.",
      INVALID_OUTCOME: "Bildirilen sonuç tanınmıyor.",
      OUTCOME_HASH_CONFLICT:
        "Yayın öncesi olduğu bildirilen bir sonuç işlem kimliği taşıyamaz.",
      OUTCOME_HASH_REQUIRED:
        "Gönderildiği bildirilen bir sonuç için işlem kimliği gerekir.",
      MISSING_FILE: "Fiş görseli bulunamadı.",
      EMPTY_FILE: "Dosya boş görünüyor. Lütfen başka bir görsel dene.",
      FILE_TOO_LARGE: "Görsel çok büyük. En fazla 10 MB yükleyebilirsin.",
      UNSUPPORTED_FILE_TYPE: "Yalnızca JPG, PNG ve WEBP dosyaları desteklenir.",
      MODEL_REFUSED:
        "Bu görsel analiz edilemedi. Lütfen fişin net ve tam bir fotoğrafını dene.",
      RECEIPT_NOT_READABLE:
        "Fişteki ürünler okunamadı. Daha net, iyi aydınlatılmış ve fişin tamamını gösteren bir fotoğraf dene.",
      INVALID_RECEIPT_DATA: "Fiş verisi beklenen biçimde alınamadı. Lütfen tekrar dene.",
      ANALYSIS_TIMEOUT:
        "Analiz zaman aşımına uğradı. Lütfen tekrar dene; sorun sürerse daha küçük bir görsel deneyebilirsin.",
      ANALYSIS_FAILED: "Analiz servisine şu anda ulaşılamıyor. Lütfen birazdan tekrar dene.",
      INVALID_TAG_FORMAT: "Kur teklifinin sunucu imzası doğrulanamadı.",
    },
  },

  /* --------------------------------------------------------------------- */
  /* Sayıya bağlı metinler                                                   */
  /* --------------------------------------------------------------------- */
  plurals: {
    /** Türkçede sayıdan sonra ad tekil kalır; iki biçim de aynıdır. */
    sharedBetween: {
      one: "{count} kişi arasında eşit bölünecek.",
      other: "{count} kişi arasında eşit bölünecek.",
    },
    itemsUnassigned: {
      one: "{count} ürün henüz kimseye atanmadı. Her ürünü en az bir kişiye ata.",
      other: "{count} ürün henüz kimseye atanmadı. Her ürünü en az bir kişiye ata.",
    },
    needParticipants: {
      one: "Devam etmek için en az {count} kişi gerekiyor.",
      other: "Devam etmek için en az {count} kişi gerekiyor.",
    },
    allAssigned: {
      one: "Her ürün atandı. {count} veya daha fazla kişiyle devam edebilirsin.",
      other: "Her ürün atandı. {count} veya daha fazla kişiyle devam edebilirsin.",
    },
    billDebtorsPaid: {
      one: "{paid}/{count} borçlu ödedi",
      other: "{paid}/{count} borçlu ödedi",
    },
  },
} as const satisfies DictionaryShape;

/**
 * Sözlüğün YAPI kısıtı.
 *
 * Değerler `string` ya da iç içe gruplardır; çoğul girdileri `one`/`other`
 * ikilisidir. `as const satisfies` sayesinde yapı denetlenir ama `Dictionary`
 * tipi yine GENİŞLETİLMİŞ (`string`) alanlarla üretilir — böylece `en.ts`
 * aynı metinleri değil, aynı ANAHTARLARI sağlamak zorundadır.
 */
type DictionaryShape = {
  readonly [key: string]: string | DictionaryShape;
};

/** İki dilin de sağlamak zorunda olduğu anahtar kümesi. */
export type Dictionary = {
  readonly [K in keyof typeof tr]: Widen<(typeof tr)[K]>;
};

type Widen<T> = T extends string
  ? string
  : { readonly [K in keyof T]: Widen<T[K]> };
