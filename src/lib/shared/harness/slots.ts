// src/lib/shared/harness/slots.ts — the File-component runtime (§0.5). Opens/saves DATA
// files into named slots via the File System Access API, with <input>/download fallbacks.
// The harness owns the slot $state; this factory reads/writes it through the passed
// getter/setter (so a slot change bumps the harness dataRev → data panels re-fetch).
import type { SlotApi, SlotValue } from '$lib/appkit/manifest/types';

type Slots = Record<string, SlotValue & { handle?: unknown }>;

const hasFSA = () => typeof window !== 'undefined' && 'showOpenFilePicker' in window;

/** Parse by extension: .json/.wson → object; everything else → text. */
function parseData(name: string, text: string): unknown {
  if (/\.(json|wson)$/i.test(name)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function serializeData(data: unknown): string {
  return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

/** <input type=file> fallback — resolves the picked File (or null if cancelled). */
function pickFileFallback(accept?: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Anchor-download fallback for Save As when FSA is unavailable. */
function downloadFallback(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function makeSlotApi(get: () => Slots, set: (next: Slots) => void): SlotApi {
  return {
    async openInto(slot, type) {
      let name = '',
        text = '',
        handle: unknown;
      if (hasFSA()) {
        const [h] = await (window as any).showOpenFilePicker({ startIn: 'desktop' });
        handle = h;
        const f = await h.getFile();
        name = f.name;
        text = await f.text();
      } else {
        const f = await pickFileFallback(type);
        if (!f) return;
        name = f.name;
        text = await f.text();
      }
      set({ ...get(), [slot]: { name, type, data: parseData(name, text), handle } });
    },

    async save(slot) {
      const s = get()[slot];
      if (!s) return;
      if (s.handle && hasFSA()) {
        const w = await (s.handle as any).createWritable();
        await w.write(serializeData(s.data));
        await w.close();
      } else {
        await this.saveAs(slot);
      }
    },

    async saveAs(slot) {
      const s = get()[slot];
      if (!s) return;
      const text = serializeData(s.data);
      if (hasFSA()) {
        const h = await (window as any).showSaveFilePicker({ startIn: 'desktop', suggestedName: s.name });
        const w = await h.createWritable();
        await w.write(text);
        await w.close();
        set({ ...get(), [slot]: { ...s, name: h.name ?? s.name, handle: h } });
      } else {
        downloadFallback(s.name, text);
      }
    },
  };
}
