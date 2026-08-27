import { AppHeader } from "@/components/AppHeader";
import { ReceiptFlow } from "@/components/ReceiptFlow";
import { authenticateRequest } from "@/lib/auth/session";

export default async function Home() {
  const user = await authenticateRequest();
  const safeUser = user === null ? null : { name: user.name, image: user.image };

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-10 sm:gap-10 sm:px-6 sm:py-16">
      <header>
        <AppHeader titleKey="metadata.homeTitle" authUser={safeUser} />
      </header>

      <ReceiptFlow isAuthenticated={user !== null} />
    </main>
  );
}
