import { useState } from 'react';
import { useWeddingData } from '../WeddingDataContext';
import styles from './FAQs.module.css';

export function FAQs() {
  const { faqs, isLoading } = useWeddingData();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const p1Short = import.meta.env.VITE_PERSON1_SHORT_NAME;
  const p2Short = import.meta.env.VITE_PERSON2_SHORT_NAME;

  const toggleFaq = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  if (isLoading) {
    return (
      <div className="container">
        <h1>FAQs</h1>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>FAQs</h1>

      <div className={styles.faqList}>
        {faqs.map((faq, index) => (
          <div
            key={faq.id}
            className={`${styles.faqItem} ${openIndex === index ? styles.open : ''}`}
          >
            <button
              className={styles.question}
              onClick={() => toggleFaq(index)}
              aria-expanded={openIndex === index}
            >
              <span>{faq.question}</span>
              <span className={styles.icon}>{openIndex === index ? '−' : '+'}</span>
            </button>
            <div className={styles.answer}>
              <div className={styles.answerInner}>
                <p>{faq.answer}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.contact}>
        <h3>Still have questions?</h3>
        <p className={styles.note}>Call or text us!</p>
        <p>{p2Short}: {import.meta.env.VITE_PERSON2_PHONE}</p>
        <p>{p1Short}: {import.meta.env.VITE_PERSON1_PHONE}</p>
      </div>
    </div>
  );
}
