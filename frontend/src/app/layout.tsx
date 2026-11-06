import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Smoother } from "@/components/motion";
import { Footer, Nav, PageModeProvider, ReadyOutsideLanding, RpcBanner } from "@/components/shell";
import { WalletProvider } from "@/components/wallet";
import { ArenaProvider } from "@/lib/arena";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Aven: perp-aware fees for Uniswap v4", template: "%s · Aven" },
  description: "A Uniswap v4 dynamic-fee hook on HyperEVM that prices every swap from Hyperliquid's in-block perp market. No operator, keeper, owner or custody.",
};

export const viewport: Viewport = { themeColor: "#070908", colorScheme: "dark" };

// Runs before paint: lets CSS pre-hide elements that GSAP reveals, only when motion is allowed (no flash, no
// invisible content without JS). Scroll restoration is manual because pinned, scrubbed sections must start at the top.
const motionFlag = `try{history.scrollRestoration='manual';if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('js-motion')}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: motionFlag }} />
      </head>
      <body className="min-h-screen">
        <WalletProvider>
          <ArenaProvider>
            <PageModeProvider>
              <ReadyOutsideLanding />
              <Nav />
              <RpcBanner />
              <div id="smooth-wrapper">
                <div id="smooth-content">
                  <Smoother />
                  <main>{children}</main>
                  <Footer />
                </div>
              </div>
            </PageModeProvider>
          </ArenaProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
