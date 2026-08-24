import { SharedBillDebtorView } from "@/components/SharedBillDebtorView";

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
      <SharedBillDebtorView billId={billId} />
    </main>
  );
}
