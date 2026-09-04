import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * KAPININ KENDİSİ KORUNUR.
 *
 * CI'dan bir adımın sessizce düşmesi, kapıyı zayıflatan ama hiçbir testi
 * kırmayan bir değişikliktir: her şey yeşil görünür, oysa artık daha azı
 * kontrol ediliyordur.
 *
 * Buradaki testler o boşluğu kapatır. `package.json`'daki komutlarla CI'da
 * çalıştırılanları KARŞILAŞTIRIR; biri eklenip diğerine yazılmazsa düşer.
 */

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

/** Kapıyı oluşturan komutlar. `dev` ve `start` sunucu başlatır, kapı değil. */
const GATE_SCRIPTS = ["lint", "typecheck", "test", "build"] as const;

describe("CI kapisi eksiksizdir", () => {
  it("kapinin HER adimi calistirilir", () => {
    for (const script of GATE_SCRIPTS) {
      const command = script === "test" ? "npm test" : `npm run ${script}`;
      expect(workflow, `${script} CI'da calistirilmiyor`).toContain(command);
    }
  });

  it("adimlarin hepsi package.json'da GERCEKTEN vardir", () => {
    /* CI olmayan bir komutu cagirirsa is her calismada duser. */
    for (const script of GATE_SCRIPTS) {
      expect(packageJson.scripts[script], `${script} betigi yok`).toBeDefined();
    }
  });

  it("bagimliliklar KILITTEN kurulur", () => {
    /*
     * `npm install` kilit dosyasini gormezden gelip surumleri kaydirabilir;
     * o zaman CI, yerelde calisandan BASKA bir agaci test eder.
     */
    expect(workflow).toContain("npm ci");
    expect(workflow).not.toContain("npm install");
  });

  it("bosluk denetimi PR'in DEGISTIRDIGI satirlara bakar", () => {
    expect(workflow).toContain("git diff --check");
    /* Taban olmadan karsilastirma anlamsiz olurdu. */
    expect(workflow).toContain("github.base_ref");
  });
});

describe("CI dogru anlarda calisir", () => {
  it("PR'da ve main'e push'ta tetiklenir", () => {
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("branches: [main]");
  });

  it("checkout GECMISI getirir", () => {
    /*
     * Sig bir checkout'ta hedef dal yoktur ve `git diff --check` taban
     * bulamaz; adim sessizce anlamsizlasirdi.
     */
    expect(workflow).toContain("fetch-depth: 0");
  });

  it("Node surumu SABITLENMISTIR", () => {
    /*
     * `npm ci`, kilidi YAZAN npm ile uyumlu bir npm ister. Olculdu: kilit
     * npm 11 ile yazilmis ve npm 10 onu reddediyor. Surumu serbest birakmak,
     * runner'in varsayilani degistiginde CI'i sessizce kirar.
     */
    expect(workflow).toMatch(/node-version:\s*\d+\.x/);
    expect(workflow).not.toContain("node-version: latest");
  });

  it("is en az yetkiyle calisir", () => {
    expect(workflow).toContain("contents: read");
  });

  it("sonsuza kadar asili kalmaz", () => {
    /* Zaman asimi olmayan bir is, zorunlu kontrol olarak PR'i kilitler. */
    expect(workflow).toMatch(/timeout-minutes:\s*\d+/);
  });
});
