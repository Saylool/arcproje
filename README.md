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
