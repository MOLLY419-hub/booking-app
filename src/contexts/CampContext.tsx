import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Camp } from '../types/database';

type CampContextValue = {
  camps: Camp[];
  selectedCampId: string;
  selectedCamp: Camp | null;
  loading: boolean;
  error: string;
  setSelectedCampId: (campId: string) => void;
  campNameById: (campId: string | null | undefined) => string;
};

const ALL_CAMPS = 'all';
const STORAGE_KEY = 'booking-app-selected-camp-id';

const CampContext = createContext<CampContextValue | undefined>(undefined);

export function CampProvider({ children }: { children: ReactNode }) {
  const [camps, setCamps] = useState<Camp[]>([]);
  const [selectedCampId, setSelectedCampIdState] = useState(() => localStorage.getItem(STORAGE_KEY) || ALL_CAMPS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadCamps() {
      setLoading(true);
      setError('');

      const { data, error: loadError } = await supabase
        .from('camps')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (loadError) {
        setError(loadError.message);
        setCamps([]);
      } else {
        const nextCamps = data ?? [];
        setCamps(nextCamps);
        setSelectedCampIdState((current) => {
          if (current === ALL_CAMPS || nextCamps.some((camp) => camp.id === current)) return current;
          return ALL_CAMPS;
        });
      }

      setLoading(false);
    }

    loadCamps();
  }, []);

  const selectedCamp = useMemo(
    () => camps.find((camp) => camp.id === selectedCampId) ?? null,
    [camps, selectedCampId],
  );

  function setSelectedCampId(campId: string) {
    setSelectedCampIdState(campId);
    localStorage.setItem(STORAGE_KEY, campId);
  }

  function campNameById(campId: string | null | undefined) {
    if (!campId) return '未指定營區';
    return camps.find((camp) => camp.id === campId)?.name ?? '未指定營區';
  }

  return (
    <CampContext.Provider
      value={{
        camps,
        selectedCampId,
        selectedCamp,
        loading,
        error,
        setSelectedCampId,
        campNameById,
      }}
    >
      {children}
    </CampContext.Provider>
  );
}

export function useCamp() {
  const context = useContext(CampContext);
  if (!context) throw new Error('useCamp must be used inside CampProvider');
  return context;
}

export { ALL_CAMPS };
