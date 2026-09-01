import type { TranslationKey } from "../i18n/dictionary";
import type { WalletErrorCode } from "./wallet";

/**
 * AĞ DEĞİŞTİRME SONUCUNUN TEK YORUMU.
 *
 * Bu eşleme dört bileşende ayrı ayrı yazıldığı için birbirinden ayrılmıştı:
 * ikisi "cüzdanından Arc Testnet'i seç" diyor, ikisi yalnızca "geçilemedi"
 * diyordu. Üstelik ilki telefonda YANLIŞ tavsiye: ağ listede yoktur ki
 * seçilsin, eklenmesi gerekir. Eşleme tek yerde tutulur ki bir daha
 * ayrışmasınlar.
 */
export function switchFailureMessage(code: WalletErrorCode): TranslationKey {
  if (code === "rejected") {
    return "wallet.switchRejected";
  }
  if (code === "switchIgnored") {
    return "wallet.switchIgnored";
  }
  if (code === "unsupportedChain") {
    return "wallet.switchUnsupported";
  }
  return "wallet.switchFailed";
}

/**
 * Ağ cüzdanda YOKSA ya da cüzdan isteği sessizce yuttuysa yeniden denemek işe
 * yaramaz: kullanıcının ağı elle eklemesi gerekir, parametreler gösterilir.
 *
 * Reddedilen bir istek bunun dışındadır — orada yeniden denemek anlamlıdır.
 */
export function needsManualNetwork(code: WalletErrorCode): boolean {
  return code === "unsupportedChain" || code === "switchIgnored";
}
