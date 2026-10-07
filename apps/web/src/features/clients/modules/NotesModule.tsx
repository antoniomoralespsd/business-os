'use client';
import { useEffect, useRef, useState } from 'react';
import { Card, Textarea } from '@/components/ui/kit';
import { act } from '@/data/hooks';
import type { ClientModuleProps } from './registry';

/** Free-form notes with autosave (1 s after you stop typing). */
export function NotesModule({ client }: ClientModuleProps) {
  const [text, setText] = useState(client.notes);
  const [state, setState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(client.notes);

  useEffect(() => {
    if (state === 'saved' && client.notes !== last.current) {
      setText(client.notes);
      last.current = client.notes;
    }
  }, [client.notes, state]);

  const save = async (value: string) => {
    setState('saving');
    const r = await act('client.update', { id: client.id, patch: { notes: value } });
    last.current = value;
    setState(r ? 'saved' : 'dirty');
  };

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="eyebrow text-ink-2">Notas de {client.name}</p>
        <span className="text-[11.5px] text-ink-3">{state === 'saving' ? 'Guardando…' : state === 'dirty' ? 'Sin guardar' : 'Guardado'}</span>
      </div>
      <Textarea
        rows={18}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setState('dirty');
          if (timer.current) clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = setTimeout(() => void save(v), 1000);
        }}
        onBlur={() => state === 'dirty' && void save(text)}
        placeholder={'Formatos de entrega, tipografías, contactos, cómo le gusta recibir las cosas…\n\nEj.: Flyers 1080×1350 + story 1080×1920. Logo siempre arriba a la derecha.'}
        className="min-h-[360px] border-0 bg-transparent px-0 text-[14px] focus:border-0"
      />
    </Card>
  );
}
