/// <reference types="vite/client" />

declare module '*.PNG' {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  // dates
  readonly VITE_WEDDING_DATE: string;
  readonly VITE_RSVP_CUTOFF_DATE: string;

  // couple
  readonly VITE_PERSON1_FIRST_NAME: string;
  readonly VITE_PERSON1_SHORT_NAME: string;
  readonly VITE_PERSON1_PHONE: string;
  readonly VITE_PERSON2_FIRST_NAME: string;
  readonly VITE_PERSON2_SHORT_NAME: string;
  readonly VITE_PERSON2_PHONE: string;

  // arrival
  readonly VITE_ARRIVAL_TIME: string;

  // venue
  readonly VITE_VENUE_NAME: string;
  readonly VITE_VENUE_CITY: string;
  readonly VITE_VENUE_ADDRESS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
