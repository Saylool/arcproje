# Hesabı Böl

Ortak hesabı adil biçimde bölmek için küçük bir hackathon MVP'si. Hedeflenen akış:
fişin fotoğrafını yükle → fişteki ürünleri kişilere dağıt → herkesin borcunu hesapla →
Arc Testnet üzerinden USDC ile öde.

> Bu depo şu anda akışın yalnızca **ilk ekranını** içeriyor.

## Kurulum ve çalıştırma

Node.js 22 veya üzeri gerekir (Arc App Kit ileride bunu şart koşacak).

```bash
npm install
```

```bash
npm run dev
```

Uygulama `http://localhost:3000` adresinde açılır.

Diğer komutlar:

```bash
npm run build
```

```bash
npm run lint
```

## Bu adımda tamamlananlar

- Next.js (App Router) + TypeScript strict mode + Tailwind CSS + ESLint temeli, `src/` dizini ile
- "Fişini yükle" ekranı: beyaz ağırlıklı, açık mor vurgulu, mobil ve masaüstünde responsive
- Üç aşamalı ilerleme göstergesi (Fiş Yükle / Ürünleri Ata / Ödeme) — yalnızca ilk aşama aktif
- Erişilebilir fiş yükleme alanı:
  - sürükle-bırak ve dosya seçme
  - `image/jpeg`, `image/png`, `image/webp` desteği, en fazla 10 MB
  - hatalı tür ve boyut için Türkçe hata mesajları
  - seçilen görselin önizlemesi, dosya adı ve okunabilir boyutu
  - görseli kaldırma ve değiştirme
  - klavye ile kullanım, `label`/`aria` bağlantıları ve canlı bölge duyuruları
  - önizleme için üretilen object URL'lerin serbest bırakılması

## Henüz yapılmadı

- **OCR / AI fiş analizi yok.** Fiş seçildikten sonra hiçbir okuma yapılmaz; ürün ve fiyat verisi üretilmez.
- **Arc Testnet ve USDC ödeme entegrasyonu yok.**
- Ürünleri kişilere atama ve borç hesaplama adımları yok.
- Backend, veritabanı ve kimlik doğrulama yok.
