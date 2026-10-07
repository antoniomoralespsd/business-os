'use client';

/** SHA-256 of a file, hex (duplicate detection). */
export async function sha256(file: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Text of a PDF (first 6 pages), line by line. Empty string if it has no text layer (scanned). */
export async function pdfText(file: Blob): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 6); p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    // Rebuild lines from text items using their vertical position.
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5]! / 3) * 3;
      rows.set(y, [...(rows.get(y) ?? []), { x: it.transform[4]!, s: it.str }]);
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r.sort((a, b) => a.x - b.x).map((x) => x.s).join(' ').replace(/\s+/g, ' ').trim());
    pages.push(lines.join('\n'));
  }
  return pages.join('\n');
}

export function extOf(name: string): string {
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1]!.toLowerCase() : '';
}
