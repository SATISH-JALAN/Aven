"use client";
import { notFound, useParams } from "next/navigation";
import { DocsShell } from "@/components/docs/DocsShell";
import { ALL_DOCS } from "@/components/docs/pages";
import { UsePageMode } from "@/components/shell";

export default function DocsPage() {
  const params = useParams<{ slug?: string[] }>();
  const slug = (params.slug ?? []).join("/");
  const page = ALL_DOCS.find((p) => p.slug === slug);
  if (!page) notFound();
  return (
    <>
      <UsePageMode mode={null} />
      <DocsShell page={page} />
    </>
  );
}
