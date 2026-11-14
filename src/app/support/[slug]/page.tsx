import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocArticle } from "@/components/site/doc-article";
import { SiteShell } from "@/components/site/shell";
import { DOC_PAGES, pageBySlug, viewOf } from "@/lib/site/docs";

export const generateStaticParams = () => DOC_PAGES.map((p) => ({ slug: p.slug }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = pageBySlug(slug);
  if (!p) return {};
  const v = viewOf(p);
  const title = `${p.title} | SubSync Support`;
  return { title, description: v.summary.slice(0, 200), alternates: { canonical: `/support/${slug}` }, openGraph: { title, description: v.summary.slice(0, 200), url: `/support/${slug}`, type: "article", images: [{ url: "/og.png", width: 1200, height: 630 }] } };
}

export default async function DocPageRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = pageBySlug(slug);
  if (!p) notFound();
  return <SiteShell><DocArticle v={viewOf(p)} /></SiteShell>;
}
