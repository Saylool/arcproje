/**
 * PAYLASILAN HESAP AKISININ KAPISI.
 *
 * Bayrak ACIK: fisi odeyen kisi artik TEK bir manifest imzalayip TEK bir
 * baglanti paylasabilir. Zincir tamamdir — imzali manifest ve kalici depo
 * (Part 1), borclunun cuzdanla kimlik dogrulamasi ve yalnizca kendi borcunu
 * gormesi (Part 2), sunucu tarafli odeme yasam dongusu: taze kur teklifi,
 * atomik rezervasyon, mevcut gonderim siniri ve zincir ustu makbuz
 * dogrulamasi (Part 3).
 *
 * ESKI AKIS KALDIRILMADI. Borclu basina ayri baglanti ureten imzali odeme
 * talebi akisi (`PaymentRequestCreator`) derlenmeye, test edilmeye ve
 * calismaya devam eder; yalnizca olusturma ekraninda artik ortak hesap
 * olusturucusu gosterilir. Daha once uretilmis ayri baglantilar gecerliligini
 * korur.
 *
 * CALISMA GEREKSINIMI: ortak akis kalici bir depo ister. Sunucuda
 * `DATABASE_URL`, `SHARED_BILL_AUTH_SECRET` ve `APP_ORIGIN` tanimli degilse
 * ilgili rotalar kontrollu bir 503 doner; bellek ici bir yedege ASLA
 * dusulmez.
 *
 * Tip bilerek `boolean`dir: sabit bir degere daraltilirsa diger kod yolu tur
 * denetiminden duser ve derlenmeyi birakirdi.
 */
export const SHARED_BILL_FLOW_ENABLED: boolean = true;
