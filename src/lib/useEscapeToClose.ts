import { useEffect } from 'react';

/**
 * Закриття по Escape: підключається, поки overlay відкритий.
 * Використовує capture-фазу + stopPropagation, щоб конфліктів
 * з іншими обробниками клавіатури не було.
 */
export function useEscapeToClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);
}
