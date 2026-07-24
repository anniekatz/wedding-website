import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface EntreeOption {
  id: number;
  value: string;
  label: string;
  availableFor: 'adult' | 'child' | 'both';
  order: number;
}

interface RsvpSettings {
  cutoffDate: string | null;
  isLocked: boolean;
}

interface ScheduleEvent {
  id: number;
  name: string;
  time: string;
  endTime: string | null;
  location: string;
  description: string | null;
  order: number;
}

interface FAQ {
  id: number;
  question: string;
  answer: string;
  imagePath: string | null;
  order: number;
}

interface WeddingData {
  schedule: ScheduleEvent[];
  faqs: FAQ[];
  entreeOptions: EntreeOption[];
  rsvpSettings: RsvpSettings | null;
  isLoading: boolean;
}

const WeddingDataContext = createContext<WeddingData | undefined>(undefined);

export function WeddingDataProvider({ children }: { children: ReactNode }) {
  const [schedule, setSchedule] = useState<ScheduleEvent[]>([]);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [entreeOptions, setEntreeOptions] = useState<EntreeOption[]>([]);
  const [rsvpSettings, setRsvpSettings] = useState<RsvpSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchJson = async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url} responded with ${r.status}`);
      return r.json();
    };

    Promise.allSettled([
      fetchJson('/api/schedule'),
      fetchJson('/api/faqs'),
      fetchJson('/api/config'),
    ])
      .then(([scheduleResult, faqsResult, configResult]) => {
        if (scheduleResult.status === 'fulfilled' && Array.isArray(scheduleResult.value)) {
          setSchedule(scheduleResult.value);
        }
        if (faqsResult.status === 'fulfilled' && Array.isArray(faqsResult.value)) {
          setFaqs(faqsResult.value);
        }
        if (configResult.status === 'fulfilled') {
          const config = configResult.value;
          if (Array.isArray(config?.entreeOptions)) setEntreeOptions(config.entreeOptions);
          if (config?.rsvp) setRsvpSettings(config.rsvp);
        }
        for (const result of [scheduleResult, faqsResult, configResult]) {
          if (result.status === 'rejected') console.error(result.reason);
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <WeddingDataContext.Provider value={{ schedule, faqs, entreeOptions, rsvpSettings, isLoading }}>
      {children}
    </WeddingDataContext.Provider>
  );
}

export function useWeddingData() {
  const context = useContext(WeddingDataContext);
  if (!context) throw new Error('useWeddingData must be used within WeddingDataProvider');
  return context;
}
