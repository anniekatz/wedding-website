import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import styles from './Layout.module.css';

export function Layout() {
  return (
    <div className={styles.layout}>
      <Navbar />
      <main className={styles.main}>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        
        <div className={styles.container}>
          <p>Made by Annie.</p>
          <a href="https://github.com/anniekatz/wedding-website" target="_blank" rel="noopener noreferrer" className={styles.freeLink}>Open-source & free to use.</a>
        </div>
      </footer>
    </div>
  );
}
