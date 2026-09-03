# Hesabı Böl

Ortak hesabı adil biçimde bölmek için küçük bir hackathon MVP'si. Hedeflenen akış:
fişin fotoğrafını yükle → fişteki ürünleri kişilere dağıt → herkesin borcunu hesapla →
Arc Testnet üzerinden USDC ile öde.

> Bu depo fiş analizi, paylaşım/borç hesabı, Arc Testnet ödeme akışı ve creator
> işlemleri için Google oturum temelini içerir. Kota uygulaması bu değişikliğin
> parçası değildir.

## Kurulum ve çalıştırma

Node.js 22 veya üzeri gerekir (Arc App Kit ileride bunu şart koşacak).

```bash
npm install
```

Ortam değişkenlerini hazırla:

```bash
cp .env.example .env.local
```

`.env.local` içine kendi OpenAI API anahtarını yaz:

| Değişken | Zorunlu | Açıklama |
| --- | --- | --- |
| `OPENAI_API_KEY` | evet | Fiş analizi için OpenAI anahtarı. **Yalnızca sunucuda okunur.** |
| `OPENAI_RECEIPT_MODEL` | hayır | Kullanılacak model. Varsayılan: `gpt-5.6-luna` |
| `COINGECKO_DEMO_API_KEY` | evet | USDC/TRY kuru için CoinGecko Demo anahtarı. **Yalnızca sunucuda okunur.** |
| `RATE_QUOTE_SECRET` | evet | Kur teklifini imzalayan HMAC sırrı. **Yalnızca sunucuda okunur.** |
| `DATABASE_URL` | hayır (Part 1) | Neon Postgres bağlantısı; paylaşılan ortak hesap deposu. **Yalnızca sunucuda okunur.** |
| `SHARED_BILL_AUTH_SECRET` | evet (borçlu bağlantısı) | Cüzdan challenge zarfının HMAC sırrı. **Yalnızca sunucuda okunur.** |
| `APP_ORIGIN` | üretimde evet | Güvenilen açık uygulama origin'i; OAuth ve cüzdan challenge hedefi istemci Host başlıklarından türetilmez. |
| `AUTH_SECRET` | Google girişinde evet | Auth.js JWT/cookie şifreleme sırrı: tam 32 rastgele baytı temsil eden **tam 64 küçük hexadecimal karakter** (`^[0-9a-f]{64}$`). **Yalnızca sunucuda okunur.** |
| `AUTH_GOOGLE_ID` | Google girişinde evet | Google OAuth Web client ID. **Yalnızca sunucuda okunur.** |
| `AUTH_GOOGLE_SECRET` | Google girişinde evet | Google OAuth Web client secret. **Yalnızca sunucuda okunur.** |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | hayır | WalletConnect Cloud proje kimliği. Tanımlı değilse mobil cüzdan seçeneği hiç gösterilmez; masaüstündeki EIP-6963 akışı etkilenmez. **Sır değildir**, aşağıya bakın. |
| `ANDROID_PACKAGE_NAME` | hayır | TWA paketinin adı (ters DNS). Tanımlı değilse `/.well-known/assetlinks.json` 404 döner. **Yalnızca sunucuda okunur.** |
| `ANDROID_APP_FINGERPRINTS` | hayır | Virgülle ayrılmış SHA-256 sertifika parmak izleri. **İKİSİ de gerekir**: yükleme anahtarın ve Google'ın uygulama imzalama anahtarı. **Yalnızca sunucuda okunur.** |

Yukarıdaki **sunucu** değişkenlerinin hiçbiri `NEXT_PUBLIC_` önekiyle
tanımlanmaz ve hiçbiri istemci paketine girmez.

Tek istisna `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`'dir ve istisna olması
kasıtlıdır: WalletConnect projectId'si tanımı gereği tarayıcı paketinde
bulunur, çünkü eşleşme isteğini röleye gönderen taraf istemcidir. Bir sır
değildir, tek başına hiçbir şeye yetki vermez ve hiçbir sunucu sırrının yerine
geçmez. Sunucu sırlarının `NEXT_PUBLIC_` ile tanımlanmaması kuralı
değişmemiştir.

`AUTH_SECRET` kriptografik rastgelelikle üretilmelidir. macOS'ta değeri terminal
çıktısına yazmadan doğrudan panoya almak için:

```bash
openssl rand -hex 32 | tr -d '\n' | pbcopy
```

Üretilen değer değiştirilmeden kullanılmalı; başında/sonunda boşluk, büyük hex
harfi veya başka karakter bulunmamalıdır. `AUTH_SECRET`, `RATE_QUOTE_SECRET` ve
`SHARED_BILL_AUTH_SECRET` üç ayrı sunucu sırrıdır; aynı değer paylaşılmaz.
Hiçbiri `NEXT_PUBLIC_` adıyla tanımlanmaz veya istemciye gönderilmez.

`APP_ORIGIN`, `AUTH_SECRET`, `AUTH_GOOGLE_ID` ya da `AUTH_GOOGLE_SECRET` eksik
veya geçersizse Auth.js başlatılmaz. OAuth uç noktaları ile Google korumalı
creator API'leri ayrıntı sızdırmayan, `Cache-Control: no-store` taşıyan
`503 SERVICE_NOT_CONFIGURED` döndürür. Geçerli yapılandırmada yalnızca oturum
yoksa creator API'leri `401 AUTH_REQUIRED` döndürür. Borçlu cüzdan ve kur
rotaları bu Google yapılandırmasından bağımsız kalır.

`DATABASE_URL` tanımlı olmasa bile uygulama ve testler derlenir; yalnızca
`POST /api/shared-bills` kontrollü bir 503 döner. Şema ve geçiş için
"Tek bağlantılı ortak hesap" bölümüne bak.

Anahtar tanımlı olmasa bile uygulama açılır ve fiş yükleme ekranı çalışır; yalnızca
analiz isteği kontrollü bir "servis yapılandırılmamış" hatası döner.

```bash
npm run dev
```

Uygulama `http://localhost:3000` adresinde açılır.

## Uygulama kabuğu (PWA)

Uygulama `/manifest.webmanifest` yayınlar ve ana ekrana kurulabilir. Kurulan
uygulamanın adı **Hesabı Böl**'dür ve manifest tek dillidir: `<link
rel="manifest">` varsayılan olarak çerez göndermez, bu yüzden dil çerezine
bakan bir manifest güvenilir çalışmaz. Sayfa metinleri her zamanki gibi
kullanıcının dilinde kalır.

**Servis çalışanı YOKTUR ve bilerek yoktur.** Sayfalar `no-store`; bir
önbellek ödeme sayfasını ya da imzalı bir yükü saklayabilir, o sınırı delerdi.
Çevrimdışı bir hedef de yok. Android'de "ana ekrana ekle" istemi çıkmazsa ilk
bakılacak yer burasıdır.

### Marka işareti ve ikonlar

İşaret (`₺`) **yalnızca geometriyle** çizilir ve hiçbir fonta bağlı değildir:
kaynağı `src/lib/brand/mark.ts`, başlıktaki işaret ile uygulama ikonları aynı
yollardan üretilir. Daha önce başlıktaki `₺` bir metin düğümüydü, yani her
cihazda o cihazın fontuyla çiziliyordu.

İkonlar depoya işlenmiştir; çalışma zamanında hiçbir şey yeniden çizilmez.
Geometri değişirse yeniden üretmek gerekir:

```bash
node scripts/generate-icons.mjs
```

Betik `npm run build`'in parçası **değildir** ve `sharp`'a ihtiyaç duyar.
`sharp` bir bağımlılık olarak tanımlı değildir; Next ile birlikte geldiği için
genelde bulunur, bulunmazsa betik bunu açıkça söyler.

İşaret maskelenebilir güvenli alanın (merkezi %80 çaplı daire) içinde kaldığı
için aynı görsel hem `any` hem `maskable` amacıyla bildirilir; ayrı bir
maskelenebilir dosya gerekmez. Bu, `src/lib/brand/pwa-shell.test.ts` içinde
ölçülür — geometri büyürse test kırmızıya döner.

## Gizlilik politikası ve Play Console veri güvenliği

Politika `/privacy` adresindedir, tek adres iki dil (uygulamanın geri kalanı
gibi dil yol ön eki yoktur). Play Console'a verilecek adres budur. Metnin
kendisi `src/lib/legal/privacy.ts` içindedir; sayfa yalnızca onu çizer.

Metin **kaynak kodun denetiminden** çıkarılmıştır. Süreler koddaki sabitlerden
türetilir ve `privacy.test.ts` şunları zorlar: kaynakta geçen her dış alan
adı politikada bildirilmiş olmalıdır, süreler sabitlerin karşılığı olmalıdır,
ve iki dil aynı belgeyi anlatmalıdır. Yeni bir servise bağlanan kod,
politikayı güncellemeden testlerden geçemez.

### Denetimin iki dürüst sonucu

- **Süresi dolan ortak hesap kayıtları artık siliniyor.** Süre dolunca hesap
  açılamaz ve ödenemez; kayıt bir süre daha durur, sonra günlük çalışan bir
  temizlikle (`/api/cron/retention`) borç satırlarıyla birlikte kaldırılır.
  Süreler koddaki sabitlerden (`src/lib/db/retention.ts`) türetilir ve
  politikada yazar; burada tekrarlanmaz.

  Temizliğin iki ayrıntısı kazara bozulabilir:

  - **Cascade'e güvenilmez.** `shared_bill_payment_attempts`, teklifleri
    `ON DELETE RESTRICT` ile referanslıyor; tek bir cascade'li silme sıraya
    bağlı olarak yabancı anahtar hatasıyla düşebilir. Silme, çocuktan
    ebeveyne AÇIK sırayla ve tek işlemde yapılır.
  - **Bütün deyimler AYNI hedef kümesini kullanır.** Ölçüt tek yerde
    tanımlanıp her deyime gömülür; farklı kümeler, borç satırları silinmiş
    ama kendisi duran bir hesap bırakabilirdi.

  Uç `CRON_SECRET` ile korunur ve sır tanımlı değilse **hiç çalışmaz**.
- **Zincire yazılan hiçbir şey geri alınamaz.** Silme hakkı oraya ulaşmaz;
  politika bunu yumuşatmadan söyler.

### Veri güvenliği formu eşlemesi

Faz 5'te Play Console formu doldurulurken kullanılacak karşılıklar. "Paylaşım"
Play'in tanımıdır: veri cihazdan çıkıp üçüncü bir tarafa ulaşıyorsa paylaşım
sayılır.

| Play veri türü | Toplanır | Paylaşılır | Geçici mi | Zorunlu mu | Amaç |
| --- | --- | --- | --- | --- | --- |
| Kişisel bilgi → E-posta adresi | Evet | Hayır | Hayır | Google girişi seçilirse | Hesap yönetimi |
| Kişisel bilgi → Ad | Evet | Hayır | Hayır | Google girişi seçilirse | Hesap yönetimi |
| Fotoğraf ve video → Fotoğraflar | Evet | **Evet (OpenAI)** | **Evet** | Fiş yüklenirse | Uygulama işlevi |
| Finansal bilgi → Diğer finansal bilgi (cüzdan adresi, borç tutarı) | Evet | **Evet (herkese açık blok zinciri)** | Hayır | Evet | Uygulama işlevi |
| Uygulama etkinliği | Hayır | — | — | — | İzleme yoktur |
| Cihaz veya diğer kimlikler | Hayır | — | — | — | Reklam kimliği kullanılmaz |
| Kilitlenme kayıtları / tanılama | Hayır | — | — | — | Toplanmaz |

En sık yanlış işaretlenen iki satır kalın olanlardır: **fiş fotoğrafı OpenAI'ye
gider**, yani "paylaşılır"; ve **cüzdan adresleriyle işlemler herkese açık bir
zincire yazılır**, yani orası da bir paylaşımdır.

Güvenlik uygulamaları bölümü:

| Soru | Cevap |
| --- | --- |
| Veri aktarım sırasında şifreleniyor mu | Evet (HTTPS/TLS) |
| Kullanıcı silme talep edebiliyor mu | Evet |
| Uygulama içinde hesap silme yolu var mı | Evet, `/account` |
| Silme talebi için web adresi | `https://arcproje-seven.vercel.app/account` |
| Bağımsız güvenlik incelemesinden geçti mi | Hayır |

### Hesap silme

Play, hesap açtıran uygulamalardan **iki** şey ister: uygulama İÇİNDE bir silme
yolu ve silme talebi için herkesin açabileceği bir **web adresi**. `/account`
sayfası ikisini birden karşılar; forma verilecek adres budur.

Silme kapsamı şemadaki yabancı anahtarlarla belirlenir, kodda ayrıca
silinmez:

- `app_users` satırı gider (doğrulanmış e-posta, görünen ad, avatar adresi).
- `saved_contacts` **ON DELETE CASCADE** ile gider.
- `shared_bills` **ON DELETE SET NULL** ile SAHİPSİZ kalır ama **durur**.
  İçlerinde başkalarının borcu vardır; hesabını silen kişi onların ödeme
  yolunu kapatamaz. Politika bunu ve zincirin silinemezliğini açıkça söyler.

Google girişi yalnızca hesap **oluşturan** akış için gerekir. Bağlantıyla gelen
borçlu, Google hesabı olmadan yalnızca cüzdan imzasıyla kendi borcunu görür ve
öder; o akışta e-posta ve ad hiç toplanmaz.

## Google kimlik doğrulama temeli

Ana creator arayüzü oturum açmadan görüntülenebilir. Aşağıdaki pahalı/yazıcı
işlemler sunucuda Google oturumu gerektirir ve oturum yoksa gövde okunmadan
genel, önbelleksiz `401 AUTH_REQUIRED` JSON yanıtı döner:

- `POST /api/receipts/analyze`
- `POST /api/shared-bills`

Fiş seçimi oturum yönlendirmesinde tutulmaz veya yüklenmez. Kullanıcı Google
girişinden döndüğünde görseli yeniden seçer. Fiş görseli yalnızca kimliği
doğrulanmış kullanıcı **Fişi analiz et** işlemini açıkça başlattığında
OpenAI'ye gönderilir; sunucuda veya kullanıcı tablosunda saklanmaz.

### Kimlik, oturum ve saklanan veri

Auth.js v5 ve resmi Google OIDC provider kullanılır. OAuth state, PKCE, nonce,
callback doğrulaması ve güvenli cookie davranışı kütüphanenin sınırındadır.
İstenen scope tam olarak `openid email profile`dır; Google API erişimi yoktur.

Uygulama kimliği e-posta değildir: `provider = google` ile Google'ın kararlı
provider account ID'si (`sub`) birlikte benzersizdir. Her hesap için rastgele,
opak bir uygulama kullanıcı UUID'si üretilir. Aynı e-postayı bildiren iki ayrı
Google hesabı birleşmez; aynı Google hesabının eşzamanlı ilk girişleri Postgres
`ON CONFLICT` upsert ile tek kayda çözülür.

`app_users` yalnızca opak kullanıcı ID'si, provider/provider hesap ID'si,
normalize e-posta, doğrulanma bayrağı, isteğe bağlı görünen ad/avatar ve zaman
damgalarını saklar. E-posta profil metadatasıdır; yetkilendirme anahtarı değildir.
Google access token, refresh token ve ID token **hiçbir veritabanına veya oturum
JWT'sine yazılmaz ve loglanmaz**. Auth.js adapter kullanılmaz. Oturum, yalnızca
minimal uygulama kullanıcı kimliğini ve güvenli görünen profil alanlarını taşıyan,
`HttpOnly`, `SameSite=Lax` ve üretimde `Secure` şifreli JWT-cookie'dir; browser
storage kullanılmaz.

### Cüzdan-only kalan borçlu akışı

Google oturumu aşağıdaki sayfa ve API'lerde istenmez; global auth middleware'i
yoktur:

- `/pay`, `/pay/[billId]`
- `/api/shared-bills/[billId]/challenge`, `/resolve`, `/me`
- `/api/shared-bills/[billId]/payment/*`
- `/api/rates/usdc-try`, `/api/rates/verify`

Borçlu kendi borcunu yalnızca mevcut cüzdan challenge/imza oturumuyla görür ve
öder. Google oturumu cüzdan sahipliği kanıtının yerini alamaz; borçlu cüzdanı
Google kullanıcısıyla ilişkilendirilmez ve creator'ın Google profili paylaşılmaz.

### Google Cloud ve dağıtım için elle yapılacaklar

Bu depodaki değişiklik Google Cloud, Vercel veya Neon'u kendiliğinden
yapılandırmaz. Daha sonra şu adımlar elle uygulanmalıdır:

1. Google Cloud Console'da OAuth consent screen ve **Web application** client
   oluştur; yalnızca temel OpenID profil/e-posta izinlerini kullan.
2. Authorized JavaScript origins listesine `http://localhost:3000` ve
   `https://arcproje-seven.vercel.app` ekle.
3. Authorized redirect URIs listesine şunları birebir ekle:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://arcproje-seven.vercel.app/api/auth/callback/google`
4. Yerel sunucuda boş örneklerden `AUTH_SECRET`, `AUTH_GOOGLE_ID` ve
   `AUTH_GOOGLE_SECRET` değerlerini güvenli biçimde tanımla; Google girişini
   kullanmak için `APP_ORIGIN` değerini de açıkça tanımla (yerelde
   `http://localhost:3000` olabilir). `AUTH_SECRET` için yukarıdaki 32 rastgele
   bayt / 64 küçük hex üretim komutunu kullan.
5. Vercel'de aynı üç server-only değişkeni ve
   `APP_ORIGIN=https://arcproje-seven.vercel.app` değerini elle tanımla.
   Hiçbir sırra `NEXT_PUBLIC_` öneki verme.
6. İncelenen `migrations/0002_app_users.sql` geçişini hedef Neon ortamına
   ayrıca ve kontrollü biçimde uygula. Uygulama şemayı istek sırasında yaratmaz.

Preview deployment hostları bilerek OAuth origin listesine alınmamıştır. Auth.js
origin'i gelen `Host`, `Origin`, `Referer` veya `X-Forwarded-Host` başlıklarından
değil, doğrulanmış `APP_ORIGIN` değerinden kurar.

Diğer komutlar:

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

## Otomatik USDC/TRY kuru

Kur artık elle girilmez. Sunucu kuru CoinGecko'dan alır, kanonik biçime
indirger ve HMAC-SHA-256 ile imzalar; ödeme talebi bu **imzalı teklife**
bağlanır.

### Neden sunucu imzalıyor

Talebi oluşturan kişi kendi cüzdanıyla istediği alanı imzalayabilir. Bu yüzden
EIP-712 imzası kurun piyasadan geldiğini **kanıtlamaz** — yalnızca alanları
kimin imzaladığını kanıtlar. Kuru sunucunun HMAC etiketi korur: etiket kurun
kendisini de kapsadığı için, oluşturucu kuru değiştirip tutarı yeniden
hesaplasa bile borçlunun tarayıcısında yapılan sunucu doğrulaması düşer.

### CoinGecko Demo anahtarı nasıl alınır

1. <https://www.coingecko.com/en/api> adresinden ücretsiz **Demo** planına
   kaydol.
2. Panelden bir Demo API anahtarı üret.
3. Anahtarı `.env.local` içindeki `COINGECKO_DEMO_API_KEY` alanına yaz.

Anahtar yalnızca `x-cg-demo-api-key` başlığında taşınır; sorgu dizesine
konmaz ve istemciye hiç gönderilmez.

### RATE_QUOTE_SECRET nasıl üretilir

Sırrı depoya **yazmadan** yerelde üret:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Çıktıyı `.env.local` içindeki `RATE_QUOTE_SECRET` alanına yapıştır. En az 32
karakter olmalıdır. `.env.local` git tarafından yok sayılır; sırrı asla
`.env.example`, test, log veya commit içine koyma.

### Akış

1. Ödeme talebi ekranına gelindiğinde kur **bir kez** otomatik istenir.
2. Sunucu `GET /api/rates/usdc-try` ile taze bir teklif basar.
3. Teklif 5 dakika geçerlidir; ekranda geri sayım gösterilir.
4. Talep yalnızca geçerli ve süresi dolmamış bir teklifle imzalanabilir.
5. Borçlunun sayfası teklifi `POST /api/rates/verify` ile sunucuya doğrulatır;
   doğrulama geçmeden cüzdan, tahmin ve gönderim kontrolleri **görünmez**.
6. Kur, tahminden hemen önce ve gönderimden hemen önce yeniden doğrulanır.

### Kur biçimi ve tutar hesabı

Sağlayıcı değeri sınırda **bir kez** altı ondalıklı kanonik metne çevrilir
(ör. `42.123456`), sonra `42123456 / 1000000` rasyoneline dönüşür. Borç ve
mikro-USDC hesabının tamamı BigInt'tir; kanonikleştirmeden sonra hiçbir yerde
kayan nokta aritmetiği kullanılmaz. USDC tutarı her zaman 6 ondalıklı tam sayı
mikro-USDC'dir.

### Geçerlilik süreleri

| Süre | Değer |
| --- | --- |
| Kur teklifi ömrü | 5 dakika |
| Ödeme talebi ömrü | teklifin bitişini **aşamaz** |
| Sağlayıcı gözlem yaşı üst sınırı | 10 dakika |
| Sunucu önbelleği | ~60 saniye |

Ödeme talebi dayandığı teklifden uzun yaşayamaz. Bu, paylaşılan bağlantının
pratikte **5 dakika içinde** ödenmesi gerektiği anlamına gelir.

### Demo plan ve önbellek sınırları

CoinGecko Demo planı kredi sınırlıdır ve verisi yaklaşık 60 saniye tazeliktedir.
Sağlayıcı sonucu sunucu belleğinde ~60 saniye önbelleklenir ve aynı penceredeki
eşzamanlı istekler tek bir yukarı akış çağrısında birleşir; böylece her render
veya her kullanıcı bir kredi harcamaz.

Önbellek **süreç içidir**. Sunucusuz ortamda her soğuk başlangıç ve her
eşzamanlı örnek kendi önbelleğini tutar; bu yüzden önbellek bir garanti değil,
bir iyileştirmedir. Paylaşılan/kalıcı önbellek bu sürümün kapsamı dışındadır
(arka uç veya veritabanı eklenmemiştir).

> **Dağıtım gereksinimi — tamamlanmış bir garanti DEĞİL.** Herkese açık bir
> Vercel dağıtımında örnekler arası kota koruması bu depoda
> **karşılanmamıştır**. Paylaşılan bir sayaç/oran sınırlayıcı (Redis/KV) ya da
> Vercel firewall/rate limiting **dağıtım tarafında ayrıca yapılandırılmalıdır**.

### Sağlayıcı hatalarında soğuma (negatif önbellek)

Sağlayıcı 429/5xx/zaman aşımı döndüğünde her istek yeni bir yukarı akış çağrısı
üretirse Demo kotası hızla tükenir. Bu yüzden ardışık hatalarda **sınırlı bir
soğuma** uygulanır:

| Davranış | Değer |
| --- | --- |
| Taban soğuma | 5 sn |
| Üstel büyüme | her ardışık hatada iki katı |
| Tavan | 120 sn |
| `Retry-After` üst sınırı | 300 sn |

- Soğuma boyunca CoinGecko **hiç çağrılmaz**; uygulama kontrollü ve yeniden
  denenebilir bir hata ile `Retry-After` başlığı döner.
- CoinGecko'nun `Retry-After` başlığı yalnızca saniye biçiminde ve güvenli bir
  aralığa **kırpılarak** dikkate alınır.
- İlk başarılı yanıt soğumayı sıfırlar.
- Yapılandırma eksikliği (anahtar/sır yok) bir sağlayıcı arızası **değildir** ve
  soğutulmaz.
- Bozuk veya bayat veri asla geçerli başarı olarak önbelleklenmez.

> **Bu koruma yalnızca MVP düzeyindedir ve çapraz örnek riski ÇÖZÜLMEMİŞTİR.**
> Soğuma ve önbellek **süreç içidir**; Vercel sunucusuz örnekleri arasında
> **paylaşılmaz**. Tek bir örneği korur, toplam yukarı akış hızını **hiç**
> sınırlamaz: yeterince eşzamanlı örnekle Demo kotası yine tükenebilir.
>
> Gerçek ölçekte gereken paylaşılan depo/oran sınırlayıcı (ör. Redis/KV
> tabanlı) ya da Vercel firewall/rate limiting bir **dağıtım gereksinimidir**;
> bu odaklı düzeltmede böyle bir bağımlılık **eklenmemiştir** ve risk
> **açık kalmaktadır**.

### Gönderim sonucu belirsizse

`kit.send` çağrıldıktan sonra ortaya çıkan her hata "gönderilemedi" demek
değildir: işlem zincire düşmüş olabilir. Bu yüzden sonuçlar ikiye ayrılır.

Sınıflandırma **yalnızca belgelenmiş yapısal alanlara** bakar (EIP-1193 kodu,
App Kit `errorCategory`, `KitError` ad+kod çifti). Hata **metni** hiçbir karara
girmez: "insufficient ..." veya "user rejected" yazması işlemin yayınlanmadığını
kanıtlamaz.

| Durum | Davranış |
| --- | --- |
| `UserRejectedRequestError` / `user_rejected` / **ham** EIP-1193 4001, hash **yok** | Yayın öncesi kesin; yeniden denenebilir |
| `RPC_ENDPOINT_ERROR`, `type: "RPC"` veya 4001 kullanan ağ `KitError`'ı | **Belirsiz**; 4001 tek başına ret kanıtı DEĞİLDİR |
| `BALANCE_INSUFFICIENT_TOKEN/GAS/ALLOWANCE` (9001–9003), hash **yok** | Yayın öncesi kesin; yeniden denenebilir |
| `state: "success"` **ve** geçerli hash | Başarı |
| `state: "error"` + geçerli hash + kategori **yok** | **Revert** (kurulu SDK'nın onaylanmış makbuz şekli); asla "ödendi" değil |
| `chain_revert`, `reverted_onchain`, `partial_reverted` | **Revert**; hash korunur |
| `pending`, `noop`, tanınmayan durum veya kategori | **Belirsiz**; gönderim kilidi açılmaz, hash korunur |
| viem `WaitForTransactionReceiptTimeoutError` | **Belirsiz**; hash mesajdan kurtarılır ve korunur |
| Herhangi bir hata **hash taşıyorsa** | Yayın öncesi sayılmaz; **belirsiz** |

Revert ve belirsizlikte işlem hash'i **kaybedilmez**: yerel kayıtta ve ekranda
tutulur ki ArcScan'de mutabakat yapılabilsin.

Hata incelemesi **hiçbir koşulda fırlatmaz**. Cüzdan/sağlayıcı hataları
fırlatan getter, durumlu erişimci veya iptal edilmiş proxy içerebilir; böyle
bir nesnede `error.code` ya da `Array.isArray` bile TypeError atar. Bu yüzden
incelenen her alan korumalı okunur, **en fazla bir kez** okunup düz bir anlık
görüntüye alınır (durumlu bir getter hash analizi ile ret analizi arasında
değer değiştiremez) ve okunamayan bir alan dolaşımı **eksik** işaretler. Eksik
dolaşımda ya da geçerli bir hash bulunduğunda sonuç **`submissionUnknown`**
olur, rezervasyon **kilitli kalır**; kurtarılmış hash yine de ArcScan için
saklanır. `kit.send` çağrıldıktan sonra sınıflandırıcının kendisi çökse bile
sonuç asla yeniden denenebilir `sendFailed` olmaz.

Hata **grafiği** sınırlı ve döngüye dayanıklı biçimde dolaşılır; yalnızca
beklenen bağlantılar (`cause`, `trace`, `rawError`, `errors`) izlenir. Bir
bağlantı **dizi/kap** değerliyse (ör. `AggregateError.errors` ya da dizi
değerli bir `cause`) dolaşım **eksik** işaretlenir: desteklenen tekil nesne
şekli değildir ve içinde gizli bir ret kimliği veya işlem hash'i olabilir.
Elemanlar yine de yalnızca hash kurtarmak için taranır; sonuç hiçbir koşulda
yeniden denenebilir olmaz.

Bağlantı değerleri bir **izin listesiyle** kabul edilir: yokluk, sıradan
kayıt/hata nesnesi (düz nesne, prototipsiz nesne veya `Error` türevi) ve
güvenle taranan dizi. `Set`, `Map`, `WeakSet`, `WeakMap`, tipli diziler,
`ArrayBuffer` görünümleri, özel yinelenebilirler, dizi benzeri nesneler,
thenable'lar, fonksiyonlar ve tanınmayan kap prototipleri **desteklenmez**:
içleri güvenle sayılamadığı için dolaşım **eksik** işaretlenir ve içlerine
girilmez. `errors` alanı yalnızca **dizi** şeklinde taranır. Her kap türü için
ayrı bir gezinme uygulaması eklenmez; tercih edilen davranış fail-closed'dur. Kurulu yığın
gerçek cüzdan reddini `cause.trace.rawError.rawError` gibi derin bir yola
gömebildiği için yalnızca `cause` zincirini izlemek yetmez. Buna karşılık
**kod 4001 tek başına ret kanıtı değildir**: kurulu App Kit'te
`RpcError.ENDPOINT_ERROR` da 4001 kullanır (`type: "RPC"`), bu bir uç nokta
arızasıdır ve `kit.send` sonrası belirsiz bir gönderimi temsil edebilir. Ret
yalnızca **olumlu bir iptal kimliğinden** tanınır ve grafikte **geçerli bir
işlem hash'i varsa asla** ret sayılmaz.

Kurulu `viem` (2.55.19) onay bekleme zaman aşımında hash'i **tipli bir alanda
tutmaz**, yalnızca hata cümlesinin içinde geçirir; kurulu adaptör de bu çağrıyı
sarmalamaz. Hash olmadan işlem ArcScan'de bulunamayacağı için bu tek durumda
metin okunur — ama **yalnızca** hata adı birebir tutuyorsa, **tam cümle
kalıbıyla** ve katı hash doğrulayıcısıyla. Rastgele bir mesajın içinden hash
**çıkarılmaz**. Sonuç yine de **belirsizdir**: onay alınamamıştır.

Belirsiz durumda kullanıcıya önce MetaMask işlem geçmişini ve ArcScan'i kontrol
etmesi söylenir. Ayrıca `chainId + requestId` anahtarlı, **gizli veri
içermeyen** yerel bir işaretçi tutulur; aynı tarayıcıda kazara ikinci gönderimi
azaltır.

Kayıt **talep başına ayrı bir `localStorage` anahtarındadır** (`v2` şeması).
Tek bir ortak dizi kullanılsaydı, farklı talepler eşzamanlı yazdığında "oku,
diziyi değiştir, yaz" adımları birbirinin kaydını silebilirdi. Yazılan kayıt
geri okunur ve `chainId`, `requestId`, sonuç, sahip jetonu, zaman damgası ve
varsa işlem hash'i **birebir** doğrulanır; doğrulanamazsa gönderime
**geçilmez**. Sonuç `pending` / `success` / `reverted` / `unknown` olarak ayrı
ayrı saklanır ve geçerli bir işlem hash'i de kalıcıdır: sayfa yenilense bile
ArcScan mutabakat bağlantısı görünmeye devam eder. Bozuk hash **asla yazılmaz**;
depoda bozulmuş bir hash sonucu düşürmez, yalnızca bağlantı gösterilmez.

> Bu işaretçi **yetkili bir koruma değildir.** `localStorage` cihaz ve tarayıcı
> başınadır: gizli sekmede, başka bir cihazda veya temizlenmiş depoda hiçbir şey
> hatırlanmaz. `unknown` kaydı ödemenin yapıldığını da yapılmadığını da
> **söylemez**; yalnızca sonucun doğrulanamadığını söyler.

Sonuç, SDK'nın belgelenmiş `BridgeStep` sözleşmesine göre yorumlanır. Başarı
için **hem** `state: 'success'` **hem de** geçerli bir işlem hash'i gerekir;
tek başına geçerli hash yeterli değildir. `chain_revert` / `reverted_onchain`
gibi kategoriler **asla "ödendi" sayılmaz**, ayrı bir terminal sonuç üretir ve
hash ArcScan bağlantısı için korunur. `pending`, `noop` veya sınıflandırılamayan
durumlar belirsizdir.

`kit.send` başladıktan sonra **serbest metin eşleştirilmez**: "insufficient
confirmations" gibi bir mesaj işlemin gönderilmediğini kanıtlamaz. Yalnızca
EIP-1193 kodu `4001` veya SDK'nın `errorCategory: 'user_rejected'` sınıfı yayın
öncesi sayılır — SDK dokümanı da makine kararları için `errorCategory`
kullanılmasını önerir.

### Gönderim rezervasyonu (aynı tarayıcı)

Gönderime girmeden hemen önce `chainId + requestId` kaydı **eşzamanlı olarak**
yeniden okunur; `success`, `unknown` veya `pending` görülürse gönderim
engellenir. Gönderim başlamadan önce `pending` rezervasyonu yazılır, diğer
sekmeler `storage` olayı ve `BroadcastChannel` ile uyarılır ve mümkünse Web
Locks ile aynı anda tek gönderim çalışır. Rezervasyon **yalnızca yayın öncesi
olduğu kanıtlanmış** hatalarda serbest bırakılır; başarı, revert ve belirsiz
sonuçta korunur.

Cüzdan akışı açılmadan önce **en az 60 saniye** kalan süre aranır; bu kontrol
preflight ve App Kit kurulumundan **sonra, `kit.send`'den hemen önce** bir kez
daha yapılır. Teklif basımı da bu payı gözetir: paydan kısa ömürlü bir teklif
üretilmez.

> **Sınır:** doğrudan bir ERC-20 transferinde, cüzdan istemi açıldıktan sonra
> son tarihi zincire dayatmanın yolu yoktur. Kullanıcı istemi dakikalarca açık
> bırakıp onaylarsa işlem, süresi dolmuş bir kurla zincire düşebilir. Gerçek
> değerli kullanım bunun için zincir üstü son tarih veya ayrık imzala-yayınla
> mimarisi gerektirir.

### Gerçek değerli kullanım için eksikler

Bu sürüm Arc Testnet içindir. Gerçek parasal değer taşıyan bir dağıtım için
aşağıdakiler **hâlâ gereklidir** ve bu depoda yoktur:

- **Yetkili tekrar oynatma engeli** — `requestId`'nin arka uçta veya zincir
  üstünde **atomik olarak tüketilmesi**. Tarayıcı içi işaretçi ve bağlantının
  tek kullanımlık sayılması bunun yerine geçmez.
- **Zincir üstü son tarih uygulaması** — teklif/talep bitişini zincirin
  kendisinin dayatması için bir ödeme sözleşmesi veya imzalama ile yayınlamanın
  ayrıldığı bir akış. Şu anki süre kontrolleri istemci ve sunucu tarafındadır;
  imzalanmış bir işlem gecikmeli olarak yayınlanırsa zincir bunu engellemez.
- **Örnekler arası kota koruması** — CoinGecko sınırları için paylaşılan bir
  Redis/KV sayacı ya da Vercel firewall/rate limiting. Bu bir **dağıtım
  gereksinimidir** ve bu depoda **karşılanmamıştır**: süreç içi soğuma yalnızca
  tek örneği korur, herkese açık bir Vercel dağıtımında risk **açık
  kalmaktadır**.
- **Aynı tarayıcı dışında tekrar engeli** — Web Locks, `localStorage` ve
  `BroadcastChannel` yalnızca tek tarayıcı içindir. Başka cihaz, başka tarayıcı
  veya gizli sekme hiçbir şey bilmez; yetkili engel için arka uçta ya da zincir
  üstünde atomik `requestId` tüketimi şarttır.

### Hata davranışı

Kur alınamaz veya doğrulanamazsa **elle girilen bir kura düşülmez** ve ödeme
talebi oluşturulamaz. Borçlu tarafında teklif doğrulanamazsa cüzdan ve gönderim
kontrolleri hiç gösterilmez.

### Atıf

Kur verisi CoinGecko'dan alınır ve arayüzde
[Data provided by CoinGecko](https://www.coingecko.com/en/api) bağlantısıyla
belirtilir.

### Arc Testnet uyarısı

Arc Testnet USDC'sinin **gerçek parasal değeri yoktur**. Gösterilen kur yalnızca
test amaçlıdır ve hiçbir gerçek varlığı temsil etmez.

### Vercel'e taşırken

Dağıtımda şu sunucu ortam değişkenleri tanımlanmalıdır:

- `OPENAI_API_KEY`
- `COINGECKO_DEMO_API_KEY`
- `RATE_QUOTE_SECRET`
- `DATABASE_URL` (paylaşılan ortak hesap deposu; Part 2'de zorunlu olacak)

Hepsi `NEXT_PUBLIC_` olmadan, yalnızca sunucu tarafı değişken olarak eklenir.
Mobil cüzdan bağlantısı isteniyorsa ayrıca `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
tanımlanır; bu tek değişken bilinçli olarak istemci paketine girer.

### `NEXT_PUBLIC_` bir değişken eklendikten sonra

Bu değişkenler **derleme anında** koda gömülür, çalışma anında okunmaz.
Vercel'e ekleyip kaydetmek tek başına hiçbir şey değiştirmez: yeni bir
**derleme** gerekir.

Boş bir commit itmek bunun için yeterli OLMAYABİLİR — kaynak ağacı birebir
aynı kaldığında Vercel önceki derleme çıktısını yeniden kullanabilir ve
değişken yine pakete girmez. Güvenilir iki yol:

- Vercel panelinde **Redeploy**, ve **"Use existing Build Cache" işaretini
  kaldırarak**;
- ya da kaynağı gerçekten değiştiren bir commit itmek.

Değerin pakete girip girmediği doğrudan ölçülebilir: derlemeden sonra
istemci paketinde değişkenin ADI kalmamalıdır. Kaldıysa yerine koyma
olmamış demektir.

```bash
grep -rl "env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID" .next/static
```
Neon veritabanı **bu bölümde sağlanmadı**; Marketplace kurulumu, geçişin
uygulanması ve `DATABASE_URL`'in tanımlanması ayrı bir adımdır.

Ayrıca bir **dağıtım gereksinimi** vardır ve kod tarafında karşılanamaz:
CoinGecko kotasını örnekler arasında koruyacak paylaşılan bir sayaç/oran
sınırlayıcı (Redis/KV) ya da Vercel firewall/rate limiting yapılandırması.
Uygulamadaki soğuma **süreç içidir** ve tek başına yeterli **değildir**.

## Tek bağlantılı ortak hesap (Part 1 — temel)

Bugünkü akışta fişi ödeyen kişi **her borçlu için ayrı** bir talep imzalar ve
**ayrı** bir bağlantı üretir. Hedef mimari tek bağlantıdır: ödeyen cüzdanını bir
kez bağlar, her borçlu için bir adres girer, **tek bir EIP-712 manifest** imzalar
ve **herkes aynı** `/pay/<billId>` bağlantısını alır.

> **Part 1 yalnızca TEMELİ kurar.** İmzalı manifest, kalıcı depo, katı
> doğrulama, oluşturma API'si ve oluşturucu arayüzü hazırdır. **Borçlu tarafı
> henüz yoktur**: `/pay/<billId>` rotası, ödeme rezervasyonu ve işlem
> kesinleştirme Part 2'dedir. Bu yüzden yeni akış
> `SHARED_BILL_FLOW_ENABLED` bayrağıyla **kapalıdır** ve üretimde eski,
> borçlu başına ayrı bağlantı üreten akış çalışmaya devam eder.

### Neden bir veritabanı gerekiyor

Tek bağlantı, borç listesini URL'ye gömemez: aksi hâlde bağlantıyı eline geçiren
herkes **bütün borçluları, adresleri ve tutarları** görürdü ve bağlantı
kilometrelerce uzun olurdu. Bu yüzden liste sunucuda saklanır ve URL yalnızca
**tahmin edilemez bir kimlik** taşır. Üretimde **Neon Postgres** (Vercel
Marketplace üzerinden) kullanılır; sunucu değişkeni `DATABASE_URL`'dir.

### Ne saklanır, ne saklanmaz

| Saklanır | Saklanmaz |
| --- | --- |
| Genel hesap kimliği (0x + 64 hex) | Fiş görseli |
| Şema sürümü, Arc chainId | Ürün satırları, vergi/servis/indirim |
| Alıcı adresi ve etiketi | OpenAI çıktısı |
| Borç listesinin **kriptografik taahhüdü** | API anahtarları, HMAC etiketi |
| Borç sayısı, veriliş/bitiş anı | **Kur teklifi** (bilerek) |
| Alıcının EIP-712 imzası | İlgisiz katılımcılar |
| Borç satırları: adres, etiket, borç kimliği, TRY minor tutar | |

**Kur bilerek saklanmaz.** Alıcı yalnızca TRY minor unit borçları imzalar; USDC
tutarı, borçlu ödediği anda alınan **taze ve sunucu kimliklendirmeli** bir
USDC/TRY teklifinden türetilir (Part 2). Böylece günlerce yaşayan bir bağlantı,
dakikalar ömürlü bir kura çakılmaz.

### İmzalanan manifest

Ayrı bir EIP-712 alanı kullanılır (`Hesabi Bol Shared Bill`); ödeme talebi
imzası paylaşılan hesap imzası olarak **kullanılamaz**. İmza şunları kapsar:

`schemaVersion`, `billId`, `chainId`, `recipient`, `recipientLabel`,
`debtsRoot`, `debtCount`, `issuedAt`, `expiresAt`.

Borç **listesi** manifeste gömülmez; yerine kanonik bir taahhüt imzalanır:

1. Her satır alan ayrılmış bir **yaprak** özetine indirgenir.
2. Satırlar **kanonik sıraya** dizilir: borçlu adresine göre (küçük harf) artan.
   Borçlu adresi hesap başına benzersiz olduğu için bu sıra tamdır — girdi
   sırası ne olursa olsun **aynı** manifest üretilir.
3. Yapraklar konumsal bir **Merkle ağacıyla** tek bir köke çıkarılır; kök
   ayrıca şema sürümü, `chainId`, `billId` ve satır sayısını bağlar.

> Ayrıntı ve gerekçe için aşağıdaki **Merkle gizlilik modeli** bölümüne bak.
> Part 1'deki toplu (aggregate) hash, bir borçlunun kendi satırını diğerlerini
> görmeden doğrulamasına izin vermediği için **değiştirildi**.

`JSON.stringify` çıktısı taahhüt olarak **kullanılmaz**: anahtar sırası ve
Unicode kaçışları uygulamadan uygulamaya değişir. Sunucu, gönderilen satırlardan
taahhüdü **yeniden hesaplar**; istemcinin bildirdiği `debtsRoot`a güvenilmez.

### API sözleşmesi

`POST /api/shared-bills` — `Content-Type: application/json`, `Cache-Control: no-store`.

İstek: `{ manifest, debts, signature }`. Yanıt (201 yeni / 200 idempotent):

```json
{ "billId": "0x…", "path": "/pay/0x…", "expiresAt": 1700000000 }
```

Borç listesi, adresler, etiketler, taahhüt ve imza **dönmez**. Hata kodları:
`INVALID_CONTENT_TYPE`, `BODY_TOO_LARGE`, `MALFORMED_JSON`, `DUPLICATE_FIELD`,
`INVALID_SHARED_BILL`, `INVALID_SIGNATURE`, `BILL_ID_UNAVAILABLE`,
`STORAGE_REJECTED`, `SERVICE_NOT_CONFIGURED`, `SERVICE_UNAVAILABLE`.

Sıra kritiktir: gövde sınırlanır → yinelenen anahtar taranır → manifest, satırlar
ve taahhüt doğrulanır → alıcı imzası doğrulanır → **ancak ondan sonra**
veritabanı işlemi açılır. Hesap ve tüm borç satırları **atomik** yazılır; kısmi
bir hesap kalmaz.

**Idempotency:** aynı `billId` ile gelen tekrar, yalnızca depodaki **taahhüt,
alıcı ve imza birebir eşleşirse** güvenli sayılır ve yeniden yazılmaz. Aksi hâlde
üzerine yazılmaz, `BILL_ID_UNAVAILABLE` döner.

#### Ödeme uç noktaları (Part 3)

Hepsi `HttpOnly` oturum çerezi ister ve `Cache-Control: private, no-store`
döner. Hiçbiri istemciden **tutar, kur, alıcı veya borç** kabul etmez.

| Uç nokta | Gövde | Ne yapar |
| --- | --- | --- |
| `POST …/payment/prepare` | *(yok)* | Taze sunucu kuruyla **yetkili teklif** basar. Borcu **rezerve etmez**, cüzdan çağırmaz. |
| `POST …/payment/claim` | `{ offerId }` | Borcu **atomik rezerve eder**, tek deneme yaratır, gönderim snapshot'ını döner. |
| `POST …/payment/outcome` | `{ attemptId, outcome, txHash? }` | İstemci sonucunu **katı enum** ile alır. `success` **kabul edilmez**. |
| `POST …/payment/finalize` | `{ attemptId, txHash }` | Arc Testnet'ten **makbuzu doğrular**; borcu yalnızca kanıt varsa `paid` yapar. |
| `GET  …/payment/status` | *(yok)* | Yalnızca **kimliği doğrulanmış borçlunun kendi** ödeme durumu. |

Yanıtlar başka bir borç satırı, başka bir katılımcı, tam manifest listesi, ham
oturum jetonu, HMAC etiketi ya da veritabanı ayrıntısı **taşımaz**.

### Veritabanı yapılandırması ve geçiş

`.env.local` içine (bu dosya asla commit edilmez):

```bash
DATABASE_URL=
```

Şema **elle** uygulanır; tablolar istek işleyicisi içinde tembel oluşturulmaz:

```bash
psql "$DATABASE_URL" -f migrations/0001_shared_bills.sql
```

`DATABASE_URL` yoksa uygulama ve testler yine derlenir; depo gerektiren rota
kontrollü **503 `SERVICE_NOT_CONFIGURED`** döner ve bellek içi bir yedeğe
**asla** düşmez.

Geçiş dosyası **hiç uygulanmadığı için** Part 3'ün ödeme tabloları (teklif,
deneme ve borç ödeme durumu) **ayrı bir dosya yerine aynı `0001` geçişine**
eklenmiştir. Uygulanmış bir şemaya sonradan `ALTER TABLE` çalıştırmak
gerekmez.

### Gizlilik sınırı

> Bağlantıyı **eline geçiren herkes hesabı açabilir.** Bağlantı borç listesini
> taşımaz, ama sayfayı açmak listeyi getirir (Part 2). Bu yüzden bağlantı
> yalnızca ilgili kişilerle paylaşılmalıdır. Adresler, etiketler, imzalar,
> manifestler ve üretilen bağlantılar **loglanmaz**; hata mesajları belirli bir
> cüzdanın bir hesapta olup olmadığını açığa vurmaz.

### Hesap ömrü

Hesaplar sonludur: üst sınır **yedi gündür**
(`SHARED_BILL_MAX_LIFETIME_MS`). Süresi dolmuş bir hesap, fiziksel olarak
silinmemiş olsa bile **kullanılamaz sayılır**; sorgular her hâlükârda bitiş anını
filtreler. **Fiziksel temizlik (cleanup job) Part 2'ye ertelenmiştir**: bugün
süresi dolmuş satırlar tabloda kalmaya devam eder.

### Borçlu erişimi: aynı bağlantı, yalnızca kendi borcun (Part 2)

Herkes **aynı** `/pay/<billId>` bağlantısını alır. Bir borçlunun yalnızca
**kendi** borcunu görebilmesi için bağlı cüzdanın kontrolünü kanıtlaması
gerekir:

1. Cüzdanını bağlar, Arc Testnet'e geçer.
2. Sunucudan bir **erişim meydan okuması** ister.
3. İşlem **olmayan** bir EIP-712 mesajı imzalar.
4. Sunucu imzayı doğrular, nonce'u tüketir ve kısa ömürlü bir oturum kurar.
5. `/me` yalnızca o borçlunun **tek satırını** ve Merkle kanıtını döner.
6. Tarayıcı manifesti, alıcı imzasını ve kanıtı **bağımsız** doğrular.

#### Bu imza ne yapar, ne YAPMAZ

| Yapar | Yapmaz |
| --- | --- |
| Adresin kontrolünü kanıtlar | Token **onaylamaz** (approve değildir) |
| Tek bir hesap için görüntüleme yetkisi verir | Transfer **yetkisi vermez** |
| Beş dakika geçerlidir | İşlem **göndermez** |
| | Ödeme talebi/hesap **oluşturamaz** |

> İmza bir **kimlik veya KYC kanıtı değildir** ve borcun gerçek dünyada meşru
> olduğunu **kanıtlamaz**. Yalnızca "bu adresi kontrol eden kişi buradayım"
> der.

Erişim imzası **ayrı bir EIP-712 alanındadır** (`Hesabi Bol Shared Bill
Access`). Ne paylaşılan hesap manifesti ne de ödeme talebi imzası buraya
geçebilir; bu imza da oralarda kullanılamaz.

#### Merkle gizlilik modeli

Part 1'de borç taahhüdü tüm satırların tek bir toplu (aggregate) hash'iydi. Bu,
bir borçlunun kendi satırını doğrulayabilmesi için ona **tüm** borç satırlarını
vermeyi gerektirirdi — yani herkes herkesin adresini, adını ve tutarını
görürdü. Bu, tek bağlantının gizlilik hedefiyle doğrudan çelişiyordu.

Bu yüzden taahhüt bir **Merkle kökü** oldu (`debtsRoot`) ve şema sürümü 2'ye
yükseltildi; **sürüm 1 manifestleri fail-closed reddedilir**. Sürüm 1 hiçbir
yerde yayımlanmadı ve hiçbir veritabanına yazılmadı.

- **Yaprak**: alan ayrılmış etiket + şema sürümü + chainId + billId + borçlu
  adresi + `keccak256(etiket)` + `keccak256(borç kimliği)` + TRY minor tutar.
- **Sıra**: borçlu adresi (küçük harf) artan. Adres hesap başına benzersiz
  olduğu için sıra tamdır; **girdi sırası değişse de aynı kök** çıkar.
- **İç düğüm**: **konumsal** (sol, sağ) — sıralanmış çift kullanılmaz.
- **Tek sayıda düğüm**: son düğüm bir üst seviyeye **taşınır** (kopyalanmaz);
  kopyalama aynı yaprağın iki kez sayılmasına izin verirdi.
- **Kök**: ağaç kökü + şema + chainId + billId + **borç sayısı**.
- **Kanıt**: yalnızca `leafIndex` ve kardeş **özetleri**. Yön ve kardeş varlığı
  kanıttan okunmaz, `leafIndex` + `debtCount`tan **türetilir**; bu yüzden yön
  çevrilemez, kanıt uzatılamaz veya kısaltılamaz.

Bir borçlu böylece kendi satırını doğrular ama başka hiçbir satırın adresini,
etiketini, borç kimliğini veya tutarını **öğrenemez**.

#### Uç nokta sözleşmeleri

Hepsi `Cache-Control: no-store`; hiçbiri hesap kimliği, adres, nonce, imza,
oturum jetonu veya etiket **loglamaz**.

| Uç nokta | Ne yapar | Ne döner |
| --- | --- | --- |
| `POST /api/shared-bills/[billId]/challenge` | Meydan okuma üretir. Hesabın var olup olmadığına **bakmaz**, veritabanına **dokunmaz** | `{ challenge, tag }` — hiçbir hesap verisi yok |
| `POST /api/shared-bills/[billId]/resolve` | Etiketi + EIP-712 imzayı doğrular, nonce'u **atomik** tüketir, oturum kurar | `{ authenticated: true }` + **HttpOnly** çerez |
| `GET /api/shared-bills/[billId]/me` | Oturumu doğrular | manifest, alıcı adresi/etiketi, **tek** borç satırı, Merkle kanıtı, bitiş, durum |

**Hedef (audience)** yalnızca sunucudaki `APP_ORIGIN`dan gelir. `Host`,
`Origin`, `Referer` ve `X-Forwarded-Host` başlıklarına **asla** güvenilmez.

**Üyelik sızdırılmaz:** hesabın olmaması, kapalı olması, süresinin dolması ve
cüzdanın o hesapta bulunmaması **aynı** genel yanıtı üretir.

#### Oturum ve süreler

| Şey | Süre |
| --- | --- |
| Erişim meydan okuması | **5 dakika** (üst sınır) |
| Oturum | **15 dakika** (üst sınır; veritabanı kısıtı da uygular) |
| Paylaşılan hesap | **7 gün** (üst sınır) |

Ham oturum jetonu **yalnızca** `HttpOnly; SameSite=Strict; Path=/` çerezinde
taşınır (üretimde ayrıca `Secure`). Depoda **yalnızca SHA-256 özeti** saklanır:
veritabanını okuyan biri geçerli bir çerez üretemez. Jeton URL'de, JSON
gövdesinde, tarayıcı deposunda, logda, React state'inde veya HTML'de **hiç**
yer almaz.

Nonce **tek kullanımlıktır** ve atomik olarak tüketilir; eşzamanlı iki
çözümleme denemesinden **en fazla biri** başarılı olur.

#### Yeni sunucu değişkenleri

```bash
SHARED_BILL_AUTH_SECRET=
APP_ORIGIN=
```

- `SHARED_BILL_AUTH_SECRET` — meydan okuma zarfının HMAC sırrı (en az 32
  karakter). **`RATE_QUOTE_SECRET` ile paylaşılmaz**: birini ele geçiren
  diğerinin etiketlerini üretemez.
- `APP_ORIGIN` — güvenilen üretim origin'i (`https://…`, yol/sorgu içermez).

Üretimde ikisinden biri eksik veya bozuksa erişim uçları kontrollü
**503 `SERVICE_NOT_CONFIGURED`** döner. Geliştirmede (`NODE_ENV !== "production"`)
`APP_ORIGIN` için **açık** `http://localhost:3000` yedeği kullanılır; üretimde
bu yedeğe **asla** düşülmez.

#### Ne saklanır (Part 2 ekleri)

| Tablo | Saklanır | Saklanmaz |
| --- | --- | --- |
| `shared_bill_auth_nonces` | billId, nonce, borçlu adresi, tüketim/bitiş anı | — |
| `shared_bill_sessions` | jetonun **SHA-256 özeti**, billId, borçlu adresi, chainId, bitiş | **ham jeton**, fiş, ürün, API anahtarı |

Süresi dolmuş satırlar **fiziksel olarak silinmemiş olsalar bile kullanılamaz
sayılır**; sorgular her hâlükârda bitiş anını filtreler. Sınırlı ve fırsatçı
bir temizlik vardır (çağrı başına en fazla 50 satır); **sınırsız silme yapan
bir istek yolu yoktur**.

#### Part 2'de YAPILMAYANLAR

- **Ödeme yok**: kur çekilmez, tahmin alınmaz, App Kit çağrılmaz, hiçbir işlem
  gönderilmez.
- Ödeme rezervasyonu, işlem kesinleştirme ve "ödendi" durumu yok.
- Neon/Vercel sağlanmadı; geçiş uygulanmadı.
- Oluşturucu akışı hâlâ `SHARED_BILL_FLOW_ENABLED = false` ile **kapalı**;
  üretimde eski, borçlu başına bağlantı üreten akış çalışmaya devam ediyor.

> Bir **veritabanı satırı**, zincir üstünde yinelenen transferleri
> **engellemez** ve kriptografik bir tek-kullanım garantisi değildir. Cüzdan
> imzası borcun **meşruluğunu kanıtlamaz**. Bir istemcinin "başarılı" demesi
> ödemenin yapıldığını **kanıtlamaz**. Bu sürüm **Arc Testnet** içindir ve
> **mainnet'e hazır değildir**.

### Ortak hesap ödemesi (Part 3)

Part 3, kimliği doğrulanmış borçlu sayfasına **tam Arc Testnet ödeme yaşam
döngüsünü** ekler: taze sunucu kuru → tam sayı tutar türetme → tahmin →
inceleme → **sunucu rezervasyonu** → mevcut gönderim sınırı → **sunucunun
zincirden makbuz doğrulaması** → ancak o zaman "ödendi".

#### Durum makinesi

Borç (`shared_bill_debts.payment_status`):

```
unpaid ──claim──> reserved ──onaylı makbuz──> paid          (SON)
  ^                  │
  │                  ├── KANITLI yayın öncesi hata ──> unpaid
  │                  ├── onaylı REVERT makbuzu ──────> unpaid
  └──────────────────┘
                     └── belirsiz sonuç ────────> review_required

review_required ── OTOMATİK ──/──> paid       (ASLA; elle mutabakat)
review_required ── OTOMATİK ──/──> unpaid     (ASLA; elle mutabakat)
paid ──/──> herhangi bir durum                (ASLA geri dönmez)
```

Deneme (`shared_bill_payment_attempts.status`):

```
reserved ── istemci hash bildirdi ──────> submitted
reserved ── KANITLI yayın öncesi hata ──> released    (SON)
reserved | submitted ── onaylı makbuz ──> confirmed   (SON)
reserved | submitted ── revert makbuzu ─> reverted    (SON)
reserved | submitted ── çözülemedi ─────> unknown     (SON)
```

`confirmed`, `reverted`, `unknown` ve `released` **son** durumlardır.
`submitted` durumundan **serbest bırakma yoktur**: `kit.send` çağrıldıktan
sonra rezervasyon açılmaz. `unknown` da rezervasyonu **tutar** — belirsiz bir
deneme kendiliğinden yeniden denenebilir hâle gelmez.

Veritabanı kısıtları: borçlu başına **en fazla bir aktif deneme** (kısmi
benzersiz indeks), **küresel olarak benzersiz işlem hash'i**, teklif başına en
fazla bir deneme, `numeric(30, 0)` tam sayı tutarlar, kanonik kur paydası
(10^0..10^6) ve `paid` satırın **doğrulanmış hash + zaman** taşıma zorunluluğu.
Tüm geçişler **karşılaştır-ve-yaz**'dır; son yazan kazanan güncelleme yoktur.

#### Kur ne zaman alınır

Kur **manifeste gömülmez**. Borçlu ödemeye başladığında sunucu **taze** bir
USDC/TRY teklifi basar (`POST /api/shared-bills/<billId>/payment/prepare`).
Sunucu bunu **kendi kur servisinden doğrudan** alır; uygulamanın kendi
`/api/rates` rotasına HTTP isteği yapmaz. Mevcut CoinGecko önbelleği, soğuma,
doğrulama, HMAC ve altı ondalık kanonikleştirme aynen kullanılır. **Elle
girilen bir kura asla düşülmez**: kur servisi çalışmıyorsa teklif basılmaz.

Teklif ne kurdan ne de bağlantıdan **uzun yaşar** (`min` alınır) ve gönderim
için gereken **60 saniyelik pay**dan kısa ömürlü bir teklif hiç üretilmez.

#### Rezervasyon

`POST /api/shared-bills/<billId>/payment/claim` gövdesi **yalnızca teklif
kimliğini** taşır. Tutar, kur, alıcı ve borç istemciden **kabul edilmez**;
hepsi saklanan hesaptan okunur ve mikro USDC bu adımda **yeniden türetilip**
teklifle birebir karşılaştırılır. Rezervasyon başarılı olana kadar `kit.send`
**erişilemezdir**. Yanıt, mevcut gönderim sınırının beklediği **değişmez
snapshot**'tır; istemci onu incelediği teklifle birebir karşılaştırır ve tek
bir alan bile farklıysa **göndermez**.

#### Zincir üstü doğrulama

`POST /api/shared-bills/<billId>/payment/finalize` yalnızca **deneme kimliği ve
aday işlem hash'i** alır. Tüm ekonomik alanlar saklanan denemeden gelir.
Sunucu Arc Testnet'e **kendisi** bağlanır ve şunların **hepsini** arar:

1. zincir kimliği Arc Testnet,
2. makbuz var ve durumu **başarılı**,
3. **en az 1 onay** (`ARC_MIN_CONFIRMATIONS`),
4. kayıtlar **tam olarak** Arc Testnet USDC ERC-20 sözleşmesinden,
5. `Transfer(address,address,uint256)` **katı** çözümleme (üç konu, adres
   konularının üst 12 baytı sıfır, veri tam 32 bayt),
6. gönderen = kimliği doğrulanmış borçlu, alıcı = imzalı manifestteki alıcı,
7. eşleşen **tüm** borçlu→alıcı transferlerinin **BigInt toplamı**, beklenen
   mikro USDC'ye **birebir eşit**.

"En az bir eşleşen olay" **yetmez**: toplam beklenenden az da fazla da olamaz.
Borç yalnızca bu doğrulama geçerse `paid` olur; hesap ise **her borç bağımsız
olarak onaylandığında** kapanır.

Makbuz yoksa veya onay yetersizse: kontrollü **beklemede** durumu, rezervasyon
korunur, **sınırlı** yoklamaya izin verilir, ödendi denmez. Revert: kanıt
saklanır, hash ArcScan için korunur, borç ödenmemiş kalır. Sonuç
çözülemiyorsa: `unknown` / `review_required`, kilit korunur, **otomatik tekrar
yoktur**.

`unknown` bir deneme **son** durumdur: sonradan gelen bir makbuz doğrulaması
bile onu otomatik olarak `confirmed`e taşımaz ve `review_required` bir borcu
`paid` yapmaz. Bu bilerek katıdır — belirsiz bir denemenin hash'ine bağlanmış
herhangi bir makbuz, kilidi tek başına açabilirdi. Bu durumdan çıkış, insan
tarafından yürütülen açık bir mutabakat gerektirir (ArcScan + cüzdan geçmişi).

#### Onay gereksinimi ve sınırı

Bu Arc Testnet MVP'si **bir onayı** yeterli sayar: makbuz bir bloğa girmiştir.
**Bu, derin bir yeniden düzenleme (reorg) karşısında kesinlik değildir.** Test
USDC'sinin gerçek parasal değeri olmadığı için bu denge kabul edilmiştir;
gerçek değer taşıyan bir ağda bu sayı yükseltilmelidir.

#### İstemci sonucu bildirimi

`POST /api/shared-bills/<billId>/payment/outcome` **katı bir enum** kabul eder:
`rejected`, `insufficientFunds`, `preflightFailed`, `submitted`, `ambiguous`.
**`success` yoktur**: istemci bir ödemeyi başarılı ilan edemez. Elinde bir hash
varsa `submitted` bildirir ve mutabakatı sunucu yapar. Serbest bırakan üç
sonuç hash **taşıyamaz** ve yalnızca mevcut sınıflandırıcının yayın öncesi
olduğunu **kanıtladığı** hâllerde üretilir.

> **Kötü niyetli bir istemci "reddedildi" diye yalan söyleyebilir** ve
> uygulama düzeyindeki rezervasyonu açtırabilir. Bu **zincir üstü bir garanti
> değildir**; cüzdan her transfer için borçlunun **kendi onayını** istemeye
> devam eder, dolayısıyla bu yalan kimseye para harcatamaz — yalnızca ikinci
> bir denemeye izin verir.

#### Tam sayı gösterimi

Gönderim sınırındaki `ArcPaymentSnapshot.tryMinor` artık **`number` değil,
kanonik ondalık metin**tir. Gösterilen, tahmin edilen, rezerve edilen,
gönderilen ve mutabakatı yapılan tutarın hepsi **aynı tam sayıdan** türer;
hiçbir aşamada `parseFloat`, `Number(...)` veya kayan nokta para aritmetiği
kullanılmaz. Eski (borçlu başına ayrı bağlantılı) ödeme talebi akışı
davranışını korur: imzalı gövde zaten kanonik ondalık metin taşıdığı için
sınırda **daraltma yapılmadan** aktarılır.

**Manifest katmanının kendi sınırı korunmuştur:** `canonicalizeSharedBillDebts`
borç tutarlarını bilerek `Number.MAX_SAFE_INTEGER` ile sınırlar ve bu görevde
**gevşetilmemiştir**. Ödeme yolunun tamamının daraltma yapmadığı, satırı
doğrudan depoya yerleştiren ayrı regresyon testleriyle ölçülür.

### Bu sürümün SINIRLARI

- **Sunucu veritabanı bir akıllı sözleşme değildir.** Rezervasyon, aynı borcun
  **uygulama üzerinden** iki cihazdan/oturumdan ödenmesini engeller;
  kullanıcının kendi cüzdanından, **uygulamanın dışında** ikinci bir ERC-20
  transferi göndermesini **engelleyemez**.
- **Tarayıcı tarafındaki doğrulamalar zincir üstü güvenlik değildir.**
- Bir bağlantının varlığı gerçek dünyada bir borcun var olduğunu
  **kanıtlamaz**; cüzdan imzası bir kimlik/KYC kanıtı değildir.
- **Arc Testnet** içindir ve **mainnet'e hazır değildir**; test USDC'sinin
  **gerçek parasal değeri yoktur**.
- Kur servisinin **örnekler arası** kota koruması yoktur (bkz. yukarıdaki
  "Demo plan ve önbellek sınırları").

### Part 4'e ERTELENENLER

- Neon **sağlama (provisioning) yapılmadı**; `migrations/0001_shared_bills.sql`
  **hiç uygulanmadı**.
- `DATABASE_URL`, `SHARED_BILL_AUTH_SECRET` ve `APP_ORIGIN` **yerelde
  tanımlanmadı**; Vercel ortam değişkenleri **değiştirilmedi**.
- **Dağıtım yapılmadı**, PR açılmadı/birleştirilmedi.
- **Gerçek cüzdanla canlı bir işlem denenmedi**: tüm doğrulama enjekte edilmiş
  belirlenimci sahtelerle yapıldı.
- Oluşturucu akışı hâlâ **`SHARED_BILL_FLOW_ENABLED = false`** ile kapalıdır;
  çalışan bir ortak bağlantı **paylaşılmadı**.
- Örnekler arası oran sınırlama (Redis/KV veya Vercel firewall) hâlâ bir
  **dağıtım gereksinimidir** ve bu depoda karşılanmamıştır.

## Fiş analizi nasıl çalışıyor

- Analiz **OpenAI Responses API** ile yapılır: `openai.responses.parse(...)`.
- Yapılandırılmış çıktı için Zod şeması `openai/helpers/zod` paketindeki
  `zodTextFormat(...)` ile `text.format` olarak verilir.
- Görsel, doğru MIME type ile base64 **data URL** olarak `input_image` içinde gönderilir.
- İstek `store: false` ile yapılır; yanıt OpenAI tarafında saklanmaz.
- Çağrı yalnızca `POST /api/receipts/analyze` route handler'ında, Node.js runtime'da çalışır.
  **API anahtarı istemciye hiçbir biçimde gönderilmez**, `NEXT_PUBLIC_*` değişkeni yoktur.
- Yüklenen görsel yalnızca istek süresince bellekte tutulur; diske yazılmaz, veritabanı yoktur.
- Sunucu, istemcinin bildirdiği dosya türüne güvenmez: boyut, MIME type ve dosyanın
  gerçek imza baytları yeniden doğrulanır. Bildirilen tür boşsa dosya yalnızca
  imza baytları geçerli bir JPEG/PNG/WEBP gösteriyorsa kabul edilir; uzantıya
  asla bakılmaz. Data URL daima imzadan tespit edilen türle kurulur.

Tüm para değerleri **minor unit** (tam sayı) olarak taşınır: 1 TL = 100 kuruş.
Uygulama state'inde hiçbir yerde floating-point para tutulmaz.

### Analiz timeout'u

Sunucudaki OpenAI çağrısı **30 saniye** sonra kesilir (`timeout`), otomatik retry
kapalıdır (`maxRetries: 0`) — böylece demoda bekleme süresi öngörülebilir kalır.
Timeout, SDK'nın kendi `APIConnectionTimeoutError` sınıfıyla yakalanır ve
`ANALYSIS_TIMEOUT` koduyla **504** olarak döner. İstemci ayrıca `AbortController`
ile 35 saniyelik bir üst sınır uygular; istek takılırsa "Analiz zaman aşımına
uğradı" mesajı gösterilir, seçilen görsel korunur ve tekrar denenebilir.

## Vergi, servis ve indirim nasıl uygulanır

Türkiye'deki fişlerde KDV çoğunlukla **ürün satır fiyatlarının içindedir** ve
fişte yalnızca bilgilendirme amacıyla yazılır. Böyle bir KDV'yi ürün toplamının
üzerine tekrar eklemek yanlış genel toplam ve ileride çift borçlandırma üretir.

Bu yüzden vergi, servis ücreti ve indirimin her biri kendi *treatment* değerini
taşır:

| Değer | Anlamı |
| --- | --- |
| `included_in_items` | Tutar ürün fiyatlarının içinde; toplama **tekrar uygulanmaz** |
| `separate` | Vergi/servis ürünlerin üzerine eklenir, indirim düşülür |
| `unknown` | Fişten güvenle anlaşılamadı |

Model bu değeri fişte **görünen matematikten** belirler (ürün toplamları, ara
toplam ve genel toplam ilişkisinden), "KDV" satırının varlığından değil.
Belirleyemezse `unknown` döner.

Toplam kontrolü yalnızca `separate` işaretli kalemleri uygular. Sıfırdan farklı
bir kalem `unknown` ise yanlış bir uyuşmazlık iddiası üretilmez; sonuç
"belirsiz" olarak gösterilir. Kullanıcı her satırdaki seçimi arayüzden
değiştirebilir ve toplam kontrolü anında güncellenir; hiçbir değer otomatik
olarak değiştirilmez.

## Şu anda çalışan özellikler

- **Fiş yükleme ve analiz**: sürükle-bırak, dosya doğrulama (JPG/PNG/WEBP, en
  fazla 10 MB), OpenAI Responses API ile ürün çıkarımı, düzenlenebilir sonuç.
- **Vergi / servis / indirim** için "fiyatlara dahil mi, ayrı mı" seçimi ve
  buna göre doğru genel toplam kontrolü.
- **Ürünleri kişilere atama** ve **borç hesabı**: tam sayı minor unit ile,
  kayan nokta kullanmadan.
- **Arc Testnet USDC ödemesi** iki akışta:
  1. **Borçlu başına ayrı bağlantı** (imzalı ödeme talebi, EIP-712 şema 2).
  2. **Tek bağlantılı ortak hesap**: alıcı tek bir manifest imzalar, herkes
     aynı bağlantıyı alır, her borçlu cüzdanıyla kimliğini doğrulayıp yalnızca
     kendi borcunu görür ve öder.
- **Otomatik USDC/TRY kuru**: CoinGecko'dan alınan, sunucu tarafından HMAC ile
  kimliklendirilen taze teklif; elle kur girişi yoktur.
- **Sunucu tarafı ödeme yaşam döngüsü**: yetkili teklif, atomik rezervasyon,
  zincir üstü makbuz doğrulaması ve ancak ondan sonra "ödendi".
- **Kalıcı depo**: Neon Postgres; şema gözden geçirilmiş bir SQL geçişiyle
  **elle** uygulanır.

## Sınırlar ve bilinen eksikler

- **Yalnızca Arc Testnet.** Mainnet'e hazır **değildir** ve mainnet/Ethereum
  Sepolia desteklenmez. Test USDC'sinin **gerçek parasal değeri yoktur**.
- **Sunucu veritabanı bir akıllı sözleşme değildir**: rezervasyon yalnızca
  uygulama üzerinden yinelenen denemeyi engeller, kullanıcının uygulama
  dışından ikinci bir transfer göndermesini engelleyemez.
- **Kullanıcı hesabı / oturum sistemi yoktur**: kimlik doğrulama yalnızca
  cüzdan sahipliği kanıtıdır, KYC değildir.
- **Kur servisinde örnekler arası kota koruması yoktur**; oran sınırlama bir
  dağıtım gereksinimidir (Vercel Firewall ile karşılanır).
- Bağlantıyı ele geçiren biri hesabı açabilir; borç yalnızca doğru cüzdanla
  görülebilir ama bağlantının kendisi gizli sayılmalıdır.
