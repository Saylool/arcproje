import { ACTIVE_NETWORK_PROFILE } from "./profile";

/**
 * TEK-LİNK (borçlu başına ayrı bağlantı) AKIŞININ KAPISI.
 *
 * Bu akış bilerek SUNUCUSUZDUR: imzalı talep URL'de taşınır, ödeyici hiçbir
 * API çağırmaz. Bedeli şudur — tekrar oynatma engeli yalnızca yereldir
 * (`submission-log.ts`: "BU YETKİLİ BİR KORUMA DEĞİLDİR"); gizli sekmede ya
 * da başka bir cihazda aynı talep iki kez ödenebilir. Test USDC'sinin değeri
 * olmadığı için bu sınır bugün açıkça söylenir ve kabul edilir.
 *
 * Gerçek parada kabul edilemez. Bu yüzden akış yalnızca TEST AĞINDA açıktır;
 * ana ağ profilinde ödeme paylaşılan hesap üzerinden yapılır — orada sunucu
 * kaydı, atomik rezervasyon ve `paid` = doğrulanmış tx hash zaten var.
 *
 * Bu karar 2026-09-22'de verildi: sunucuya "requestId tüket" ucu eklemek
 * yerine akışı kapatmak seçildi — daha küçük iş, yeni saldırı yüzeyi yok ve
 * akışın "sunucu hiçbir şey görmez" vaadi bozulmaz.
 *
 * Profil parametre olarak alınır ki testler henüz var olmayan bir ana ağ
 * profiliyle kapının KAPANDIĞINI kanıtlayabilsin.
 */
export function standaloneRequestFlowEnabled(
  profile: { readonly isTestnet: boolean } = ACTIVE_NETWORK_PROFILE,
): boolean {
  return profile.isTestnet === true;
}

/**
 * Tip bilerek `boolean`dır: sabit `true`ya daraltılırsa kapalı kod yolu tür
 * denetiminden düşer ve derlenmeyi bırakırdı (aynı gerekçe:
 * `shared-bill-feature.ts`).
 */
export const STANDALONE_REQUEST_FLOW_ENABLED: boolean =
  standaloneRequestFlowEnabled();
