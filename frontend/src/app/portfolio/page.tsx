"use client";
import { Portfolio } from "@/components/onchain/Portfolio";
import { UsePageMode } from "@/components/shell";
import { PageHero } from "@/components/ui";

export default function PortfolioPage() {
  return (
    <>
      <UsePageMode mode="LIVE" />
      <PageHero
        eyebrow="Portfolio"
        title="Your trades, straight from the chain."
        lede="Every swap, liquidity change and mint of your wallet, read from HyperEVM: the price you met, the oracle and perp mark the hook read, the fee and its proof."
      />
      <div className="mx-auto max-w-7xl px-6 pb-24">
        <Portfolio />
      </div>
    </>
  );
}
