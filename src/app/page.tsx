import { AppHeader } from "@/components/AppHeader";
import { ReceiptFlow } from "@/components/ReceiptFlow";
import { authenticateRequest } from "@/lib/auth/session";

export default async function Home() {
  const authentication = await authenticateRequest();
  const authState =
    authentication.status === "authenticated"
      ? {
          status: "authenticated" as const,
          user: {
            name: authentication.user.name,
            image: authentication.user.image,
          },
        }
      : authentication;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-10 sm:gap-10 sm:px-6 sm:py-16">
      <header>
        <AppHeader titleKey="metadata.homeTitle" authState={authState} />
      </header>

      <ReceiptFlow authStatus={authentication.status} />
    </main>
  );
}
