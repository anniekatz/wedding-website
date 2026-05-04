import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { RSVP } from './pages/RSVP';
import { Schedule } from './pages/Schedule';
import { FAQs } from './pages/FAQs';
import { Dashboard } from './pages/Dashboard';
import './index.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="rsvp" element={<RSVP />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="faqs" element={<FAQs />} />
          <Route path="dashboard" element={<Dashboard />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
