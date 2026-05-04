import { useWeddingData } from '../WeddingDataContext';
import styles from './Schedule.module.css';

export function Schedule() {
  const { schedule: events, isLoading } = useWeddingData();

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <div className="container">
        <h1>Schedule</h1>
        <p className={styles.loading}>Loading schedule...</p>
      </div>
    );
  }

  const weddingDate = events.length > 0 ? formatDate(events[0].time) : '';

  return (
    <div className="container">
      <h1>Schedule</h1>
      {weddingDate && <p className={styles.date}>{weddingDate}</p>}

      <div className={styles.timeline}>
        {events.map((event, index) => (
          <div key={event.id} className={styles.event}>
            <div className={styles.timeCol}>
              <span className={styles.time}>{formatTime(event.time)}</span>
              {event.endTime && (
                <span className={styles.endTime}>
                  - {formatTime(event.endTime)}
                </span>
              )}
            </div>

            <div className={styles.connector}>
              <div className={styles.dot}></div>
              {index < events.length - 1 && <div className={styles.line}></div>}
            </div>

            <div className={styles.content}>
              <h3>{event.name}</h3>
              <p className={styles.location}>{event.location}</p>
              {event.description && (
                <p className={styles.description}>{event.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.notes}>
        <h3>Additional Information</h3>
        <ul>
          <li>Complimentary valet parking is available on-site. Parking may take some time.</li>
          <li>The ceremony will be held outdoors, weather permitting.</li>
          <li>Cocktail attire is suggested.</li>
        </ul>
      </div>
    </div>
  );
}
