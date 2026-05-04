import { NavLink } from 'react-router-dom';
import { useTheme } from '../ThemeContext';
import styles from './Navbar.module.css';

export function Navbar() {
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className={styles.navbar}>
      <div className={styles.container}>
        <NavLink to="/" className={styles.logo}>
          {import.meta.env.VITE_PERSON2_FIRST_NAME[0]} <span className={styles.ampersand}>&</span> {import.meta.env.VITE_PERSON1_FIRST_NAME[0]}
        </NavLink>
        <div className={styles.links}>
          <NavLink
            to="/"
            className={({ isActive }) =>
              isActive ? `${styles.link} ${styles.active}` : styles.link
            }
          >
            Home
          </NavLink>
          <NavLink
            to="/rsvp"
            className={({ isActive }) =>
              isActive ? `${styles.link} ${styles.active}` : styles.link
            }
          >
            RSVP
          </NavLink>
          <NavLink
            to="/schedule"
            className={({ isActive }) =>
              isActive ? `${styles.link} ${styles.active}` : styles.link
            }
          >
            Schedule
          </NavLink>
          <NavLink
            to="/faqs"
            className={({ isActive }) =>
              isActive ? `${styles.link} ${styles.active}` : styles.link
            }
          >
            FAQs
          </NavLink>
          <button
            className={styles.themeToggle}
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '☀' : '☽'}
          </button>
        </div>
      </div>
    </nav>
  );
}
