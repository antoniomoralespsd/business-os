'use client';

/** A file plus the folder path it came in ("2026/03 MARZO/Ingresos/f.pdf"). */
export type PickedFile = { file: File; path: string };

const SKIP = /^(\.|~\$|thumbs\.db$|desktop\.ini$)/i;

/**
 * Files from a drop, walking into folders. Must be called synchronously inside the drop handler
 * (the browser empties `dataTransfer` after the event).
 */
export function filesFromDrop(dt: DataTransfer): Promise<PickedFile[]> {
  const entries = [...dt.items].map((i) => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null)).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return Promise.resolve([...dt.files].map((f) => ({ file: f, path: f.name })));
  return Promise.all(entries.map(walk)).then((r) => r.flat());
}

async function walk(entry: FileSystemEntry): Promise<PickedFile[]> {
  if (SKIP.test(entry.name)) return [];
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    return [{ file, path: entry.fullPath.replace(/^\//, '') }];
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const all: FileSystemEntry[] = [];
    // readEntries returns at most ~100 entries per call.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      all.push(...batch);
    }
    return (await Promise.all(all.map(walk))).flat();
  }
  return [];
}

/** Files from an <input type=file webkitdirectory> or a normal multi-file input. */
export function filesFromInput(list: FileList): PickedFile[] {
  return [...list].filter((f) => !SKIP.test(f.name)).map((f) => ({ file: f, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name }));
}

export type FileVerdict = 'document' | 'archive' | 'unsupported';
export function verdictFor(name: string): FileVerdict {
  if (/\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(name)) return 'document';
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return 'archive';
  return 'unsupported';
}
