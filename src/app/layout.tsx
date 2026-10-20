import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Microdrama Review", template: "%s | Microdrama Review" },
  description: "Timecoded AI and strategist notes on every cut of a microdrama episode",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-baseline gap-4 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              Microdrama Review
            </Link>
            <span className="text-sm text-zinc-500">AI and strategist notes on every cut</span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
