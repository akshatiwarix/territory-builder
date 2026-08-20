import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_Condensed } from "next/font/google";
import "./globals.css";

/**
 * Condensed engineering sans for labels, mono for every number and every rule.
 *
 * The rules are set in mono on purpose: a territory rule is a predicate, not a
 * sentence, and the thing a rep is handed should look like something that can be
 * evaluated rather than something that was written about them.
 */
const sans = IBM_Plex_Sans_Condensed({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Territory Builder",
  description:
    "Balance an account universe into sales territories — and certify the imbalance that was never available, instead of apologising for it.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
