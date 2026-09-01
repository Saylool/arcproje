import { AppHeader } from "@/components/AppHeader";
import { MyBillsPanel } from "@/components/MyBillsPanel";
import { ReceiptFlow } from "@/components/ReceiptFlow";
import { SavedContactsPanel } from "@/components/SavedContactsPanel";
import { readSafeAuthState } from "@/lib/auth/safe-auth-state";

export default async function Home() {
  const authState = await readSafeAuthState();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-10 sm:gap-10 sm:px-6 sm:py-16">
      <header>
        <AppHeader titleKey="metadata.homeTitle" authState={authState} />
      </header>

      <ReceiptFlow
        authStatus={authState.status}
        contactsPanel={
          authState.status === "authenticated" ? <SavedContactsPanel /> : null
        }
      />

      {/*
        Sahiplik listesi YALNIZCA oturum açıkken oluşturulur. Oturumsuz bir
        ziyaretçide bileşen hiç render edilmez, bu yüzden gereksiz bir istek de
        atılmaz ve oturum açılması gerektiği başlıktaki kontrolle zaten söylenir.
      */}
      {authState.status === "authenticated" && <MyBillsPanel />}
    </main>
  );
}
