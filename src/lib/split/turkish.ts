const BACK_VOWELS = "aıouâû";
const FRONT_VOWELS = "eiöüî";
const ALL_VOWELS = BACK_VOWELS + FRONT_VOWELS;

/**
 * Bir özel ismi yönelme hâline çevirir: "Sen" -> "Sen'e", "Ayşe" -> "Ayşe'ye",
 * "Burak" -> "Burak'a".
 *
 * Kural, Türkçe ünlü uyumudur: son ünlü kalınsa "a", inceyse "e" eki gelir.
 * İsim ünlüyle bitiyorsa araya "y" kaynaştırma harfi girer. Özel isimlerde ek
 * kesme işaretiyle ayrıldığı için ünsüz yumuşaması uygulanmaz ("Mehmet'e").
 */
export function toDativeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") {
    return trimmed;
  }

  const lower = trimmed.toLocaleLowerCase("tr");

  let lastVowel = "";
  for (const character of lower) {
    if (ALL_VOWELS.includes(character)) {
      lastVowel = character;
    }
  }

  // Ünlü bulunamazsa ince sesli varsayılır. ("".includes tuzağı: boş ünlü
  // her zaman eşleşeceği için önce ünlü bulunup bulunmadığı kontrol edilir.)
  const suffixVowel =
    lastVowel !== "" && BACK_VOWELS.includes(lastVowel) ? "a" : "e";
  const endsWithVowel = ALL_VOWELS.includes(lower[lower.length - 1] ?? "");
  const buffer = endsWithVowel ? "y" : "";

  return `${trimmed}'${buffer}${suffixVowel}`;
}
