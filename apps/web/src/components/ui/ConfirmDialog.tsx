'use client';
import * as Dialog from '@radix-ui/react-dialog';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-ink/20 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-line bg-surface p-6 shadow-[var(--shadow-pop)]">
          <Dialog.Title className="font-display text-[28px] leading-tight">{title}</Dialog.Title>
          {description && <Dialog.Description className="mt-2 max-h-[50vh] overflow-auto whitespace-pre-line break-words text-[13.5px] text-ink-2">{description}</Dialog.Description>}
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close className="rounded-[4px] px-3 py-2 text-[13px] font-semibold text-ink-2 hover:bg-surface-3">Cancelar</Dialog.Close>
            <button
              type="button"
              autoFocus
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
              className={danger ? 'rounded-[4px] bg-danger px-3 py-2 text-[13px] font-semibold text-white' : 'btn-primary px-3 py-2 text-[13px] font-semibold'}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
