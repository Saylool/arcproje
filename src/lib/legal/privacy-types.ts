/**
 * GİZLİLİK POLİTİKASININ YAPISI.
 *
 * NEDEN SÖZLÜKTE DEĞİL: `tr.ts` arayüz metinlerinin kaynağıdır — düğmeler,
 * etiketler, hata cümleleri. Hukuki metin farklı bir şeydir: bölümlü,
 * tablolu, sürümlenen ve bir tarihe bağlı bir BELGEDİR. Sözlüğe konsaydı hem
 * onu şişirir hem de yapısını (bölüm sırası, tablo biçimi) kaybederdi.
 *
 * Buradaki tipler iki dilin AYNI belgeyi anlatmasını zorunlu kılar; eşliği
 * `privacy.test.ts` ölçer.
 */

export type PolicyBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: readonly string[] }
  | { kind: "table"; head: readonly string[]; rows: readonly (readonly string[])[] }
  /** Vurgulanan uyarı. Göz ardı edilmemesi gereken sınırlar için. */
  | { kind: "warning"; text: string };

export type PolicySection = {
  /** Dilden BAĞIMSIZ kimlik: bağlantı hedefi ve eşlik ölçümü buna bakar. */
  id: string;
  heading: string;
  blocks: readonly PolicyBlock[];
};

export type PrivacyPolicy = {
  title: string;
  /** Yürürlük tarihi, ISO 8601 (yalnızca gün). */
  effectiveDate: string;
  intro: string;
  sections: readonly PolicySection[];
};
