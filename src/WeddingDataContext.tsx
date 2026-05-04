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
    Promise.all([
      fetch('/api/schedule').then((r) => r.json()),
      fetch('/api/faqs').then((r) => r.json()),
      fetch('/api/config').then((r) => r.json()),
    ])
      .then(([scheduleData, faqsData, configData]) => {
        setSchedule(scheduleData);
        setFaqs(faqsData);
        setEntreeOptions(configData.entreeOptions);
        setRsvpSettings(configData.rsvp);
      })
      .catch(console.error)
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
