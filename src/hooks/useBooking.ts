import { useCallback, useState } from 'react';
import type { BookingDraft } from '@/src/types/models';

export function useBooking() {
  const [draft, setDraft] = useState<BookingDraft | null>(null);

  const reset = useCallback(() => setDraft(null), []);

  return { draft, setDraft, reset };
}
