"use client";
/** GitBook-style docs frame: grouped sidebar with search, the page, an "On this page" outline, prev / next. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ALL_DOCS, DOCS, type DocPage } from "@/components/docs/pages";
import { config } from "@/config";

const href = (slug: string) => (slug ? `/docs/${slug}` : "/docs");

export function DocsShell({ page }: { page: DocPage & { group: string } }) {
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const i = ALL_DOCS.findIndex((p) => p.slug === page.slug);
  const prev = i > 0 ? ALL_DOCS[i - 1] : null;
  const next = i < ALL_DOCS.length - 1 ? ALL_DOCS[i + 1] : null;
  const Body = page.Body;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => setOpen(false), [pathname]);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return DOCS;
    return DOCS.map((g) => ({ ...g, pages: g.pages.filter((p) => `${p.title} ${p.description}`.toLowerCase().includes(s)) })).filter((g) => g.pages.length);
  }, [q]);

  const nav = (
    <nav aria-label="Docs" className="space-y-7">
      <label className="relative block">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-faint" aria-hidden>
          ⌕
        </span>
        <input
          ref={search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search docs"
          aria-label="Search docs"
          className="w-full rounded-lg border border-line bg-surface py-2 pl-8 pr-12 text-[13.5px] text-ink placeholder:text-faint focus:border-mint/50 focus:outline-none"
        />
        <kbd className="num pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">Ctrl K</kbd>
      </label>
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-2 px-3 text-[12px] font-medium text-muted">{g.title}</p>
          <ul className="space-y-0.5">
            {g.pages.map((p) => {
              const on = p.slug === page.slug;
              return (
                <li key={p.slug}>
                  <Link
                    href={href(p.slug)}
                    aria-current={on ? "page" : undefined}
                    className={`block rounded-lg px-3 py-1.5 text-[14px] transition ${on ? "bg-mint/10 font-medium text-mint" : "text-ink-2 hover:bg-raised hover:text-ink"}`}
                  >
                    {p.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!groups.length && <p className="px-3 text-[13px] text-muted">No page matches “{q}”.</p>}
    </nav>
  );

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-20 pt-[92px] md:px-6">
      <button onClick={() => setOpen((o) => !o)} className="mb-4 flex w-full items-center justify-between rounded-lg border border-line px-4 py-2.5 text-sm text-ink lg:hidden" aria-expanded={open}>
        <span>
          <span className="text-muted">{page.group} /</span> {page.title}
        </span>
        <span className="text-muted">{open ? "×" : "☰"}</span>
      </button>
      {open && <div className="mb-6 lg:hidden">{nav}</div>}

      <div className="grid gap-10 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_210px]">
        <aside className="no-scrollbar sticky top-[92px] hidden max-h-[calc(100svh-110px)] overflow-y-auto pb-6 lg:block">{nav}</aside>

        <article className="min-w-0 max-w-[760px]">
          <p className="text-[13px] font-medium text-mint">{page.group}</p>
          <h1 className="mt-2 text-[clamp(2rem,3.4vw,2.6rem)] font-medium leading-[1.1] tracking-[-0.035em] text-ink">{page.title}</h1>
          <p className="mt-3 text-[17px] leading-relaxed text-muted">{page.description}</p>
          <div className="mt-8 border-t border-line pt-8" data-doc-body>
            <Body />
          </div>

          <div className="mt-16 grid gap-3 sm:grid-cols-2">
            {prev ? (
              <Link href={href(prev.slug)} className="group rounded-xl border border-line p-4 transition hover:border-line-strong">
                <p className="text-[12px] text-muted">← Previous</p>
                <p className="mt-1 text-[15px] font-medium text-ink group-hover:text-mint">{prev.title}</p>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link href={href(next.slug)} className="group rounded-xl border border-line p-4 text-right transition hover:border-line-strong">
                <p className="text-[12px] text-muted">Next →</p>
                <p className="mt-1 text-[15px] font-medium text-ink group-hover:text-mint">{next.title}</p>
              </Link>
            )}
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-[12px] text-muted">
            <span>Aven · MIT · ETHGlobal Mumbai</span>
            <a href={`${config.repoUrl}/tree/main/frontend/src/components/docs`} target="_blank" rel="noreferrer" className="hover:text-ink">
              Edit on GitHub ↗
            </a>
          </div>
        </article>

        <Outline key={page.slug} />
      </div>
    </div>
  );
}

/** "On this page": the h2/h3s of the current doc, with the one in view highlighted. */
function Outline() {
  const [items, setItems] = useState<Array<{ id: string; text: string; level: number }>>([]);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const hs = Array.from(document.querySelectorAll<HTMLElement>("[data-doc-body] [data-toc]"));
    setItems(hs.map((h) => ({ id: h.id, text: (h.firstChild?.textContent ?? h.textContent ?? "").trim(), level: Number(h.dataset.toc) })));
    const io = new IntersectionObserver(
      (es) => {
        const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-90px 0px -65% 0px" },
    );
    hs.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, []);
  if (!items.length) return <div className="hidden xl:block" />;
  return (
    <aside className="sticky top-[92px] hidden max-h-[calc(100svh-110px)] self-start overflow-y-auto xl:block">
      <p className="mb-3 text-[12px] font-medium text-muted">On this page</p>
      <ul className="space-y-1.5 border-l border-line">
        {items.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={`-ml-px block border-l py-0.5 text-[13px] transition ${h.level === 3 ? "pl-6" : "pl-3.5"} ${active === h.id ? "border-mint text-mint" : "border-transparent text-muted hover:text-ink"}`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
