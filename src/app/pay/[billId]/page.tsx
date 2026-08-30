import type { Metadata } from "next";

import { AppHeader } from "@/components/AppHeader";
import { SharedBillDebtorView } from "@/components/SharedBillDebtorView";
import { readSafeAuthState } from "@/lib/auth/safe-auth-state";
import { translate } from "@/lib/i18n/dictionary";
import { resolveRequestLocale } from "@/lib/i18n/server";

/**
 * Ortak hesap baglantisi: `/pay/<billId>`.
 *
 * Sayfa SUNUCUDA hicbir hesap verisi okumaz ve hesabin var olup olmadigini
 * ACIGA VURMAZ. Kimlik dogrulamasindan once gosterilecek bir sey yoktur;
 * borc yalnizca cuzdan imzasiyla ve `/me` uzerinden gelir.
 *
 * GOOGLE OTURUMU YALNIZCA BASLIKTA GOSTERILIR ve BIR KAPI DEGILDIR: bu
 * baglantiyi acan kisinin oturumu olmayabilir, olmasi da gerekmez. Borcu
 * gormek icin tek yeterli kanit CUZDAN IMZASIDIR; oturum durumu o karari
 * hicbir bicimde etkilemez.
 *
 * Eski, borclu basina `/pay?request=...` baglantilari AYRI bir sayfadadir ve
 * bu degisiklikten etkilenmez.
 *
 * DIL: yol bir dil on eki TASIMAZ. Paylasilmis baglanti herkeste AYNI
 * adrestir ve onu ACAN kisinin kendi diliyle gorunur.
 */

export const dynamic = "force-dynamic";

/** Ust veri de dile duyarlidir ama hesap hakkinda HICBIR sey soylemez. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveRequestLocale();
  return {
    title: translate(locale, "metadata.sharedBillTitle"),
    description: translate(locale, "metadata.sharedBillDescription"),
  };
}

export default async function SharedBillPage({
  params,
}: {
  params: Promise<{ billId: string }>;
}) {
  /* Oturum okuma, hesap kimligini cozmeyi GECIKTIRMEZ; ikisi paraleldir. */
  const [{ billId }, authState] = await Promise.all([
    params,
    readSafeAuthState(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-8">
      {/*
        Dil ve tema denetimleri uygulamanin HER yerinde erisilebilir olmali.
        Bu baslik hesap verisi ICERMEZ ve kimlik dogrulamasindan once hicbir
        sey aciga vurmaz.
      */}
      <header>
        <AppHeader titleKey="metadata.sharedBillTitle" authState={authState} />
      </header>

      <SharedBillDebtorView billId={billId} />
    </main>
  );
}
