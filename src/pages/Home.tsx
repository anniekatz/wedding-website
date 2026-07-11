import { Link } from 'react-router-dom';
import styles from './Home.module.css';
import cherubLeft from '../assets/cherub_left.PNG';
import cherubRight from '../assets/cherub_right.PNG';
import { formatDate } from '../utils/dates';

export function Home() {
  const p1 = import.meta.env.VITE_PERSON1_FIRST_NAME;
  const p2 = import.meta.env.VITE_PERSON2_FIRST_NAME;
  const p1Short = import.meta.env.VITE_PERSON1_SHORT_NAME;
  const p2Short = import.meta.env.VITE_PERSON2_SHORT_NAME;
  const rsvpCutoff = formatDate(import.meta.env.VITE_RSVP_CUTOFF_DATE);

  return (
    <div className={`container ${styles.homeContainer}`}>
      <img src={cherubLeft} alt="" className={styles.cherubLeft} />
      <img src={cherubRight} alt="" className={styles.cherubRight} />
      <div className={styles.hero}>
        <p className={styles.preTitle}>You're invited to the wedding of</p>
        <h1 className={styles.names}>
          <span className={styles.name}>{p1}</span>
          <span className={styles.ampersand}>&</span>
          <span className={styles.name}>{p2}</span>
        </h1>
        <p className={styles.date}>{formatDate(import.meta.env.VITE_WEDDING_DATE, 'full')}</p>
        <p className={styles.location}>{import.meta.env.VITE_VENUE_NAME}</p>
        <p className={styles.location}>{import.meta.env.VITE_VENUE_CITY}</p>
      </div>

      <div className={styles.content}>
        <p className={styles.message}>
          We're getting married and we want you there!
          Browse our website to view the event schedule, read through our FAQ, and RSVP. Please RSVP by {rsvpCutoff} so we can finalize the details. See you soon!<br />
          - {p1Short} & {p2Short}
        </p>

        <div className={styles.actions}>
          <Link to="/rsvp" className={`${styles.actionButton} ${styles.primaryButton}`}>
            RSVP Now
          </Link>
          <Link to="/schedule" className={`${styles.actionButton} ${styles.secondaryButton}`}>
            Schedule
          </Link>
        </div>
      </div>

      <div className={styles.details}>
        <div className={styles.detailCard}>
          <h3>Please arrive between</h3>
          <p className={styles.arriveTime}>{import.meta.env.VITE_ARRIVAL_TIME}</p>
          <p className={styles.venueName}>{import.meta.env.VITE_VENUE_NAME}</p>
          <p className={styles.venueAddress}>{import.meta.env.VITE_VENUE_ADDRESS}</p>
        </div>
      </div>
    </div>
  );
}
