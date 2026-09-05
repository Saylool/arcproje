import { SHARED_BILL_ACCESS_MAX_LIFETIME_MS } from "@/lib/arc/shared-bill-access";
import { SHARED_BILL_MAX_LIFETIME_MS } from "@/lib/arc/shared-bill";
import { ACTIVE_NETWORK_PROFILE } from "@/lib/arc/profile";
import { LOCALE_COOKIE_MAX_AGE_SECONDS, type Locale } from "@/lib/i18n/locale";
import {
  BILL_RETENTION_AFTER_EXPIRY_MS,
  QUOTA_RETENTION_DAYS,
  BILL_RETENTION_DAYS,
} from "@/lib/db/retention";
import { QUOTE_LIFETIME_MS } from "@/lib/rates/quote";

import type { PrivacyPolicy } from "./privacy-types";

/**
 * GİZLİLİK POLİTİKASI — iki dilde, tek belge.
 *
 * Metin KODUN DENETİMİNDEN çıkarılmıştır, tahminden değil. Süreler koddaki
 * sabitlerden okunur; bir sabit değişirse metin de değişir ve testler
 * sabitlerle metnin ayrışmasını yakalar.
 *
 * İKİ ŞEY BİLEREK YUMUŞATILMAMIŞTIR:
 *  - Süresi dolan ortak hesap kayıtları SİLİNMEZ, yalnızca erişilemez olur.
 *    Kodda `shared_bills` için hiçbir silme yolu yoktur; "otomatik silinir"
 *    demek yanlış beyan olurdu.
 *  - Blok zincirine yazılan hiçbir şey geri alınamaz. Silme hakkı oraya
 *    ulaşmaz ve bu açıkça söylenir.
 */

export const PRIVACY_CONTACT_EMAIL = "sametgoc81tr@gmail.com";

/*
 * Hesap silme sayfası. Google Play, hesap açtıran uygulamalardan uygulama
 * içi bir silme yolu VE herkesin açabileceği bir web adresi ister; bu tek
 * sayfa ikisini de karşılar ve politikada adıyla geçer.
 */
export const ACCOUNT_PAGE_PATH = "/account";
const ACCOUNT_DELETE_LABEL = "Hesabımı sil";
const ACCOUNT_DELETE_LABEL_EN = "Delete my account";
export const PRIVACY_EFFECTIVE_DATE = "2026-09-01";

/** Borçlu oturumunun ömrü; `SHARED_BILL_SESSION_LIFETIME_MS` ile eşliği test edilir. */
export const SESSION_MINUTES = 15;

/**
 * Metinde geçen süreler. Hepsi koddaki sabitlerden TÜRETİLİR ve dışarı
 * verilir ki test onları sabitlerle karşılaştırabilsin: yalnızca sabiti içe
 * aktarmış olmak, metnin gerçekten ondan beslendiğini kanıtlamaz.
 */
export const POLICY_DURATIONS = {
  billDays: SHARED_BILL_MAX_LIFETIME_MS / (24 * 60 * 60 * 1000),
  accessMinutes: SHARED_BILL_ACCESS_MAX_LIFETIME_MS / (60 * 1000),
  quoteMinutes: QUOTE_LIFETIME_MS / (60 * 1000),
  cookieDays: LOCALE_COOKIE_MAX_AGE_SECONDS / (24 * 60 * 60),
} as const;

const BILL_DAYS = POLICY_DURATIONS.billDays;
/** Kota sayaçlarının saklama süresi; tek kaynak . */
const QUOTA_DAYS = QUOTA_RETENTION_DAYS;

/*
 * Saklama süreleri KODDAN türer, elle yazılmaz. Temizlik görevi bu sayıları
 * kullanır; politika ile davranışın ayrışması böylece imkânsızlaşır.
 */
const BILL_RETENTION_AFTER_EXPIRY_DAYS =
  BILL_RETENTION_AFTER_EXPIRY_MS / (24 * 60 * 60 * 1000);
const BILL_TOTAL_RETENTION_DAYS = BILL_RETENTION_DAYS;
const ACCESS_MINUTES = POLICY_DURATIONS.accessMinutes;
const QUOTE_MINUTES = POLICY_DURATIONS.quoteMinutes;
const COOKIE_DAYS = POLICY_DURATIONS.cookieDays;
const NETWORK = ACTIVE_NETWORK_PROFILE.displayName;

/**
 * Verinin ulaştığı ÜÇÜNCÜ TARAFLARIN alan adları.
 *
 * Kaynak kodda geçen her dış alan adının burada bulunması testle zorunlu
 * kılınır: yeni bir servise bağlanan kod, politikayı güncellemeden geçemez.
 */
export const DISCLOSED_HOSTS: readonly string[] = [
  "api.coingecko.com",
  "www.coingecko.com",
  "docs.arc.io",
  "faucet.circle.com",
  "rpc.testnet.arc.io",
  /*
   * İKİNCİ bir Arc RPC sunucusu. Bizim kodumuz `rpc.testnet.arc.io`
   * kullanır; Circle App Kit ise viem'in gömülü `arcTestnet` tanımını
   * kullandığı için tarayıcı ödeme sırasında BURAYA da bağlanır.
   *
   * Kaynak taramasıyla bulunamazdı: adres bizim kodumuzda değil, bağımlılığın
   * içinde. Yalnızca CSP'nin rapor kipi ortaya çıkardı.
   */
  "rpc.testnet.arc.network",
  "testnet.arcscan.app",
  "arcscan.app",
  "api.openai.com",
  "accounts.google.com",
  "relay.walletconnect.org",
  "rpc.walletconnect.org",
  "neon.tech",
  "vercel.com",
];

const tr: PrivacyPolicy = {
  title: "Gizlilik Politikası",
  effectiveDate: PRIVACY_EFFECTIVE_DATE,
  intro:
    "Bu sayfa Hesabı Böl'ün hangi verileri işlediğini, bunların nereye gittiğini ve ne kadar süreyle durduğunu anlatır. Metin uygulamanın kaynak kodu okunarak yazılmıştır; iddia edilen her süre koddaki sabitten gelir.",
  sections: [
    {
      id: "sorumlu",
      heading: "Veri sorumlusu ve iletişim",
      blocks: [
        {
          kind: "paragraph",
          text: "Hesabı Böl kişisel bir projedir; bir şirket tarafından işletilmez. Veri sorumlusu projeyi yürüten gerçek kişidir.",
        },
        {
          kind: "paragraph",
          text: `Gizlilikle ilgili her talep ve soru için: ${PRIVACY_CONTACT_EMAIL}`,
        },
      ],
    },
    {
      id: "ozet",
      heading: "Kısaca",
      blocks: [
        {
          kind: "list",
          items: [
            "Reklam yoktur, izleme (analytics) yoktur, profilleme yoktur.",
            "Hiçbir veri satılmaz ve pazarlama amacıyla paylaşılmaz.",
            "Fiş görseli sunucuda saklanmaz.",
            "Cüzdanının gizli anahtarı ya da kurtarma ifadesi hiçbir zaman istenmez ve görülmez.",
            `Kullanılan ağ ${NETWORK}'tir ve üzerindeki test USDC'sinin parasal değeri yoktur.`,
          ],
        },
      ],
    },
    {
      id: "veriler",
      heading: "İşlenen veriler",
      blocks: [
        {
          kind: "table",
          head: ["Veri", "Neden", "Hukuki dayanak", "Ne kadar durur"],
          rows: [
            [
              "Google hesabından: hesap kimliği, doğrulanmış e-posta adresi, görünen ad, profil fotoğrafı adresi",
              "Girişi yapmak ve oluşturduğun hesapları sana bağlamak",
              "Sözleşmenin ifası — KVKK m. 5/2-c, GDPR m. 6/1-b",
              "Silme talebine kadar",
            ],
            [
              "Fiş görseli ve içinden çıkarılan ürün adları ve tutarlar",
              "Fişi okuyup ürünleri listelemek",
              "Sözleşmenin ifası — KVKK m. 5/2-c, GDPR m. 6/1-b",
              "Görsel saklanmaz; çıkarılan liste yalnızca tarayıcında durur",
            ],
            [
              "Ortak hesap: alıcı ve borçlu cüzdan adresleri, verdiğin etiketler, TL tutarlar, imzalar, ödeme işlemi hash'leri",
              "Bağlantıyı açan kişiye yalnızca kendi borcunu gösterebilmek",
              "Sözleşmenin ifası — KVKK m. 5/2-c, GDPR m. 6/1-b",
              `${BILL_DAYS} gün sonra erişilemez olur; toplam ${BILL_TOTAL_RETENTION_DAYS} gün sonra silinir`,
            ],
            [
              "Kayıtlı kişiler: verdiğin ad ve cüzdan adresi",
              "Aynı kişiyi tekrar yazmak zorunda kalmaman",
              "Sözleşmenin ifası — KVKK m. 5/2-c, GDPR m. 6/1-b",
              "Sen silene kadar; uygulamadan tek tek silinebilir",
            ],
            [
              "Kimlik doğrulama tek kullanımlık kodları ve borçlu oturumu",
              "Bağlantıyı açan kişinin adresin sahibi olduğunu kanıtlaması",
              "Meşru menfaat (kötüye kullanımın önlenmesi) — KVKK m. 5/2-f, GDPR m. 6/1-f",
              `Kod ${ACCESS_MINUTES} dakika, oturum ${SESSION_MINUTES} dakika sonra GEÇERSİZ olur; satır sonraki temizlikte silinir`,
            ],
            [
              "Kur teklifi ve ödeme teklifi kayıtları",
              "Tutarın piyasa kurundan türetildiğini kanıtlamak",
              "Meşru menfaat (bütünlük) — KVKK m. 5/2-f, GDPR m. 6/1-f",
              `Teklif ${QUOTE_MINUTES} dakika geçerlidir. KULLANILMAYAN teklif sonraki temizlikte silinir; KULLANILAN teklif ödeme kanıtı olarak hesabın saklama süresi boyunca durur`,
            ],
            [
              "Günlük analiz sayacı: hesap kimliğin, gün ve o gün yaptığın analiz adedi",
              "Günlük analiz sınırını uygulamak; bir kişinin diğerlerinin hakkını tüketmesini engellemek",
              "Meşru menfaat (kötüye kullanımın önlenmesi ve maliyet sınırı) — KVKK m. 5/2-f, GDPR m. 6/1-f",
              `${QUOTA_DAYS} gün sonra silinmeye uygun olur ve günlük temizlikte gider; hesabını silersen bu satırlar hemen SİLİNİR`,
            ],
          ],
        },
        {
          kind: "warning",
          text: `Süresi dolan ortak hesap kayıtları otomatik olarak silinir. Ama burada ÜÇ AYRI AN vardır ve karıştırılmamalıdır: kaydın artık İŞE YARAMADIĞI an, SİLİNMEYE UYGUN hâle geldiği an ve temizliğin onu GERÇEKTEN kaldırdığı an. Ortak hesap ${BILL_DAYS} gün sonra açılamaz ve ödenemez; kayıt bundan ${BILL_RETENTION_AFTER_EXPIRY_DAYS} gün daha durur, sonra günlük çalışan bir temizlikle borç satırlarıyla birlikte veritabanından kaldırılır. Analiz sayaçları ${QUOTA_DAYS} gün sonra silinmeye uygun olur ve aynı temizlikte gider. Giriş kodları, borçlu oturumları ve kullanılmamış ödeme teklifleri süreleri dolar dolmaz GEÇERSİZ olur; o andan sonra hiçbir işe yaramazlar. Satırların kendisi sonraki bir kullanım sırasında, her seferinde sınırlı sayıda temizlenir — yani "süresi doldu" ile "silindi" aynı an değildir. Kullanılmış bir ödeme teklifi ise ödeme kanıtı olduğu için hesabın saklama süresi boyunca durur. Daha erken silinmesini istiyorsan yukarıdaki adrese yazabilirsin.`,
        },
      ],
    },
    {
      id: "ucuncu-taraflar",
      heading: "Verinin ulaştığı taraflar",
      blocks: [
        {
          kind: "paragraph",
          text: "Aşağıdakiler dışında hiçbir tarafa veri aktarılmaz. Listeye yeni bir taraf eklenmeden uygulamaya yeni bir dış bağlantı eklenemez; bu bir testle zorunlu kılınmıştır.",
        },
        {
          kind: "table",
          head: ["Taraf", "Ne gider", "Neden"],
          rows: [
            ["Google", "Giriş bilgileri; karşılığında e-posta, ad ve profil fotoğrafı adresi döner", "Google ile giriş"],
            [
              "OpenAI",
              "Fişin görselinin kendisi",
              "Fişi okumak. İstek, OpenAI'den saklamaması istenerek gönderilir (store: false)",
            ],
            ["CoinGecko", "Kullanıcıya ait hiçbir şey; yalnızca kur sorgusu", "USDC/TL kurunu almak"],
            [
              "WalletConnect rölesi",
              "Mobil cüzdanla eşleşme trafiği",
              "Telefondaki cüzdanı bağlamak. Yalnızca bu yolu kullanırsan devreye girer",
            ],
            [
              `${NETWORK} ağı ve RPC sunucuları`,
              "Cüzdan adresleri ve gönderdiğin işlemler",
              "Transferin gerçekleşmesi. Bu veri HERKESE AÇIKTIR. Tarayıcın BİRDEN FAZLA RPC sunucusuna bağlanır: uygulamanın kendi seçtiği sunucu ve cüzdan kitinin kullandığı sunucu",
            ],
            ["Neon (veritabanı) ve Vercel (barındırma)", "Yukarıda sayılan kayıtlar", "Uygulamanın çalışması"],
          ],
        },
      ],
    },
    {
      id: "zincir",
      heading: "Blok zinciri: kalıcı ve herkese açık",
      blocks: [
        {
          kind: "warning",
          text: `Cüzdan adresin ve yaptığın transferler ${NETWORK} üzerinde herkesin görebileceği biçimde ve KALICI olarak durur. Bu kayıtları ne biz ne de başka biri silebilir; silme hakkın oraya ulaşmaz. Bir adresi bir kişiyle ilişkilendiren her şey — verdiğin etiketler dâhil — bizim veritabanımızdadır ve silinebilir, ama zincirin kendisi silinemez.`,
        },
      ],
    },
    {
      id: "test-agi",
      heading: "Test ağı uyarısı",
      blocks: [
        {
          kind: "warning",
          text: `Uygulama yalnızca ${NETWORK} üzerinde çalışır. Buradaki USDC bir TEST jetonudur ve parasal değeri yoktur. Uygulama gerçek para taşımaz.`,
        },
      ],
    },
    {
      id: "cihaz",
      heading: "Cihazında saklananlar",
      blocks: [
        {
          kind: "table",
          head: ["Ne", "Neden", "Süre"],
          rows: [
            ["Dil tercihi çerezi", "Sayfayı seçtiğin dilde açmak", `${COOKIE_DAYS} gün`],
            ["Oturum çerezleri", "Girişini ve borçlu doğrulamanı sürdürmek", "Oturum boyunca"],
            ["Tema tercihi", "Aydınlık/karanlık seçimini hatırlamak", "Sen silene kadar"],
            [
              "Gönderim kaydı",
              "Aynı tarayıcıda kazara ikinci kez göndermeni engellemek",
              "Sen silene kadar",
            ],
          ],
        },
        {
          kind: "paragraph",
          text: "Gönderim kaydında yalnızca zincir kimliği, talep kimliği, sonucun türü ve varsa işlem hash'i tutulur. Adres, tutar, etiket ve imza SAKLANMAZ.",
        },
        {
          kind: "paragraph",
          text: "Bunların hiçbiri reklam ya da izleme çerezi değildir; üçüncü taraf çerezi kullanılmaz.",
        },
      ],
    },
    {
      id: "yapmadiklarimiz",
      heading: "Yapmadıklarımız",
      blocks: [
        {
          kind: "list",
          items: [
            "Gizli anahtarını, kurtarma ifadeni ya da cüzdan parolanı istemeyiz; bunları göremeyiz.",
            "Senin adına hiçbir işlem göndermeyiz; her transferi kendi cüzdanında sen imzalarsın.",
            "Reklam ağı, izleme betiği ya da üçüncü taraf çerezi kullanmayız.",
            "Veriyi satmayız, kiralamayız, pazarlama amacıyla paylaşmayız.",
            "Otomatik karar verme ya da profilleme yapmayız.",
          ],
        },
      ],
    },
    {
      id: "haklar",
      heading: "Haklarınız",
      blocks: [
        {
          kind: "paragraph",
          text: "KVKK m. 11 ve GDPR m. 15–22 kapsamında şu haklara sahipsin:",
        },
        {
          kind: "list",
          items: [
            "Verinin işlenip işlenmediğini öğrenme ve bir kopyasını isteme",
            "Eksik ya da yanlış işlenmişse düzeltilmesini isteme",
            "Silinmesini ya da yok edilmesini isteme",
            "İşlemenin sınırlandırılmasını isteme ve işlemeye itiraz etme",
            "Verinin taşınabilir bir biçimde sana verilmesini isteme",
            "Zarara uğraman hâlinde zararın giderilmesini talep etme",
          ],
        },
        {
          kind: "paragraph",
          text: `Google hesabınla girdiysen hesabını UYGULAMA İÇİNDEN kendin silebilirsin: ${ACCOUNT_PAGE_PATH} sayfasındaki "${ACCOUNT_DELETE_LABEL}" bölümü kaydını ve kayıtlı kişilerini kaldırır. Aynı adres tarayıcıdan da açılır. Diğer talepler ve uygulamaya erişemediğin durumlar için ${PRIVACY_CONTACT_EMAIL} adresine yazman yeterlidir.`,
        },
        {
          kind: "paragraph",
          text: "Şikâyet hakkın saklıdır: Türkiye'de Kişisel Verileri Koruma Kurumu'na, Avrupa Birliği'nde ise bulunduğun ülkenin veri koruma otoritesine başvurabilirsin.",
        },
      ],
    },
    {
      id: "aktarim",
      heading: "Yurt dışına aktarım",
      blocks: [
        {
          kind: "paragraph",
          text: "Yukarıda sayılan sağlayıcıların bir kısmı (OpenAI, Google, Neon, Vercel, CoinGecko, WalletConnect) Türkiye dışında, çoğunlukla Amerika Birleşik Devletleri'nde bulunan sunucular kullanır. Uygulamayı kullandığında bu verinin yurt dışındaki sunuculara aktarılması söz konusudur. Aktarım, hizmetin verilebilmesi için gereklidir ve yalnızca yukarıdaki tabloda yazan kapsamla sınırlıdır.",
        },
      ],
    },
    {
      id: "guvenlik",
      heading: "Güvenlik",
      blocks: [
        {
          kind: "list",
          items: [
            "Tüm bağlantılar şifrelidir (HTTPS/TLS).",
            "Sunucu anahtarları yalnızca sunucuda okunur ve tarayıcıya gönderilen pakete girmez.",
            "Borçlu erişimi cüzdan imzasıyla doğrulanır; imza olmadan hiçbir borç gösterilmez.",
            "Bir ödeme talebindeki tutar, borç ve kurdan yeniden hesaplanarak doğrulanır.",
          ],
        },
        {
          kind: "paragraph",
          text: "Buna karşın hiçbir sistem kusursuz değildir. Bu kişisel bir projedir ve kurumsal bir güvenlik denetiminden geçmemiştir.",
        },
      ],
    },
    {
      id: "cocuklar",
      heading: "Çocuklar",
      blocks: [
        {
          kind: "paragraph",
          text: "Uygulama çocuklara yönelik değildir ve bilerek çocuklardan veri toplamaz.",
        },
      ],
    },
    {
      id: "degisiklikler",
      heading: "Değişiklikler",
      blocks: [
        {
          kind: "paragraph",
          text: "Bu metin değişirse yukarıdaki yürürlük tarihi güncellenir. Uygulamanın işlediği veriler değiştiğinde metin de değişmek zorundadır; buna kaynak kodda testlerle zorlanır.",
        },
      ],
    },
  ],
};

const en: PrivacyPolicy = {
  title: "Privacy Policy",
  effectiveDate: PRIVACY_EFFECTIVE_DATE,
  intro:
    "This page explains which data Split the Bill processes, where it goes and how long it is kept. It was written by reading the application's source code; every duration claimed here comes from a constant in that code.",
  sections: [
    {
      id: "sorumlu",
      heading: "Controller and contact",
      blocks: [
        {
          kind: "paragraph",
          text: "Split the Bill is a personal project and is not operated by a company. The controller is the individual who runs it.",
        },
        {
          kind: "paragraph",
          text: `For any privacy request or question: ${PRIVACY_CONTACT_EMAIL}`,
        },
      ],
    },
    {
      id: "ozet",
      heading: "In short",
      blocks: [
        {
          kind: "list",
          items: [
            "No advertising, no analytics, no profiling.",
            "No data is ever sold or shared for marketing.",
            "Receipt images are not stored on the server.",
            "Your wallet's private key or recovery phrase is never requested and never seen.",
            `The network is ${NETWORK}, and the test USDC on it has no monetary value.`,
          ],
        },
      ],
    },
    {
      id: "veriler",
      heading: "Data processed",
      blocks: [
        {
          kind: "table",
          head: ["Data", "Why", "Legal basis", "How long"],
          rows: [
            [
              "From your Google account: account id, verified email address, display name, profile picture URL",
              "Signing you in and linking the bills you create to you",
              "Performance of a contract — KVKK art. 5/2-c, GDPR art. 6(1)(b)",
              "Until you ask for deletion",
            ],
            [
              "The receipt image, and the item names and amounts read from it",
              "Reading the receipt and listing its items",
              "Performance of a contract — KVKK art. 5/2-c, GDPR art. 6(1)(b)",
              "The image is not stored; the extracted list stays in your browser only",
            ],
            [
              "Shared bill: recipient and debtor wallet addresses, the labels you type, TRY amounts, signatures, payment transaction hashes",
              "Showing each person who opens the link only their own share",
              "Performance of a contract — KVKK art. 5/2-c, GDPR art. 6(1)(b)",
              `Becomes unreachable after ${BILL_DAYS} days; deleted after ${BILL_TOTAL_RETENTION_DAYS} days in total`,
            ],
            [
              "Saved people: the name you give and the wallet address",
              "So you do not have to type the same person again",
              "Performance of a contract — KVKK art. 5/2-c, GDPR art. 6(1)(b)",
              "Until you delete them; each can be deleted from within the app",
            ],
            [
              "One-time authentication codes and the debtor session",
              "Proving that whoever opened the link controls the address",
              "Legitimate interest (preventing misuse) — KVKK art. 5/2-f, GDPR art. 6(1)(f)",
              `The code STOPS WORKING after ${ACCESS_MINUTES} minutes and the session after ${SESSION_MINUTES}; the row itself is removed by a later cleanup`,
            ],
            [
              "Rate quotes and payment offers",
              "Proving the amount was derived from a market rate",
              "Legitimate interest (integrity) — KVKK art. 5/2-f, GDPR art. 6(1)(f)",
              `A quote is valid for ${QUOTE_MINUTES} minutes. An UNUSED quote is removed by a later cleanup; a USED one is kept as proof of payment for as long as the bill is kept`,
            ],
            [
              "Daily analysis counter: your account id, the day, and how many analyses you ran that day",
              "Enforcing the daily analysis limit, so one person cannot use up everyone else's allowance",
              "Legitimate interest (abuse prevention and cost control) — KVKK art. 5/2-f, GDPR art. 6(1)(f)",
              `Becomes eligible for deletion after ${QUOTA_DAYS} days and goes in the daily cleanup; these rows are DELETED immediately when you delete your account`,
            ],
          ],
        },
        {
          kind: "warning",
          text: `Expired shared bills are deleted automatically. But there are THREE DISTINCT MOMENTS here and they should not be confused: when a record STOPS WORKING, when it becomes ELIGIBLE FOR DELETION, and when a cleanup ACTUALLY REMOVES it. After ${BILL_DAYS} days a shared bill can no longer be opened or paid; the record is kept for a further ${BILL_RETENTION_AFTER_EXPIRY_DAYS} days and is then removed from the database, together with its debt rows, by a daily cleanup. Analysis counters become eligible for deletion after ${QUOTA_DAYS} days and go in the same cleanup. Access codes, debtor sessions and unused payment quotes STOP WORKING the moment they expire; from then on they are good for nothing. The rows themselves are cleared during a later request, a limited number at a time — so "expired" and "deleted" are not the same moment. A used payment quote is kept as proof of payment for as long as the bill is kept. If you want something gone sooner, you can write to the address above.`,
        },
      ],
    },
    {
      id: "ucuncu-taraflar",
      heading: "Who receives data",
      blocks: [
        {
          kind: "paragraph",
          text: "No data goes anywhere other than the parties below. A new outbound connection cannot be added to the application without adding the party to this list; a test enforces that.",
        },
        {
          kind: "table",
          head: ["Party", "What goes there", "Why"],
          rows: [
            ["Google", "Sign-in; email, name and profile picture URL come back", "Sign in with Google"],
            [
              "OpenAI",
              "The receipt image itself",
              "Reading the receipt. The request asks OpenAI not to retain it (store: false)",
            ],
            ["CoinGecko", "Nothing about you; only a rate query", "Fetching the USDC/TRY rate"],
            [
              "The WalletConnect relay",
              "Pairing traffic with a mobile wallet",
              "Connecting the wallet on your phone. Only used if you take that route",
            ],
            [
              `The ${NETWORK} network and its RPC servers`,
              "Wallet addresses and the transactions you send",
              "Making the transfer happen. This data is PUBLIC. Your browser reaches MORE THAN ONE RPC server: the one the app picks and the one the wallet kit uses",
            ],
            ["Neon (database) and Vercel (hosting)", "The records listed above", "Running the application"],
          ],
        },
      ],
    },
    {
      id: "zincir",
      heading: "The blockchain is public and permanent",
      blocks: [
        {
          kind: "warning",
          text: `Your wallet address and the transfers you make sit on ${NETWORK} in public view, permanently. Neither we nor anyone else can delete them; a deletion right does not reach them. Everything that links an address to a person — including the labels you type — lives in our database and can be deleted, but the chain itself cannot.`,
        },
      ],
    },
    {
      id: "test-agi",
      heading: "Test network",
      blocks: [
        {
          kind: "warning",
          text: `The application runs only on ${NETWORK}. The USDC there is a TEST token with no monetary value. The application does not move real money.`,
        },
      ],
    },
    {
      id: "cihaz",
      heading: "Stored on your device",
      blocks: [
        {
          kind: "table",
          head: ["What", "Why", "How long"],
          rows: [
            ["Language cookie", "Opening the page in the language you chose", `${COOKIE_DAYS} days`],
            ["Session cookies", "Keeping you signed in and your debtor check alive", "For the session"],
            ["Theme preference", "Remembering light or dark", "Until you clear it"],
            [
              "Submission record",
              "Stopping you from sending the same payment twice in the same browser",
              "Until you clear it",
            ],
          ],
        },
        {
          kind: "paragraph",
          text: "The submission record holds only the chain id, the request id, the kind of outcome and, if there is one, the transaction hash. Addresses, amounts, labels and signatures are NOT stored.",
        },
        {
          kind: "paragraph",
          text: "None of these are advertising or tracking cookies, and no third-party cookies are used.",
        },
      ],
    },
    {
      id: "yapmadiklarimiz",
      heading: "What we do not do",
      blocks: [
        {
          kind: "list",
          items: [
            "We never ask for your private key, recovery phrase or wallet password, and we cannot see them.",
            "We never send a transaction for you; you sign every transfer in your own wallet.",
            "We use no advertising network, tracking script or third-party cookie.",
            "We do not sell, rent or share data for marketing.",
            "We do not carry out automated decision-making or profiling.",
          ],
        },
      ],
    },
    {
      id: "haklar",
      heading: "Your rights",
      blocks: [
        {
          kind: "paragraph",
          text: "Under KVKK art. 11 and GDPR arts. 15–22 you have the right to:",
        },
        {
          kind: "list",
          items: [
            "Learn whether your data is processed and request a copy of it",
            "Have it corrected if it is incomplete or wrong",
            "Have it erased",
            "Restrict processing and object to it",
            "Receive your data in a portable form",
            "Claim compensation if you suffer damage",
          ],
        },
        {
          kind: "paragraph",
          text: `If you signed in with Google you can delete your account FROM INSIDE THE APP: the "${ACCOUNT_DELETE_LABEL_EN}" section on ${ACCOUNT_PAGE_PATH} removes your record and your saved people. The same address opens in a browser too. For anything else, or if you cannot reach the app, writing to ${PRIVACY_CONTACT_EMAIL} is enough.`,
        },
        {
          kind: "paragraph",
          text: "You may also complain to a supervisory authority: in Türkiye the Personal Data Protection Authority, and in the European Union the authority in your country.",
        },
      ],
    },
    {
      id: "aktarim",
      heading: "Transfers abroad",
      blocks: [
        {
          kind: "paragraph",
          text: "Some of the providers listed above (OpenAI, Google, Neon, Vercel, CoinGecko, WalletConnect) run on servers outside Türkiye, mostly in the United States. Using the application therefore involves transferring that data to servers abroad. The transfer is necessary to provide the service and is limited to what the table above describes.",
        },
      ],
    },
    {
      id: "guvenlik",
      heading: "Security",
      blocks: [
        {
          kind: "list",
          items: [
            "All connections are encrypted (HTTPS/TLS).",
            "Server secrets are read only on the server and never enter the browser bundle.",
            "Debtor access is verified by a wallet signature; no debt is shown without one.",
            "The amount in a payment request is re-derived from the debt and the rate before it is accepted.",
          ],
        },
        {
          kind: "paragraph",
          text: "Even so, no system is perfect. This is a personal project and has not been through a formal security audit.",
        },
      ],
    },
    {
      id: "cocuklar",
      heading: "Children",
      blocks: [
        {
          kind: "paragraph",
          text: "The application is not aimed at children and does not knowingly collect data from them.",
        },
      ],
    },
    {
      id: "degisiklikler",
      heading: "Changes",
      blocks: [
        {
          kind: "paragraph",
          text: "If this text changes, the effective date above is updated. When the data the application processes changes, this text has to change too; tests in the source code enforce that.",
        },
      ],
    },
  ],
};

export const PRIVACY_POLICY: Readonly<Record<Locale, PrivacyPolicy>> = { tr, en };
