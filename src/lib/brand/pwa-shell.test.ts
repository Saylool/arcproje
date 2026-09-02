import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";
import {
  BRAND_COLOR,
  MARK_BOUNDS,
  MARK_PATHS,
  MARK_SIZE,
  MASKABLE_SAFE_RADIUS,
  SURFACE_DARK,
  SURFACE_LIGHT,
  markCornerRadius,
  markSvg,
} from "./mark";

/**
 * PWA KABUĞUNUN SÖZLEŞMESİ.
 *
 * Bu dosya üç şeyi kilitler: işaretin maskelenebilir güvenli alanı taşmaması,
 * manifestin Android'in kurulabilirlik eşiğini karşılaması, ve renklerin
 * tasarım sisteminden sessizce ayrılmaması. Bir de bilerek YAPILMAYAN şeyi:
 * servis çalışanı.
 */

const read = (path: string) => readFileSync(path, "utf8");
const css = read("src/app/globals.css");

function cssValues(token: string): string[] {
  return [...css.matchAll(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{3,8})`, "g"))].map(
    (m) => m[1].toLowerCase(),
  );
}

function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect([...bytes.subarray(0, 8)], path).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("marka işareti", () => {
  it("hiçbir FONTA bağlı değildir", () => {
    // Başlıktaki eski `₺` bir metin düğümüydü ve her cihazda farklı çizilirdi.
    const source = read("src/lib/brand/mark.ts");
    expect(source).not.toContain("<text");
    expect(source).not.toContain("font-family");
    expect(MARK_PATHS.length).toBeGreaterThan(0);
    for (const d of MARK_PATHS) {
      expect(d).toMatch(/^M[\d\s.-]/);
    }
  });

  it("MASKELENEBİLİR güvenli alanın içinde kalır", () => {
    // Android ikonu daireye kırpar; taşarsa işaretin köşesi kesilir.
    expect(markCornerRadius()).toBeLessThanOrEqual(MASKABLE_SAFE_RADIUS);
  });

  it("güvenli yarıçap SPEC'in kendisidir, gevşetilebilir bir sayı değil", () => {
    // Güvenli alan merkezi %80 ÇAPLI dairedir; yarıçapı kenarın %40'ıdır.
    expect(MASKABLE_SAFE_RADIUS).toBe(MARK_SIZE * 0.4);
  });

  it("köşe uzaklığı İKİ eksende birden ölçülür", () => {
    const centre = MARK_SIZE / 2;
    const dx = Math.max(centre - MARK_BOUNDS.minX, MARK_BOUNDS.maxX - centre);
    const dy = Math.max(centre - MARK_BOUNDS.minY, MARK_BOUNDS.maxY - centre);
    expect(markCornerRadius()).toBeCloseTo(Math.sqrt(dx * dx + dy * dy), 6);
    // Tek eksene bakan bir hesap daha küçük çıkar ve taşmayı GİZLERDİ.
    expect(markCornerRadius()).toBeGreaterThan(Math.max(dx, dy));
  });

  it("kutunun içinde durur", () => {
    expect(MARK_BOUNDS.minX).toBeGreaterThanOrEqual(0);
    expect(MARK_BOUNDS.minY).toBeGreaterThanOrEqual(0);
    expect(MARK_BOUNDS.maxX).toBeLessThanOrEqual(MARK_SIZE);
    expect(MARK_BOUNDS.maxY).toBeLessThanOrEqual(MARK_SIZE);
  });

  it("zeminsiz istendiğinde dikdörtgen basılmaz", () => {
    expect(markSvg({ size: 64, background: null })).not.toContain("<rect");
    expect(markSvg({ size: 64, background: BRAND_COLOR })).toContain(
      `<rect width="512" height="512" fill="${BRAND_COLOR}"`,
    );
  });

  it("küçültülünce ORTALANIR", () => {
    const svg = markSvg({ size: 512, background: null, scale: 0.5 });
    // (1 - 0.5) * 512 / 2 = 128
    expect(svg).toContain("translate(128 128) scale(0.5)");
  });
});

describe("renkler tasarım sisteminden AYRILMAZ", () => {
  it("marka rengi `globals.css` ile aynıdır", () => {
    const values = cssValues("color-brand");
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values)).toEqual(new Set([BRAND_COLOR]));
  });

  it("iki tema zemini de `globals.css` ile aynıdır", () => {
    const values = cssValues("color-surface");
    // Dosyada önce aydınlık kök, sonra koyu tema tanımlanır.
    expect(values[0]).toBe(SURFACE_LIGHT);
    expect(values).toContain(SURFACE_DARK);
  });
});

describe("ikon dosyaları", () => {
  it("manifestin gösterdiği her ikon DİSKTE vardır ve boyutu doğrudur", () => {
    for (const icon of manifest().icons ?? []) {
      const path = `public${icon.src}`;
      const [expected] = (icon.sizes ?? "").split("x").map(Number);
      expect(pngSize(path)).toEqual({ width: expected, height: expected });
    }
  });

  it("Apple ikonu 180 pikseldir", () => {
    expect(pngSize("src/app/apple-icon.png")).toEqual({ width: 180, height: 180 });
  });

  it("sekme ikonu AYNI geometriden üretilmiştir", () => {
    // Elle düzenlenirse ikon ile başlık ayrışır; burada eşitlikleri sabitlenir.
    expect(read("src/app/icon.svg")).toBe(
      `${markSvg({ size: 512, background: BRAND_COLOR })}\n`,
    );
  });
});

describe("manifest", () => {
  const m = manifest();

  it("Android'in kurulabilirlik eşiğini karşılar", () => {
    expect(m.name?.trim()).not.toBe("");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");

    const sizes = new Set((m.icons ?? []).map((i) => i.sizes));
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("kısa ad ana ekranda KIRPILMAYACAK kadar kısadır", () => {
    expect(m.short_name).toBeDefined();
    expect(m.short_name!.length).toBeLessThanOrEqual(12);
  });

  it("HER boyut için HER iki amaç bildirilir", () => {
    // Yalnızca amaçlara bakmak yetmez: bir boyutun bir amacı düşse de küme
    // dolu kalırdı. Çiftlerin tamamı aranır.
    const pairs = new Set((m.icons ?? []).map((i) => `${i.sizes} ${i.purpose}`));
    for (const sizes of ["192x192", "512x512"]) {
      for (const purpose of ["any", "maskable"]) {
        expect(pairs, `${sizes} ${purpose}`).toContain(`${sizes} ${purpose}`);
      }
    }
  });

  it("renkler marka kaynağından gelir", () => {
    expect(m.theme_color).toBe(BRAND_COLOR);
    expect(m.background_color).toBe(SURFACE_LIGHT);
  });

  it("TEK DİLLİDİR ve dilini bildirir", () => {
    // `<link rel="manifest">` çerez göndermez; dile göre değişemez.
    expect(m.lang).toBe("tr");
    expect(m.name).toBe("Hesabı Böl");
  });
});

describe("tarayıcı çubuğu rengi", () => {
  const layout = read("src/app/layout.tsx");

  it("iki tema için de bildirilir", () => {
    expect(layout).toContain("prefers-color-scheme: light");
    expect(layout).toContain("prefers-color-scheme: dark");
    expect(layout).toContain("SURFACE_LIGHT");
    expect(layout).toContain("SURFACE_DARK");
  });
});

describe("SERVİS ÇALIŞANI YOKTUR", () => {
  it("hiçbir yerde kaydedilmez", () => {
    /*
     * Bilerek yok: sayfalar `no-store`. Bir önbellek ödeme sayfasını ya da
     * imzalı bir yükü saklayabilir, o sınırı delerdi. Bu test, ileride
     * "çevrimdışı desteği" diye sessizce eklenmesini engeller.
     */
    const sources = [
      "src/app/layout.tsx",
      "src/app/manifest.ts",
      "src/components/AppHeader.tsx",
    ];
    for (const file of sources) {
      expect(read(file), file).not.toContain("serviceWorker");
      expect(read(file), file).not.toContain("workbox");
    }
    expect(() => readFileSync("public/sw.js")).toThrow();
  });
});

describe("başlık ile ikon AYNI işareti kullanır", () => {
  const header = read("src/components/AppHeader.tsx");

  it("başlık çizilmiş işareti basar, metin değil", () => {
    expect(header).toContain("<BrandMark");
    expect(header).not.toContain("₺");
  });

  it("işaret bileşeni ORTAK geometriyi okur", () => {
    const mark = read("src/components/BrandMark.tsx");
    expect(mark).toContain('from "@/lib/brand/mark"');
    expect(mark).toContain("MARK_PATHS");
  });
});
