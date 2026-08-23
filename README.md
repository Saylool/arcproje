# Hesabı Böl

Ortak hesabı adil biçimde bölmek için küçük bir hackathon MVP'si. Hedeflenen akış:
fişin fotoğrafını yükle → fişteki ürünleri kişilere dağıt → herkesin borcunu hesapla →
Arc Testnet üzerinden USDC ile öde.

> Bu depo şu anda akışın **ilk iki parçasını** içeriyor: fiş yükleme ve fiş analizi
> (ürünlerin okunup düzenlenebilir biçimde gösterilmesi).

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

Bu üç değişkenin hiçbiri `NEXT_PUBLIC_` önekiyle tanımlanmaz ve hiçbiri istemci
paketine girmez.

Anahtar tanımlı olmasa bile uygulama açılır ve fiş yükleme ekranı çalışır; yalnızca
analiz isteği kontrollü bir "servis yapılandırılmamış" hatası döner.

```bash
npm run dev
```

Uygulama `http://localhost:3000` adresinde açılır.

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

Üçü de `NEXT_PUBLIC_` olmadan, yalnızca sunucu tarafı değişken olarak eklenir.

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

## Bu adımda tamamlananlar

- "Fişini yükle" ekranı: sürükle-bırak, dosya doğrulama (JPG/PNG/WEBP, en fazla 10 MB),
  önizleme, değiştirme ve kaldırma
- "Fişi analiz et" akışı: yükleme durumu, tekrar deneme, Türkçe hata mesajları
- Analiz sonucunun düzenlenebilir gösterimi: ürün adı/tutarı değiştirme, ürün ekleme
  ve silme, vergi / servis / indirim / genel toplam düzenleme
- `320,50` ve `320.50` gibi girdilerin güvenli biçimde minor unit'e çevrilmesi;
  geçersiz girdilerde sessiz yuvarlama yerine açık doğrulama hatası
- Vergi / servis / indirim için "ürün fiyatlarına dahil mi, ayrı mı" seçimi ve
  buna göre doğru genel toplam kontrolü (KDV'nin iki kez eklenmesini önler)
- Ürün toplamı ile genel toplam uyuşmadığında değerleri değiştirmeden uyarı gösterme
- Zod tabanlı ortak veri sözleşmesi ve API anahtarı gerektirmeyen birim testleri

## Henüz yapılmadı

- **Ürünleri kişilere atama** ekranı yok (ilerleme göstergesinde 2. adım).
- **Borç hesaplama** yok.
- **Arc Testnet ve USDC ödeme entegrasyonu** yok (3. adım).
- Backend veritabanı, kullanıcı hesabı ve kimlik doğrulama yok.
