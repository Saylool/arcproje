import { ReceiptFlow } from "@/components/ReceiptFlow";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-10 sm:gap-10 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-xs font-bold text-white"
          >
            ₺
          </span>
          <span className="text-sm font-semibold tracking-tight text-slate-900">
            Hesabı Böl
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Fişini yükle
          </h1>
          <p className="text-sm leading-relaxed text-slate-500 sm:text-base">
            Fişin fotoğrafını ekle. Sonraki adımlarda ürünleri kişilere dağıtıp
            herkesin payını hesaplayacağız.
          </p>
        </div>
      </header>

      <ReceiptFlow />
    </main>
  );
}
