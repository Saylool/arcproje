import { ReceiptFlow } from "@/components/ReceiptFlow";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-10 sm:gap-10 sm:px-6 sm:py-16">
      <header>
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
      </header>

      <ReceiptFlow />
    </main>
  );
}
