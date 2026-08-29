import type { Metadata } from "next";
import { Suspense } from "react";

import { AppHeader } from "@/components/AppHeader";
import { PayPageFallback, PayPageIntro } from "@/components/PayPageChrome";
import { PaymentRequestPayer } from "@/components/PaymentRequestPayer";
import { readSafeAuthState } from "@/lib/auth/safe-auth-state";
import { translate } from "@/lib/i18n/dictionary";
import { resolveRequestLocale } from "@/lib/i18n/server";

/** Baslik ve aciklama istegin diline gore uretilir; YOL DEGISMEZ. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveRequestLocale();
  return {
    title: translate(locale, "metadata.payTitle"),
    description: translate(locale, "metadata.payDescription"),
  };
}

/*
 * Oturum YALNIZCA BAŞLIKTA GÖSTERİLİR.
 *
 * Bu sayfa hiçbir şeyi Google oturumuna bağlamaz: talep, imzalı bağlantıdan
 * çözülür ve transferi borçlu kendi cüzdanında imzalar. Oturum burada sadece
 * kullanıcının nerede olduğunu görmesi ve çıkış yapabilmesi içindir.
 */
export default async function PayPage() {
  const authState = await readSafeAuthState();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-10 sm:gap-10 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-3">
        <AppHeader titleKey="metadata.payTitle" authState={authState} />
        <PayPageIntro />
      </header>

      <Suspense fallback={<PayPageFallback />}>
        <PaymentRequestPayer />
      </Suspense>
    </main>
  );
}
