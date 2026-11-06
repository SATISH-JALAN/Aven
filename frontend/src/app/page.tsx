"use client";
import { GapStory } from "@/components/landing/GapStory";
import { Hero } from "@/components/landing/Hero";
import { Preloader } from "@/components/landing/Preloader";
import { BigRows, Features, Marquee, ReplayTeaser, Stats } from "@/components/landing/Sections";
import { SwapStory } from "@/components/landing/SwapStory";
import { UsePageMode } from "@/components/shell";

export default function Landing() {
  return (
    <>
      <UsePageMode mode={null} />
      <Preloader />
      <Hero />
      <GapStory />
      <Marquee />
      <Features />
      <SwapStory />
      <Stats />
      <ReplayTeaser />
      <BigRows />
    </>
  );
}
