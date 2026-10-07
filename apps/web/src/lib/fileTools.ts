'use client';
import { looksLikeGarbage } from '@bos/domain';
import { STATIC_EXPORT } from './config';

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

/* ---------- OCR (photos of tickets, scanned PDFs) ---------- */

type OcrWorker = { recognize: (img: HTMLCanvasElement | Blob) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> };
let ocrWorkers: Promise<OcrWorker[]> | null = null;
let rr = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** Two Spanish+English OCR workers, created on first use (Spanish data, ~3 MB, served by the app). */
function workers(): Promise<OcrWorker[]> {
  if (!ocrWorkers) {
    // Engine and language data are served by the app itself (public/ocr), not by a CDN.
    const base = new URL(STATIC_EXPORT ? 'ocr/' : '/ocr/', window.location.href).href;
    ocrWorkers = import('tesseract.js').then(async ({ createWorker }) =>
      Promise.all([0, 1].map(() => createWorker('spa', 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: base.replace(/\/$/, ''), gzip: true }) as unknown as Promise<OcrWorker>)),
    );
  }
  if (idleTimer) clearTimeout(idleTimer);
  // Free the memory after a quiet minute.
  idleTimer = setTimeout(() => {
    const w = ocrWorkers;
    ocrWorkers = null;
    void w?.then((ws) => ws.forEach((x) => void x.terminate()));
  }, 60_000);
  return ocrWorkers;
}

/** Shrinks big photos (phone pictures are 12 MP) and boosts contrast a little; OCR is faster and better. */
async function prepareImage(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d')!;
  ctx.filter = 'grayscale(1) contrast(1.25)';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

async function ocrCanvas(c: HTMLCanvasElement): Promise<string> {
  const ws = await workers();
  const w = ws[rr++ % ws.length]!;
  const r = await w.recognize(c);
  return r.data.text ?? '';
}

/** Text of a photo. Empty string if the browser can't decode it (e.g. HEIC outside Safari). */
export async function imageText(file: Blob): Promise<string> {
  try {
    return await ocrCanvas(await prepareImage(file));
  } catch {
    return '';
  }
}

/** Text of a scanned PDF (no text layer): renders the first 2 pages and reads them. */
export async function scannedPdfText(file: Blob): Promise<string> {
  try {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const out: string[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 2 });
      const c = document.createElement('canvas');
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
      out.push(await ocrCanvas(c));
    }
    return out.join('\n');
  } catch {
    return '';
  }
}

/** Best text we can get from any supported document. `ocr` tells the UI it was read from an image. */
export async function documentText(file: File): Promise<{ text: string; ocr: boolean }> {
  const isPdf = file.type === 'application/pdf' || extOf(file.name) === 'pdf';
  if (isPdf) {
    const t = await pdfText(file).catch(() => '');
    if (t.replace(/\s/g, '').length > 30 && !looksLikeGarbage(t)) return { text: t, ocr: false };
    return { text: await scannedPdfText(file), ocr: true };
  }
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name)) return { text: await imageText(file), ocr: true };
  return { text: '', ocr: false };
}
