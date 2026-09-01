import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";
import { GET } from "@/app/.well-known/assetlinks.json/route";
import {
  HANDLE_ALL_URLS,
  assetLinksFromEnv,
  buildAssetLinks,
  isValidPackageName,
  parseFingerprints,
} from "./assetlinks";

/**
 * TWA DOĞRULAMASININ SÖZLEŞMESİ.
 *
 * Bozuk bir `assetlinks.json` hata vermez: Chrome sessizce doğrulamayı düşürür
 * ve uygulama adres çubuğuyla açılır. Bu yüzden biçim burada katı biçimde
 * ölçülür ve yarım yapılandırma servis EDİLMEZ.
 */

const A = "A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90";
const B = "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00";

describe("parmak izi biçimi", () => {
  it("geçerli SHA-256 parmak izi kabul edilir", () => {
    expect(parseFingerprints(A)).toEqual([A]);
  });

  it("küçük harfli girdi BÜYÜK harfe çevrilir", () => {
    // Elle kopyalarken harf durumu kolayca kayar; bu tek başına doğrulamayı
    // düşürmemeli.
    expect(parseFingerprints(A.toLowerCase())).toEqual([A]);
  });

  it("İKİ parmak izi birden taşınır", () => {
    // Play App Signing: yükleme anahtarı VE Google'ın imzalama anahtarı.
    expect(parseFingerprints(`${A}, ${B}`)).toEqual([A, B]);
  });

  it("aynı parmak izi tekilleşir", () => {
    expect(parseFingerprints(`${A},${A.toLowerCase()}`)).toEqual([A]);
  });

  it("BOZUK bir giriş TÜM listeyi reddeder", () => {
    // Yarısı doğru bir beyan, hiç beyan olmamasından daha zor teşhis edilir.
    expect(parseFingerprints(`${A},kisa`)).toBeNull();
  });

  const bozuk: readonly [string, string][] = [
    ["boş", ""],
    ["yalnızca boşluk", "   "],
    ["yalnızca virgül", ",,"],
    ["kısa", A.slice(0, 80)],
    ["uzun", `${A}:AA`],
    ["iki nokta yerine tire", A.replace(/:/g, "-")],
    ["ayraçsız", A.replace(/:/g, "")],
    ["onaltılık olmayan", A.replace("A1", "ZZ")],
  ];

  for (const [label, value] of bozuk) {
    it(`${label} → reddedilir`, () => {
      expect(parseFingerprints(value)).toBeNull();
    });
  }
});

describe("paket adı", () => {
  it("ters DNS biçimi kabul edilir", () => {
    expect(isValidPackageName("com.ornek.hesabibol")).toBe(true);
    expect(isValidPackageName("app.ornek.twa")).toBe(true);
  });

  it("tek parçalı ya da bozuk adlar reddedilir", () => {
    for (const bad of [
      "hesabibol",
      "",
      "Com.Ornek.App",
      "1com.ornek.app",
      ".com.ornek",
      "com..ornek",
      "com.ornek-app",
    ]) {
      expect(isValidPackageName(bad), bad).toBe(false);
    }
  });

  it("çevresindeki boşluk KIRPILIR", () => {
    // Ortam değişkenlerine takılan bir boşluk yüzünden doğrulamanın sessizce
    // düşmesi, kabul edilmesinden çok daha kötü bir hata modudur.
    expect(isValidPackageName("  com.ornek.app  ")).toBe(true);
  });
});

describe("beyanın biçimi", () => {
  it("Chrome'un beklediği ilişki ve ad alanı yazılır", () => {
    const [statement] = buildAssetLinks("com.ornek.app", [A, B]);
    expect(statement.relation).toEqual([HANDLE_ALL_URLS]);
    expect(HANDLE_ALL_URLS).toBe("delegate_permission/common.handle_all_urls");
    expect(statement.target.namespace).toBe("android_app");
    expect(statement.target.package_name).toBe("com.ornek.app");
    expect(statement.target.sha256_cert_fingerprints).toEqual([A, B]);
  });
});

describe("ortamdan üretim", () => {
  it("tam yapılandırma beyanı üretir", () => {
    expect(
      assetLinksFromEnv({
        ANDROID_PACKAGE_NAME: "com.ornek.app",
        ANDROID_APP_FINGERPRINTS: `${A},${B}`,
      }),
    ).toEqual(buildAssetLinks("com.ornek.app", [A, B]));
  });

  const eksik: readonly [string, Record<string, string | undefined>][] = [
    ["hiçbiri yok", {}],
    ["paket adı yok", { ANDROID_APP_FINGERPRINTS: A }],
    ["parmak izi yok", { ANDROID_PACKAGE_NAME: "com.ornek.app" }],
    ["paket adı bozuk", { ANDROID_PACKAGE_NAME: "bozuk", ANDROID_APP_FINGERPRINTS: A }],
    [
      "parmak izi bozuk",
      { ANDROID_PACKAGE_NAME: "com.ornek.app", ANDROID_APP_FINGERPRINTS: "bozuk" },
    ],
  ];

  for (const [label, env] of eksik) {
    it(`${label} → beyan üretilmez`, () => {
      expect(assetLinksFromEnv(env)).toBeNull();
    });
  }
});

describe("rota", () => {
  const saved = {
    pkg: process.env.ANDROID_PACKAGE_NAME,
    prints: process.env.ANDROID_APP_FINGERPRINTS,
  };

  function withEnv<T>(
    pkg: string | undefined,
    prints: string | undefined,
    run: () => T,
  ): T {
    if (pkg === undefined) delete process.env.ANDROID_PACKAGE_NAME;
    else process.env.ANDROID_PACKAGE_NAME = pkg;
    if (prints === undefined) delete process.env.ANDROID_APP_FINGERPRINTS;
    else process.env.ANDROID_APP_FINGERPRINTS = prints;
    try {
      return run();
    } finally {
      if (saved.pkg === undefined) delete process.env.ANDROID_PACKAGE_NAME;
      else process.env.ANDROID_PACKAGE_NAME = saved.pkg;
      if (saved.prints === undefined) delete process.env.ANDROID_APP_FINGERPRINTS;
      else process.env.ANDROID_APP_FINGERPRINTS = saved.prints;
    }
  }

  it("yapılandırma yoksa 404 döner, BOŞ dizi değil", () => {
    const response = withEnv(undefined, undefined, () => GET());
    expect(response.status).toBe(404);
  });

  it("yapılandırma bozuksa da 404 döner", () => {
    const response = withEnv("bozuk", A, () => GET());
    expect(response.status).toBe(404);
  });

  it("yapılandırma tamsa JSON olarak servis edilir", async () => {
    const response = withEnv("com.ornek.app", `${A},${B}`, () => GET());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual(
      buildAssetLinks("com.ornek.app", [A, B]),
    );
  });
});

describe("Bubblewrap yapılandırması manifestten AYRILMAZ", () => {
  const twa = JSON.parse(readFileSync("twa-manifest.json", "utf8")) as Record<
    string,
    unknown
  >;
  const m = manifest();

  it("ad, ekran ve renkler manifestle aynıdır", () => {
    expect(twa.name).toBe(m.name);
    expect(twa.launcherName).toBe(m.short_name);
    expect(twa.display).toBe(m.display);
    expect(twa.themeColor).toBe(m.theme_color);
    expect(twa.backgroundColor).toBe(m.background_color);
    expect(twa.startUrl).toBe(m.start_url);
  });

  it("ikon 512 pikselliktir ve manifestin gösterdiği dosyadır", () => {
    const icon512 = (m.icons ?? []).find((i) => i.sizes === "512x512");
    expect(icon512).toBeDefined();
    expect(String(twa.iconUrl)).toContain(icon512!.src);
    expect(String(twa.maskableIconUrl)).toContain(icon512!.src);
  });

  it("manifest adresi Next'in yayınladığı adrestir", () => {
    expect(String(twa.webManifestUrl)).toContain("/manifest.webmanifest");
  });

  it("bildirimler kapalıdır: uygulama bildirim göndermez", () => {
    expect(twa.enableNotifications).toBe(false);
  });

  it("yapılandırma YA tamamen yer tutucu YA da tamamen gerçektir", () => {
    /*
     * Yarım doldurulmuş bir yapılandırma en kötüsüdür: paketleme çalışır ama
     * yanlış alan adına bağlanır. Ya ikisi de yer tutucu kalır, ya ikisi de
     * gerçek olur.
     */
    const host = String(twa.host);
    const packageId = String(twa.packageId);
    const placeholders =
      host.endsWith(".invalid") && packageId.startsWith("invalid.");
    const real = !host.endsWith(".invalid") && !packageId.startsWith("invalid.");
    expect(placeholders || real, `${host} / ${packageId}`).toBe(true);
    expect(isValidPackageName(packageId)).toBe(true);
  });

  it("gerçek değerler girildiğinde adresler alan adıyla TUTARLI olur", () => {
    const host = String(twa.host);
    for (const key of ["iconUrl", "maskableIconUrl", "webManifestUrl", "fullScopeUrl"]) {
      expect(String(twa[key]), key).toBe(
        String(twa[key]).replace(/^https:\/\/[^/]+/, `https://${host}`),
      );
    }
  });
});

describe("imzalama anahtarı depoya GİRMEZ", () => {
  it("anahtar dosyaları yok sayılır", () => {
    const ignore = readFileSync(".gitignore", "utf8");
    for (const pattern of ["*.keystore", "*.jks"]) {
      expect(ignore, pattern).toContain(pattern);
    }
  });

  it("yapılandırmada yalnızca YOL ve TAKMA AD durur, sır durmaz", () => {
    const key = twaSigningKey();
    expect(Object.keys(key).sort()).toEqual(["alias", "path"]);
    expect(JSON.stringify(key)).not.toMatch(/password|pass|secret/i);
  });

  function twaSigningKey(): Record<string, unknown> {
    const parsed = JSON.parse(readFileSync("twa-manifest.json", "utf8")) as {
      signingKey: Record<string, unknown>;
    };
    return parsed.signingKey;
  }
});
