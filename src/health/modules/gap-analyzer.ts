import type { SiteHealthReport } from "../types.js";

function extractTitleKeywords(pages: any[]): Map<string, string[]> {
  const kw = new Map<string, string[]>();
  const stopWords = new Set(["the","a","an","and","or","but","in","on","at","to","for","of","is","it","that","this","with","as","by","from","are","was","were","be","been","has","have","had","do","does","did","will","would","could","should","not","no","so","if","than","then","all","each","every","both","few","more","most","other","some","such","only","own","same","too","very","can","just","into","also","about","up","out","how","what","when","where","which","who","its","our","my","your","their","his","her","we","they","you","i","me","us","him","them"]);
  for (const p of pages) {
    const title = (p.documentTitle ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ");
    const words = title.split(/\s+/).filter((w: string) => w.length > 2 && !stopWords.has(w));
    // Single words + bigrams
    for (const w of words) {
      const urls = kw.get(w) ?? [];
      if (!urls.includes(p.url)) urls.push(p.url);
      kw.set(w, urls);
    }
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      const urls = kw.get(bigram) ?? [];
      if (!urls.includes(p.url)) urls.push(p.url);
      kw.set(bigram, urls);
    }
  }
  return kw;
}

export function analyzeKeywordGap(reportsA: SiteHealthReport[], reportsB: SiteHealthReport[]) {
  const pagesA = reportsA.flatMap(r => r.crawl.pages);
  const pagesB = reportsB.flatMap(r => r.crawl.pages);
  const kwA = extractTitleKeywords(pagesA);
  const kwB = extractTitleKeywords(pagesB);
  const allKeywords = new Set([...kwA.keys(), ...kwB.keys()]);
  const onlyA: { keyword: string; urls: string[]; score: number }[] = [];
  const onlyB: { keyword: string; urls: string[]; score: number }[] = [];
  const shared: { keyword: string; urlsA: string[]; urlsB: string[]; score: number }[] = [];
  for (const kw of allKeywords) {
    const inA = kwA.get(kw);
    const inB = kwB.get(kw);
    if (inA && !inB) onlyA.push({ keyword: kw, urls: inA.slice(0, 5), score: inA.length });
    else if (!inA && inB) onlyB.push({ keyword: kw, urls: inB.slice(0, 5), score: inB.length });
    else if (inA && inB) shared.push({ keyword: kw, urlsA: inA.slice(0, 3), urlsB: inB.slice(0, 3), score: inA.length + inB.length });
  }
  onlyA.sort((a, b) => b.score - a.score);
  onlyB.sort((a, b) => b.score - a.score);
  shared.sort((a, b) => b.score - a.score);
  return { onlyA: onlyA.slice(0, 50), onlyB: onlyB.slice(0, 50), shared: shared.slice(0, 50), summary: { totalA: kwA.size, totalB: kwB.size, overlap: shared.length } };
}

export function analyzeBacklinkGap(reportsA: SiteHealthReport[], reportsB: SiteHealthReport[]) {
  const linksA = new Map<string, number>();
  const linksB = new Map<string, number>();
  for (const r of reportsA) for (const lc of (r.crawl.linkChecks ?? [])) linksA.set(lc.target, (linksA.get(lc.target) ?? 0) + 1);
  for (const r of reportsB) for (const lc of (r.crawl.linkChecks ?? [])) linksB.set(lc.target, (linksB.get(lc.target) ?? 0) + 1);
  const allUrls = new Set([...linksA.keys(), ...linksB.keys()]);
  const onlyA: { url: string; linkCount: number }[] = [];
  const onlyB: { url: string; linkCount: number }[] = [];
  const shared: { url: string; countA: number; countB: number }[] = [];
  for (const u of allUrls) {
    const cA = linksA.get(u);
    const cB = linksB.get(u);
    if (cA && !cB) onlyA.push({ url: u, linkCount: cA });
    else if (!cA && cB) onlyB.push({ url: u, linkCount: cB });
    else if (cA && cB) shared.push({ url: u, countA: cA, countB: cB });
  }
  onlyA.sort((a, b) => b.linkCount - a.linkCount);
  onlyB.sort((a, b) => b.linkCount - a.linkCount);
  return { onlyA: onlyA.slice(0, 50), onlyB: onlyB.slice(0, 50), shared: shared.slice(0, 50), summary: { totalA: linksA.size, totalB: linksB.size, overlap: shared.length } };
}
