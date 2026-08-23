/**
 * Yeniden girişe karşı eşzamanlı kilit.
 *
 * React durumu asenkron güncellenir: iki hızlı tık, ikisi de aynı "hazır"
 * durumu görürken aynı boru hattını iki kez başlatabilir. Bu kilit ilk
 * `await`ten ÖNCE, eşzamanlı olarak alınır; ikinci çağrı hemen düşer.
 *
 * Deneysel değil, kasıtlı olarak minimaldir: tek bir boolean ve üç işlem.
 */
export type SingleFlight = {
  /** Kilidi alır. Zaten alınmışsa false döner ve çağıran hemen dönmelidir. */
  tryEnter: () => boolean;
  /** Yeniden denemeye izin verilen yollarda kilidi bırakır. */
  release: () => void;
  readonly active: boolean;
};

export function createSingleFlight(): SingleFlight {
  let inFlight = false;
  return {
    tryEnter: () => {
      if (inFlight) {
        return false;
      }
      inFlight = true;
      return true;
    },
    release: () => {
      inFlight = false;
    },
    get active() {
      return inFlight;
    },
  };
}
