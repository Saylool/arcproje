/**
 * PAYLASILAN HESAP AKISININ KAPISI (Part 1).
 *
 * Part 1 yalnizca TEMELI kurar: imzali manifest, kalici depo, dogrulama,
 * olusturma API'si ve olusturucu arayuzu. Borclu tarafi (`/pay/<billId>`
 * cozumlemesi, odeme rezervasyonu ve islem kesinlestirme) Part 2'dedir.
 *
 * Bu bayrak `false` oldugu surece uretimde ESKI, borclu basina ayri bagalanti
 * ureten akis calismaya devam eder; yeni bilesen derlenir ve test edilir ama
 * kullaniciya GOSTERILMEZ. Boylece Part 2 tamamlanana kadar kimse calisan bir
 * borclu sayfasi olmayan bir bagalanti paylasamaz.
 *
 * Tip bilerek `boolean`dir: sabit `false` olarak daraltilirsa bagimli kod
 * yolu tur denetiminden duser ve derlenmeyi birakirdi.
 */
export const SHARED_BILL_FLOW_ENABLED: boolean = false;
