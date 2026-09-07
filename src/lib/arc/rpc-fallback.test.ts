import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DISCLOSED_HOSTS } from "@/lib/legal/privacy";
import { BROWSER_CONNECT_HOSTS } from "@/lib/security/headers";

import {
  ARC_RPC_PER_ENDPOINT_TIMEOUT_MS,
  ARC_RPC_TIMEOUT_MS,
} from "./arc-rpc";
import {
  ARC_TESTNET_RPC_URL,
  ARC_TESTNET_RPC_URLS,
  buildAddArcTestnetParams,
} from "./network";
import { ACTIVE_NETWORK_PROFILE } from "./profile";

/**
 * YEDEKLİ ARC RPC.
 *
 * Önceki hâlde TEK bir genel adres vardı: o adres yavaşladığında ya da hız
 * sınırına takıldığında makbuz doğrulanamıyor, ödeme kesinleştirilemiyordu.
 * Genel testnet RPC'leri bunu düzenli olarak yapar.
 *
 * Bu dosyanın işi iki sınırı birden tutmak: yedekler GERÇEKTEN devrede, ve
 * yedek eklemek tarayıcının yüzeyini SESSİZCE genişletmiyor.
 */

const OFFICIAL_HOST_SUFFIX = ".arc.io";

function hostOf(url: string): string {
  return new URL(url).host;
}

describe("uc listesi", () => {
  it("birincil BASTADIR", () => {
    /*
     * Sıra devretmenin kendisidir: yedekler yalnızca birincil cevap
     * vermediğinde denenir.
     */
    expect(ARC_TESTNET_RPC_URLS[0]).toBe(ARC_TESTNET_RPC_URL);
  });

  it("en az bir YEDEK vardir", () => {
    expect(ARC_TESTNET_RPC_URLS.length).toBeGreaterThan(1);
    expect(ACTIVE_NETWORK_PROFILE.fallbackRpcUrls.length).toBeGreaterThan(0);
  });

  it("hepsi HTTPS ve RESMI alan adi altindadir", () => {
    /*
     * İstemciden gelen bir URL asla kullanılmaz; liste kodda sabittir. Yine
     * de şekil kontrol edilir: yanlışlıkla eklenen üçüncü taraf bir adres ya
     * da düz HTTP burada görülür.
     */
    for (const url of ARC_TESTNET_RPC_URLS) {
      const parsed = new URL(url);
      expect(parsed.protocol, url).toBe("https:");
      expect(parsed.host.endsWith(OFFICIAL_HOST_SUFFIX), url).toBe(true);
      /* Yol, sorgu ya da kimlik bilgisi taşımaz. */
      expect(parsed.pathname, url).toBe("/");
      expect(parsed.search, url).toBe("");
      expect(parsed.username, url).toBe("");
    }
  });

  it("adresler BENZERSIZDIR", () => {
    /*
     * Aynı adres iki kez yazılsaydı "devretme" aslında aynı ölü uca ikinci
     * kez sormak olurdu ve bütçenin yarısı boşa giderdi.
     */
    expect(new Set(ARC_TESTNET_RPC_URLS).size).toBe(ARC_TESTNET_RPC_URLS.length);
  });
});

describe("SURE BUTCESI korunur", () => {
  it("toplam ust sinir DEGISMEDI", () => {
    /*
     * `finalize` üç ardışık RPC çağrısı yapar ve rotanın süre tavanı bu
     * bütçeye göre ayarlıdır. Bu sayı büyürse tavan yeniden hesaplanmalı;
     * test o kararı unutmaya karşı durur.
     */
    expect(ARC_RPC_TIMEOUT_MS).toBe(8000);
  });

  it("butce uclara BOLUNUR, uc basina ayrica verilmez", () => {
    /*
     * Asıl tuzak buydu: her uca 8 saniye verilseydi en kötü durum uç
     * sayısıyla çarpılır ve rotanın tavanını aşardı. Toplam sabit kalır,
     * pay küçülür.
     */
    expect(
      ARC_RPC_PER_ENDPOINT_TIMEOUT_MS * ARC_TESTNET_RPC_URLS.length,
    ).toBeLessThanOrEqual(ARC_RPC_TIMEOUT_MS);
    expect(ARC_RPC_PER_ENDPOINT_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("TARAYICI YUZEYI genislemiyor", () => {
  it("cuzdana bildirilen adres HALA tek", () => {
    /*
     * `wallet_addEthereumChain` listesi büyürse cüzdan o adreslere de
     * bağlanabilir; o an CSP ve gizlilik bildiriminin kapsamı sessizce
     * genişlerdi. Yedekler transport katmanında kalır.
     */
    expect(buildAddArcTestnetParams().rpcUrls).toEqual([ARC_TESTNET_RPC_URL]);
  });

  it("CSP connect-src'ye yedek EKLENMEZ", () => {
    /*
     * Yedeklere yalnızca sunucu bağlanır. Tarayıcı listesine girselerdi,
     * hâlâ kapatılmayı bekleyen `connect-src` yönergesi gereksiz yere
     * genişlerdi.
     */
    for (const url of ACTIVE_NETWORK_PROFILE.fallbackRpcUrls) {
      expect(BROWSER_CONNECT_HOSTS, url).not.toContain(url);
      expect(BROWSER_CONNECT_HOSTS.join(" "), url).not.toContain(hostOf(url));
    }
  });

  it("ama GIZLILIK POLITIKASINDA hepsi bildirilir", () => {
    /*
     * Tarayıcı gitmiyor diye bildirim gerekmiyor değil: uygulama o
     * sunuculara bağlanıyor. Giden veri zaten herkese açık bir işlem
     * hash'idir, ama bağlantının kendisi bildirilir.
     */
    for (const url of ARC_TESTNET_RPC_URLS) {
      expect(DISCLOSED_HOSTS, url).toContain(hostOf(url));
    }
  });
});

describe("istemci kurulumu", () => {
  const source = readFileSync("src/lib/arc/arc-rpc.ts", "utf8");

  it("fallback transport KULLANILIR", () => {
    expect(source).toContain("fallback(");
    expect(source).toContain("ARC_TESTNET_RPC_URLS.map");
  });

  it("yeniden deneme KAPALIDIR: tekrar, siradaki uca gecmektir", () => {
    /*
     * viem varsayılan olarak aynı uca birkaç kez daha sorar. Burada bu
     * istenmez: ölü bir uca ısrar etmek toplam bütçeyi yer ve yedeğe hiç
     * sıra gelmez.
     */
    expect(source).toMatch(/retryCount:\s*0/);
    expect([...source.matchAll(/retryCount:\s*0/g)].length).toBeGreaterThanOrEqual(2);
  });

  it("siralama OLCUME birakilmaz", () => {
    /*
     * `rank: true` gecikme ölçmek için fazladan istek atar ve sırayı
     * öngörülemez kılar. Aranan şey belirlenimci bir devretme.
     */
    expect(source).toMatch(/rank:\s*false/);
  });

  it("zincir tanimi yalnizca BIRINCILI tasir", () => {
    expect(source).toContain("http: [ARC_TESTNET_RPC_URL]");
  });
});
