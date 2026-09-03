/**
 * YÜKLEME BOYUT SINIRLARI — tek doğruluk kaynağı.
 *
 * Bu sayılar daha önce üç ayrı yerde tekrarlanıyordu (istemci kontrolü,
 * sunucu kontrolü ve kullanıcıya gösterilen cümle) ve üçü de PLATFORMUN
 * gerçek sınırından habersizdi. Artık hepsi buradan türer.
 *
 * ÖLÇÜLDÜ (üretim, `POST /api/receipts/analyze`):
 *
 *   4,4 MB gövde → 401  (istek koda ULAŞIYOR, kimlik kapısına takılıyor)
 *   4,6 MB gövde → 413  `FUNCTION_PAYLOAD_TOO_LARGE`
 *
 * 413'ü Vercel üretir; uygulama kodu HİÇ çalışmaz ve yanıt gövdesi JSON
 * değil DÜZ METİNDİR. Yani sunucu tarafındaki hiçbir doğrulama ya da hata
 * cümlesi bu duruma yetişemez — çözüm tarayıcıda, göndermeden ÖNCE olmak
 * zorundadır.
 */

/**
 * Tarayıcıdan çıkmasına izin verilen en büyük dosya.
 *
 * Ölçülen sınır ~4,5 MB. multipart zarfı (sınır dizgesi, başlıklar, dosya
 * adı) da gövdeye dahil olduğu için pay bırakılır.
 */
export const MAX_TRANSMIT_BYTES = 4 * 1024 * 1024;

/**
 * Kullanıcıdan kabul edilen en büyük KAYNAK dosya.
 *
 * Gönderilen boyuttan büyüktür ve olması gereken budur: bunun üstü
 * küçültülerek gönderilir. Sınır, çözmeye razı olduğumuz görselin üst
 * sınırıdır; belleği tüketen bir dosyayı açmaya çalışmayız.
 *
 * Değer BİLEREK 10 MB'da bırakıldı: arayüzdeki "en fazla 10 MB" cümlesi
 * zaten buydu ve artık DOĞRU. Bu sınırın altındaki her dosya gerçekten
 * yüklenebilir; önceden 4,5 MB üstü sessizce düşüyordu.
 */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

/**
 * Küçültülmüş görselin uzun kenarı.
 *
 * Fiş okumak için 8 megapiksel gerekmez; metnin çözünürlüğü yeter. Bu değer
 * bilerek TEMKİNLİDİR: küçültmenin yapay zekânın okumasını bozması, çözdüğü
 * sorundan daha kötü olurdu.
 */
export const TARGET_LONG_EDGE = 1600;

/** JPEG kalitesi. Belge okumada 0,8 civarı yerleşik bir değerdir. */
export const TARGET_QUALITY = 0.82;

/**
 * Sıkıştırma ilk denemede yetmezse uygulanan sırayla daha sert ayarlar.
 *
 * Uzun ve dar fişler tek geçişte sınırın altına inmeyebilir.
 */
export const FALLBACK_STEPS: readonly {
  longEdge: number;
  quality: number;
}[] = [
  { longEdge: 1280, quality: 0.75 },
  { longEdge: 1024, quality: 0.7 },
];

/**
 * Bu dosya olduğu gibi gönderilebilir mi?
 *
 * Sınırın ALTINDAKİ dosyaya DOKUNULMAZ. Küçültmenin kalite riski, yalnızca
 * bugün zaten gönderilemeyen dosyalarla sınırlı kalır.
 */
export function fitsWithoutCompression(sizeBytes: number): boolean {
  return sizeBytes <= MAX_TRANSMIT_BYTES;
}

/** Kaynak dosya, açmayı bile denemeyeceğimiz kadar büyük mü? */
export function exceedsSourceLimit(sizeBytes: number): boolean {
  return sizeBytes > MAX_SOURCE_BYTES;
}

/**
 * En-boy oranını KORUYARAK hedef uzun kenara indirir.
 *
 * Zaten küçük olan görsel BÜYÜTÜLMEZ: büyütmek bayt kazandırmaz, yalnızca
 * bulanıklaştırır.
 */
export function scaleToLongEdge(
  width: number,
  height: number,
  longEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= longEdge || longest === 0) {
    return { width, height };
  }
  const ratio = longEdge / longest;
  return {
    // En az 1 piksel: yuvarlama sıfır kenar üretmemeli.
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}
