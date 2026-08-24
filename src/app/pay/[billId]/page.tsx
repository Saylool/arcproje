import { SharedBillDebtorView } from "@/components/SharedBillDebtorView";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Ortak hesap bağlantısı: `/pay/<billId>`.
 *
 * Sayfa SUNUCUDA hiçbir hesap verisi okumaz ve hesabın var olup olmadığını
 * AÇIĞA VURMAZ. Kimlik doğrulamasından önce gösterilecek bir şey yoktur;
 * borç yalnızca cüzdan imzasıyla ve `/me` üzerinden gelir.
 *
 * Eski, borçlu başına `/pay?request=...` bağlantıları AYRI bir sayfadadır ve
 * bu değişiklikten etkilenmez.
 */

export const dynamic = "force-dynamic";

export default async function SharedBillPage({
  params,
}: {
  params: Promise<{ billId: string }>;
}) {
  const { billId } = await params;
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-8">
      {/*
        Tema anahtari uygulamanin HER yerinde erisilebilir olmali; bu sayfada
        marka basligi yoktu, digerleriyle ayni desende eklendi. Hesap verisi
        ICERMEZ ve kimlik dogrulamasindan once hicbir sey aciga vurmaz.
      */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-xs font-bold text-white"
          >
            ₺
          </span>
          <span className="text-sm font-semibold tracking-tight text-ink">
            Hesabı Böl
          </span>
        </div>
        <ThemeToggle />
      </header>

      <SharedBillDebtorView billId={billId} />
    </main>
  );
}
