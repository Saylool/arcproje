import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  THEME_ATTRIBUTE,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  isTheme,
  oppositeTheme,
  readAppliedTheme,
  readStoredTheme,
  readSystemTheme,
  resolveTheme,
  writeStoredTheme,
  type Theme,
} from "./theme";

/**
 * TEMA MANTIGI.
 *
 * Hicbir test gercek bir tarayiciya, `window`a ya da gercek `localStorage`a
 * ihtiyac duymaz: butun bagimliliklar enjekte edilir. Boylece oncelik sirasi
 * ve hata yollari belirlenimci bicimde olculur.
 */

/** Belirlenimci sahte depolama. */
function fakeStorage(initial?: string | null) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    read: () => value,
  };
}

/** Her erisimde patlayan depolama (gizli sekme / devre disi cerez). */
const throwingStorage = {
  getItem: () => {
    throw new Error("storage unavailable");
  },
  setItem: () => {
    throw new Error("storage unavailable");
  },
};

const matcherFor = (dark: boolean) => () => ({ matches: dark });

describe("tema dogrulamasi", () => {
  it("yalnizca 'light' ve 'dark' gecerlidir", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    for (const bad of ["Dark", "LIGHT", "", "1", null, undefined, 0, {}, []]) {
      expect(isTheme(bad), String(bad)).toBe(false);
    }
  });

  it("karsit temayi dondurur", () => {
    expect(oppositeTheme("light")).toBe("dark");
    expect(oppositeTheme("dark")).toBe("light");
  });
});

describe("ONCELIK: kayitli tercih sistemi YENER", () => {
  it("kayitli AYDINLIK, sistem KARANLIK olsa bile kazanir", () => {
    expect(resolveTheme({ stored: "light", system: "dark" })).toBe("light");
  });

  it("kayitli KARANLIK, sistem AYDINLIK olsa bile kazanir", () => {
    expect(resolveTheme({ stored: "dark", system: "light" })).toBe("dark");
  });

  it("kayitli tercih YOKKEN sistem KARANLIK kullanilir", () => {
    expect(resolveTheme({ stored: null, system: "dark" })).toBe("dark");
  });

  it("kayitli tercih YOKKEN sistem AYDINLIK kullanilir", () => {
    expect(resolveTheme({ stored: null, system: "light" })).toBe("light");
  });

  it("ikisi de yoksa guvenli varsayilana duser", () => {
    expect(resolveTheme({})).toBe(DEFAULT_THEME);
    expect(DEFAULT_THEME).toBe("light");
  });
});

describe("depolama okuma FAIL-SAFE", () => {
  it("gecerli kayitli degeri okur", () => {
    expect(readStoredTheme(fakeStorage("dark"))).toBe("dark");
    expect(readStoredTheme(fakeStorage("light"))).toBe("light");
  });

  it("BOZUK kayitli deger 'kayit yok' sayilir", () => {
    for (const bad of ["Dark", "system", "", "true", "0"]) {
      expect(readStoredTheme(fakeStorage(bad)), bad).toBeNull();
    }
  });

  it("depolama ERISILEMEZSE patlamaz, null doner", () => {
    expect(readStoredTheme(throwingStorage)).toBeNull();
  });

  it("bozuk deger + sistem karanlik -> SISTEM tercihi kazanir", () => {
    const stored = readStoredTheme(fakeStorage("Dark"));
    expect(resolveTheme({ stored, system: readSystemTheme(matcherFor(true)) })).toBe(
      "dark",
    );
  });

  it("erisilemez depolama + sistem karanlik -> SISTEM tercihi kazanir", () => {
    const stored = readStoredTheme(throwingStorage);
    expect(resolveTheme({ stored, system: readSystemTheme(matcherFor(true)) })).toBe(
      "dark",
    );
  });
});

describe("depolama yazma", () => {
  it("tercihi kaydeder", () => {
    const store = fakeStorage(null);
    expect(writeStoredTheme("dark", store)).toBe(true);
    expect(store.read()).toBe("dark");
    expect(readStoredTheme(store)).toBe("dark");
  });

  it("yazma basarisiz olursa PATLAMAZ, false doner", () => {
    expect(writeStoredTheme("dark", throwingStorage)).toBe(false);
  });
});

describe("sistem tercihi", () => {
  it("matchMedia karanlik derse karanlik", () => {
    expect(readSystemTheme(matcherFor(true))).toBe("dark");
  });

  it("matchMedia aydinlik derse aydinlik", () => {
    expect(readSystemTheme(matcherFor(false))).toBe("light");
  });

  it("matchMedia patlarsa guvenli varsayilana duser", () => {
    expect(
      readSystemTheme(() => {
        throw new Error("no matchMedia");
      }),
    ).toBe(DEFAULT_THEME);
  });
});

describe("belgeye uygulama", () => {
  /** `<html>` benzeri asgari sahte oge. */
  function fakeRoot() {
    const attrs = new Map<string, string>();
    return {
      style: { colorScheme: "" },
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      getAttribute: (k: string) => attrs.get(k) ?? null,
    } as unknown as HTMLElement;
  }

  it("data-theme ve color-scheme birlikte yazilir", () => {
    const root = fakeRoot();
    applyTheme("dark", root);
    expect(root.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");

    applyTheme("light", root);
    expect(root.getAttribute(THEME_ATTRIBUTE)).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("uygulanmis temayi geri okur", () => {
    const root = fakeRoot();
    applyTheme("dark", root);
    expect(readAppliedTheme(root)).toBe("dark");
  });

  it("oznitelik bozuksa null doner", () => {
    const root = fakeRoot();
    root.setAttribute(THEME_ATTRIBUTE, "bozuk");
    expect(readAppliedTheme(root)).toBeNull();
  });
});

/*
 * ---------------------------------------------------------------------------
 * ERKEN BASLATMA BETIGI <-> REACT DURUMU ESLESMESI
 * ---------------------------------------------------------------------------
 */

describe("erken betik ile React durumu AYNI temayi cozer", () => {
  /**
   * Betigi izole bir sahte pencerede calistirir.
   *
   * Betik gercekte ne yapiyorsa burada da onu yapar; boylece "betik bir sey,
   * React baska bir sey" ayrismasi (parlama veya yanlis etiket) yakalanir.
   */
  function runInitScript(input: {
    stored?: string | null;
    systemDark: boolean;
    storageThrows?: boolean;
    matchMediaThrows?: boolean;
  }): { theme: string | null; colorScheme: string } {
    const attrs = new Map<string, string>();
    const documentElement = {
      style: { colorScheme: "" },
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
    };
    const sandbox = {
      document: { documentElement },
      localStorage: {
        getItem: (key: string) => {
          if (input.storageThrows === true) throw new Error("no storage");
          return key === THEME_STORAGE_KEY ? (input.stored ?? null) : null;
        },
      },
      window: {
        matchMedia: () => {
          if (input.matchMediaThrows === true) throw new Error("no matchMedia");
          return { matches: input.systemDark };
        },
      },
    };
    // Betik sabittir; burada yalnizca izole bir kapsamda calistirilir.
    const run = new Function(
      "document",
      "localStorage",
      "window",
      THEME_INIT_SCRIPT,
    );
    run(sandbox.document, sandbox.localStorage, sandbox.window);
    return {
      theme: attrs.get(THEME_ATTRIBUTE) ?? null,
      colorScheme: documentElement.style.colorScheme,
    };
  }

  /** React tarafinin ayni girdilerle cozdugu tema. */
  function reactResolve(input: {
    stored?: string | null;
    systemDark: boolean;
    storageThrows?: boolean;
    matchMediaThrows?: boolean;
  }): Theme {
    const storage =
      input.storageThrows === true
        ? throwingStorage
        : fakeStorage(input.stored ?? null);
    const matcher =
      input.matchMediaThrows === true
        ? () => {
            throw new Error("no matchMedia");
          }
        : matcherFor(input.systemDark);
    return resolveTheme({
      stored: readStoredTheme(storage),
      system: readSystemTheme(matcher),
    });
  }

  const cases = [
    { ad: "kayitli karanlik + sistem aydinlik", stored: "dark", systemDark: false },
    { ad: "kayitli aydinlik + sistem karanlik", stored: "light", systemDark: true },
    { ad: "kayit yok + sistem karanlik", stored: null, systemDark: true },
    { ad: "kayit yok + sistem aydinlik", stored: null, systemDark: false },
    { ad: "BOZUK kayit + sistem karanlik", stored: "Dark", systemDark: true },
    { ad: "BOZUK kayit + sistem aydinlik", stored: "42", systemDark: false },
    {
      ad: "depolama patliyor + sistem karanlik",
      stored: null,
      systemDark: true,
      storageThrows: true,
    },
    {
      ad: "matchMedia patliyor",
      stored: null,
      systemDark: true,
      matchMediaThrows: true,
    },
  ] as const;

  for (const c of cases) {
    it(`${c.ad}: betik ve React AYNI sonucu verir`, () => {
      const fromScript = runInitScript(c);
      const fromReact = reactResolve(c);
      expect(fromScript.theme, "betik temasi").toBe(fromReact);
      // `color-scheme` de birlikte yazilmali (yerel denetimler icin).
      expect(fromScript.colorScheme).toBe(fromReact);
    });
  }

  it("betik SABITTIR: enterpolasyon veya sunucu verisi icermez", () => {
    // Sablon ifadesi, birlestirme ya da yer tutucu olmamali.
    expect(THEME_INIT_SCRIPT).not.toContain("${");
    expect(THEME_INIT_SCRIPT).not.toContain("<");
    expect(THEME_INIT_SCRIPT).not.toContain(">");
    // Kullandigi anahtar ve oznitelik, modulun tanimlariyla ayni olmali.
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_INIT_SCRIPT).toContain(THEME_ATTRIBUTE);
  });
});

/*
 * ---------------------------------------------------------------------------
 * ANAHTAR DAVRANISI
 * ---------------------------------------------------------------------------
 */

describe("anahtar: degistirme ve kaliciligi", () => {
  it("aydinliktan karanliga gecer, kaydeder ve belgeye uygular", () => {
    const store = fakeStorage(null);
    const attrs = new Map<string, string>();
    const root = {
      style: { colorScheme: "" },
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      getAttribute: (k: string) => attrs.get(k) ?? null,
    } as unknown as HTMLElement;

    // Baslangic: kayit yok, sistem aydinlik.
    const start = resolveTheme({
      stored: readStoredTheme(store),
      system: readSystemTheme(matcherFor(false)),
    });
    expect(start).toBe("light");

    // Kullanici anahtara basar.
    const next = oppositeTheme(start);
    applyTheme(next, root);
    writeStoredTheme(next, store);

    expect(next).toBe("dark");
    expect(root.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
    expect(store.read()).toBe("dark");

    // YENIDEN YUKLEME: kayitli tercih, karsit sistem tercihini yener.
    const afterReload = resolveTheme({
      stored: readStoredTheme(store),
      system: readSystemTheme(matcherFor(false)),
    });
    expect(afterReload).toBe("dark");
  });

  it("iki kez degistirmek baslangica doner ve kalici olur", () => {
    const store = fakeStorage(null);
    let current: Theme = "light";
    for (let i = 0; i < 2; i += 1) {
      current = oppositeTheme(current);
      writeStoredTheme(current, store);
    }
    expect(current).toBe("light");
    expect(readStoredTheme(store)).toBe("light");
  });

  it("depolama yazilamasa bile tema yine de cozulur", () => {
    const next = oppositeTheme("light");
    expect(writeStoredTheme(next, throwingStorage)).toBe(false);
    // Kayit yok -> sonraki yuklemede sistem tercihine dusulur, cokme olmaz.
    expect(
      resolveTheme({
        stored: readStoredTheme(throwingStorage),
        system: readSystemTheme(matcherFor(true)),
      }),
    ).toBe("dark");
  });
});
