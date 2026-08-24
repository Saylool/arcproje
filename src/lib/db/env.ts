/**
 * Veritabanı yapılandırmasının okunması. YALNIZCA SUNUCU.
 *
 * `DATABASE_URL` bir SIRDIR: kullanıcı adı, parola ve ana bilgisayar içerir.
 * Bu modül değeri ASLA loglamaz, hata mesajına koymaz veya döndürdüğü
 * problem tipine gömmez. Dışarıya yalnızca "yapılandırıldı mı?" bilgisi
 * ve — yalnızca sunucu içi çağıranlara — bağlantı dizesinin kendisi verilir.
 *
 * `NEXT_PUBLIC_` öneki KULLANILMAZ; değişken istemci paketine giremez.
 */

/** Proje sözleşmesi: ortam nesnesi `process.env` ile uyumlu geniş bir kayıttır. */
export type DatabaseEnv = Record<string, string | undefined>;

export type DatabaseUrlProblem = "missing";

export type DatabaseUrlResult =
  | { ok: true; url: string }
  | { ok: false; problem: DatabaseUrlProblem };

export function readDatabaseUrl(
  env: DatabaseEnv = process.env,
): DatabaseUrlResult {
  const url = env.DATABASE_URL?.trim();
  if (url === undefined || url === "") {
    return { ok: false, problem: "missing" };
  }
  return { ok: true, url };
}

/**
 * Yalnızca VARLIK kontrolü. Değer hiçbir biçimde dışarı verilmez; bu yüzden
 * arayüz, loglar ve testler bu boolean'ı kullanır.
 */
export function isDatabaseConfigured(env: DatabaseEnv = process.env): boolean {
  return readDatabaseUrl(env).ok;
}
