import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader } from "@/components/AppHeader";
import { PRIVACY_POLICY } from "@/lib/legal/privacy";
import type { PolicyBlock } from "@/lib/legal/privacy-types";
import { translate } from "@/lib/i18n/dictionary";
import { resolveRequestLocale } from "@/lib/i18n/server";

/**
 * GİZLİLİK POLİTİKASI — `/privacy`.
 *
 * Tek adres, iki dil: uygulamanın geri kalanı gibi burada da dil yol ön eki
 * YOKTUR, metin isteğin diline göre seçilir. Play Console'a verilecek adres
 * bu yüzden tek ve kalıcıdır.
 *
 * Metnin kendisi `src/lib/legal/privacy.ts` içindedir; bu dosya yalnızca onu
 * çizer ve hiçbir cümle barındırmaz.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveRequestLocale();
  return {
    title: translate(locale, "metadata.privacyTitle"),
    description: translate(locale, "metadata.privacyDescription"),
  };
}

function Block({ block }: { block: PolicyBlock }) {
  if (block.kind === "paragraph") {
    return <p className="text-sm leading-relaxed text-ink-soft">{block.text}</p>;
  }

  if (block.kind === "list") {
    return (
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink-soft">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }

  if (block.kind === "warning") {
    return (
      <p className="rounded-2xl border border-warn-line bg-warn-surface px-3 py-2.5 text-sm leading-relaxed text-warn-ink">
        {block.text}
      </p>
    );
  }

  return (
    /* Geniş tablo KENDİ içinde kayar; sayfa gövdesi yana kaymaz. */
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
        <thead>
          <tr>
            {block.head.map((cell) => (
              <th
                key={cell}
                scope="col"
                className="border-b border-line px-2 py-2 font-semibold text-ink"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row.join("|")}>
              {row.map((cell) => (
                <td
                  key={cell}
                  className="border-b border-line-soft px-2 py-2 align-top leading-relaxed text-ink-soft"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PrivacyPage() {
  const locale = await resolveRequestLocale();
  const policy = PRIVACY_POLICY[locale];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-16">
      <header>
        <AppHeader
          titleKey="metadata.privacyTitle"
          authState={{ status: "signedOut" }}
        />
      </header>

      <article className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {policy.title}
          </h1>
          <p className="text-xs text-ink-faint">
            {translate(locale, "legal.effectiveFrom", {
              date: policy.effectiveDate,
            })}
          </p>
          <p className="text-sm leading-relaxed text-ink-soft">{policy.intro}</p>
        </div>

        {policy.sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className="flex flex-col gap-3 border-t border-line-soft pt-6"
          >
            <h2 className="text-base font-semibold text-ink">{section.heading}</h2>
            {section.blocks.map((block, index) => (
              <Block key={`${section.id}-${index}`} block={block} />
            ))}
          </section>
        ))}
      </article>

      <Link
        href="/"
        className="self-start rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-h-11 inline-flex items-center"
      >
        {translate(locale, "legal.backHome")}
      </Link>
    </main>
  );
}
