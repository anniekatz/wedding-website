import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate } from '../utils/dates';
import { useWeddingData } from '../WeddingDataContext';
import styles from './RSVP.module.css';

interface Guest {
  id: number;
  firstName: string;
  lastName: string;
  type: 'adult' | 'child';
  attending: boolean | null;
  comments: string | null;
  entreeChoice: string | null;
}

interface Household {
  id: number;
  name: string;
  allowPlusOne: boolean;
  reminderEmail: string | null;
}

interface PlusOne {
  firstName: string;
  lastName: string;
  attending: boolean;
  comments: string;
  entreeChoice: string;
}

interface HouseholdData {
  household: Household;
  guests: Guest[];
  plusOne: PlusOne | null;
}

interface GuestRsvp {
  id: number;
  attending: boolean;
  comments: string;
  entreeChoice: string;
}

export function RSVP() {
  const [lookupType, setLookupType] = useState<'code' | 'name'>('name');
  const [inviteCode, setInviteCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [householdData, setHouseholdData] = useState<HouseholdData | null>(null);
  const [guestRsvps, setGuestRsvps] = useState<GuestRsvp[]>([]);
  const [plusOne, setPlusOne] = useState<PlusOne>({
    firstName: '',
    lastName: '',
    attending: false,
    comments: '',
    entreeChoice: '',
  });
  const [bringingPlusOne, setBringingPlusOne] = useState(false);

  const [wantsReminder, setWantsReminder] = useState(false);
  const [reminderEmail, setReminderEmail] = useState('');

  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [showModifyPrompt, setShowModifyPrompt] = useState(false);

  const { rsvpSettings, entreeOptions } = useWeddingData();
  const displayCutoffDate = import.meta.env.VITE_RSVP_CUTOFF_DATE || null;

  //admins can disable invite code lookup
  const allowCodeLookup = rsvpSettings?.codeLookupEnabled ?? true;
  const activeLookupType = allowCodeLookup ? lookupType : 'name';

  function getEntreeOptions(guestType: 'adult' | 'child') {
    return entreeOptions.filter(
      (o) => o.availableFor === 'both' || o.availableFor === guestType,
    );
  }

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError('');
    setIsLoading(true);

    try {
      const params = new URLSearchParams();
      if (activeLookupType === 'code') {
        params.set('code', inviteCode.trim());
      } else {
        params.set('firstName', firstName.trim());
        params.set('lastName', lastName.trim());
      }

      const lookupRes = await fetch(`/api/household/lookup?${params}`);
      if (!lookupRes.ok) {
        const data = await lookupRes.json();
        throw new Error(data.error || 'Invitation not found');
      }

      const { householdId } = await lookupRes.json();
      const householdRes = await fetch(`/api/household/${householdId}`);
      if (!householdRes.ok) {
        throw new Error('Failed to load household data');
      }

      const data: HouseholdData = await householdRes.json();
      setHouseholdData(data);

      // guest RSVPs
      // preselect the kids meal for kids on a first-time rsvp
      const childDefaultEntree =
        entreeOptions.find((o) => o.availableFor === 'child')?.value ?? '';
      const hasExistingRsvp = data.guests.some((g) => g.attending !== null);
      setGuestRsvps(
        data.guests.map((g) => ({
          id: g.id,
          attending: g.attending ?? true,
          comments: g.comments || '',
          entreeChoice: g.entreeChoice || (!hasExistingRsvp && g.type === 'child' ? childDefaultEntree : ''),
        }))
      );

      // plus ones
      if (data.plusOne) {
        setPlusOne({
          firstName: data.plusOne.firstName,
          lastName: data.plusOne.lastName,
          attending: data.plusOne.attending,
          comments: data.plusOne.comments || '',
          entreeChoice: data.plusOne.entreeChoice || '',
        });
        setBringingPlusOne(hasExistingRsvp ? data.plusOne.attending : true);
      } else if (data.household.allowPlusOne && !hasExistingRsvp) {
        setPlusOne({
          firstName: data.household.name,
          lastName: '+ 1',
          attending: true,
          comments: '',
          entreeChoice: '',
        });
        setBringingPlusOne(true);
      }

      // reminder email
      if (data.household.reminderEmail) {
        setWantsReminder(true);
        setReminderEmail(data.household.reminderEmail);
      }

      // has household already submitted an RSVP?
      if (hasExistingRsvp) {
        setShowModifyPrompt(true);
      }
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestChange = (
    guestId: number,
    field: 'attending' | 'comments' | 'entreeChoice',
    value: boolean | string
  ) => {
    setGuestRsvps((prev) =>
      prev.map((g) => (g.id === guestId ? { ...g, [field]: value } : g))
    );
  };

  // if left blank, the plus one default to "{household.name} + 1" 
  const applyPlusOneDefaultName = () => {
    setPlusOne((p) =>
      p.firstName.trim() || p.lastName.trim()
        ? p
        : { ...p, firstName: householdData!.household.name, lastName: '+ 1' }
    );
  };

  const handleBringPlusOne = () => {
    setBringingPlusOne(true);
    applyPlusOneDefaultName();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');

    // everybody coming needs an entree
    for (const rsvp of guestRsvps) {
      const guest = householdData!.guests.find((g) => g.id === rsvp.id);
      if (!guest) continue;
      if (rsvp.attending && !rsvp.entreeChoice && getEntreeOptions(guest.type).length > 0) {
        setSubmitError(`Please select an entree for ${guest.firstName}.`);
        return;
      }
    }
    let plusOnePayload = { ...plusOne, attending: bringingPlusOne };
    if (bringingPlusOne) {
      const first = plusOne.firstName.trim();
      const last = plusOne.lastName.trim();
      if (!first && !last) {
        const defaults = {
          firstName: householdData!.household.name,
          lastName: '+ 1',
        };
        plusOnePayload = { ...plusOnePayload, ...defaults };
        setPlusOne((p) => ({ ...p, ...defaults }));
      } else if (!first || !last) {
        setSubmitError(
          `Please fill in both first and last name. If unsure, leave both boxes blank to have their namecard read "${householdData!.household.name} + 1".`
        );
        return;
      }
    }
    if (bringingPlusOne && !plusOne.entreeChoice && getEntreeOptions('adult').length > 0) {
      setSubmitError('Please select an entree for your guest.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          householdId: householdData!.household.id,
          guests: guestRsvps,
          plusOne: householdData!.household.allowPlusOne
            ? plusOnePayload
            : undefined,
          reminderEmail: wantsReminder ? reminderEmail : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to submit RSVP');
      }

      setSubmitSuccess(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setHouseholdData(null);
    setGuestRsvps([]);
    setPlusOne({ firstName: '', lastName: '', attending: false, comments: '', entreeChoice: '' });
    setBringingPlusOne(false);
    setWantsReminder(false);
    setReminderEmail('');
    setSubmitSuccess(false);
    setShowModifyPrompt(false);
    setInviteCode('');
    setFirstName('');
    setLastName('');
  };

  const handleProceedToForm = () => {
    setShowModifyPrompt(false);
  };

  if (submitSuccess) {
    return (
      <div className="container">
        <div className={styles.successCard}>
          <div className={styles.checkmark}>&#10003;</div>
          <h2>Thank You!</h2>
          <p>Your RSVP has been submitted successfully.</p>
          <p className={styles.small}>We can't wait to celebrate with you!</p>
          {displayCutoffDate && (
            <p className={styles.small}>
              If needed, you may modify your reservation up until {formatDate(displayCutoffDate)}.
            </p>
          )}
          <div className={styles.successActions}>
            <Link to="/schedule" className="button">
              View Schedule
            </Link>
            <Link to="/faqs" className="button secondary">
              View FAQs
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (showModifyPrompt && householdData) {
    const attendingGuests = householdData.guests.filter(g => g.attending === true);
    const decliningGuests = householdData.guests.filter(g => g.attending === false);
    const isLocked = rsvpSettings?.isLocked ?? false;

    return (
      <div className="container">
        <div className={styles.modifyCard}>
          <h2>{isLocked ? 'Your Reservation' : "You've Already RSVP'd"}</h2>
          <p>We found an existing reservation for <strong>{householdData.household.name}</strong>.</p>
          {isLocked ? (
            <p className={styles.small + ' ' + styles.lockedMessage}>
              RSVPs are now closed. Your reservation cannot be modified.
            </p>
          ) : (
            <p className={styles.small}>Would you like to modify your current reservation?</p>
          )}

          <div className={styles.reservationSummary}>
            <h3>Current Reservation</h3>
            {attendingGuests.length > 0 && (
              <div className={styles.summarySection}>
                <h4>Attending</h4>
                {attendingGuests.map(guest => (
                  <div key={guest.id} className={styles.summaryItem}>
                    <span>{guest.firstName} {guest.lastName}</span>
                    {guest.entreeChoice && (
                      <span className={styles.entreeBadge}>
                        {entreeOptions.find(o => o.value === guest.entreeChoice)?.label ?? guest.entreeChoice}
                      </span>
                    )}
                    {guest.comments && (
                      <span className={styles.comments}>({guest.comments})</span>
                    )}
                  </div>
                ))}
                {householdData.plusOne?.attending && (
                  <div className={styles.summaryItem}>
                    <span>{householdData.plusOne.firstName} {householdData.plusOne.lastName}</span>
                    <span className={styles.plusOneBadge}>+1</span>
                    {householdData.plusOne.entreeChoice && (
                      <span className={styles.entreeBadge}>
                        {entreeOptions.find(o => o.value === householdData.plusOne!.entreeChoice)?.label ?? householdData.plusOne!.entreeChoice}
                      </span>
                    )}
                    {householdData.plusOne.comments && (
                      <span className={styles.comments}>({householdData.plusOne.comments})</span>
                    )}
                  </div>
                )}
              </div>
            )}
            {decliningGuests.length > 0 && (
              <div className={styles.summarySection}>
                <h4>Not Attending</h4>
                {decliningGuests.map(guest => (
                  <div key={guest.id} className={styles.summaryItem}>
                    <span className={styles.declined}>{guest.firstName} {guest.lastName}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.modifyActions}>
            <button onClick={resetForm} className="secondary">
              Go Back
            </button>
            {!isLocked && (
              <button onClick={handleProceedToForm}>
                Modify Reservation
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!householdData) {
    return (
      <div className="container">
        <h1>RSVP</h1>
        <p>Find your invitation to respond for your party. Please RSVP for every member of your party.</p>

        {displayCutoffDate && (
          <div className={rsvpSettings?.isLocked ? styles.deadlineNotice + ' ' + styles.locked : styles.deadlineNotice}>
            {rsvpSettings?.isLocked ? (
              <p>RSVPs are now closed. You can still view your reservation below if you made one.</p>
            ) : (
              <p>Please RSVP by <strong>{formatDate(displayCutoffDate)}</strong>.</p>
            )}
          </div>
        )}

        {allowCodeLookup && (
          <div className={styles.lookupToggle}>
            <button
              type="button"
              className={`${styles.toggleBtn} ${lookupType === 'name' ? styles.active : ''}`}
              aria-pressed={lookupType === 'name'}
              onClick={() => setLookupType('name')}
            >
              Search by Name
            </button>
            <button
              type="button"
              className={`${styles.toggleBtn} ${lookupType === 'code' ? styles.active : ''}`}
              aria-pressed={lookupType === 'code'}
              onClick={() => setLookupType('code')}
            >
              Enter Code
            </button>
          </div>
        )}

        <form onSubmit={handleLookup} className="card">
          {activeLookupType === 'code' ? (
            <div className="form-group">
              <label htmlFor="code">Invitation Code</label>
              <input
                id="code"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Enter your invitation code"
                required
              />
            </div>
          ) : (
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="firstName">First Name</label>
                <input
                  id="firstName"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Your first name"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="lastName">Last Name</label>
                <input
                  id="lastName"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Your last name"
                  required
                />
              </div>
            </div>
          )}

          {lookupError && <p className="error-message">{lookupError}</p>}

          <button type="submit" className={styles.findBtn} disabled={isLoading}>
            {isLoading ? 'Searching...' : 'Find Invitation'}
          </button>
        </form>
      </div>
    );
  }

  // RSVPs locked
  if (rsvpSettings?.isLocked) {
    return (
      <div className="container">
        <div className={styles.modifyCard}>
          <h2>RSVPs Are Closed</h2>
          <p>We're sorry, but the RSVP deadline has passed.</p>
          <p className={styles.small}>
            If you need to make changes to your reservation, please contact the couple directly.
          </p>
          <div className={styles.modifyActions}>
            <button onClick={resetForm} className="secondary">
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>RSVP</h1>
      <p>
        Responding for: <strong>{householdData.household.name}</strong>
      </p>

      {displayCutoffDate && (
        <div className={styles.deadlineNotice}>
          <p>Please submit your RSVP by <strong>{formatDate(displayCutoffDate)}</strong>.</p>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {householdData.guests.map((guest) => {
          const rsvp = guestRsvps.find((g) => g.id === guest.id);
          if (!rsvp) return null;

          return (
            <div key={guest.id} className="card">
              <h3>
                {guest.firstName} {guest.lastName}
                {guest.type === 'child' && (
                  <span className={styles.badge}>Child</span>
                )}
              </h3>

              <div className={styles.attendingToggle}>
                <button
                  type="button"
                  className={`${styles.attendBtn} ${rsvp.attending ? styles.yes : ''}`}
                  aria-pressed={rsvp.attending}
                  onClick={() => handleGuestChange(guest.id, 'attending', true)}
                >
                  Joyfully Accepts
                </button>
                <button
                  type="button"
                  className={`${styles.attendBtn} ${!rsvp.attending ? styles.no : ''}`}
                  aria-pressed={!rsvp.attending}
                  onClick={() => handleGuestChange(guest.id, 'attending', false)}
                >
                  Regretfully Declines
                </button>
              </div>

              {rsvp.attending && (
                <>
                  <div className={styles.entreeSection}>
                    <label>Entree Selection</label>
                    <div className={styles.entreeToggle}>
                      {getEntreeOptions(guest.type).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`${styles.entreeBtn} ${rsvp.entreeChoice === option.value ? styles.selected : ''}`}
                          aria-pressed={rsvp.entreeChoice === option.value}
                          onClick={() => handleGuestChange(guest.id, 'entreeChoice', option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor={`comments-${guest.id}`}>
                      Comments (optional)
                    </label>
                    <textarea
                      id={`comments-${guest.id}`}
                      className={styles.commentsBox}
                      rows={3}
                      value={rsvp.comments}
                      onChange={(e) =>
                        handleGuestChange(guest.id, 'comments', e.target.value)
                      }
                      placeholder="Any comments, concerns, song requests, or dietary restrictions? If you have any dietary restrictions (vegan, gluten-free, allergies), please let us know here and our caterer can accommodate you!"
                    />
                  </div>
                </>
              )}
            </div>
          );
        })}

        {householdData.household.allowPlusOne && (
          <div className="card">
            <h3>Plus One</h3>
            <p className={styles.small}>You are welcome to bring a guest. Please select "Not Bringing" if you do not intend to bring a Plus One.</p>

            <div className={styles.attendingToggle}>
              <button
                type="button"
                className={`${styles.attendBtn} ${bringingPlusOne ? styles.yes : ''}`}
                aria-pressed={bringingPlusOne}
                onClick={handleBringPlusOne}
              >
                Bringing a Guest
              </button>
              <button
                type="button"
                className={`${styles.attendBtn} ${!bringingPlusOne ? styles.no : ''}`}
                aria-pressed={!bringingPlusOne}
                onClick={() => setBringingPlusOne(false)}
              >
                Not Bringing
              </button>
            </div>

            {bringingPlusOne && (
              <>
                <p className={styles.small}>
                  You can leave the guest name as "{householdData.household.name} + 1" if you're not sure who you're bringing yet.
                </p>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="plusOneFirst">Guest First Name</label>
                    <input
                      id="plusOneFirst"
                      type="text"
                      value={plusOne.firstName}
                      onChange={(e) =>
                        setPlusOne((p) => ({ ...p, firstName: e.target.value }))
                      }
                      onBlur={applyPlusOneDefaultName}
                      placeholder="First name"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="plusOneLast">Guest Last Name</label>
                    <input
                      id="plusOneLast"
                      type="text"
                      value={plusOne.lastName}
                      onChange={(e) =>
                        setPlusOne((p) => ({ ...p, lastName: e.target.value }))
                      }
                      onBlur={applyPlusOneDefaultName}
                      placeholder="Last name"
                    />
                  </div>
                </div>
                <div className={styles.entreeSection}>
                  <label>Entree Selection</label>
                  <div className={styles.entreeToggle}>
                    {getEntreeOptions('adult').map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`${styles.entreeBtn} ${plusOne.entreeChoice === option.value ? styles.selected : ''}`}
                        aria-pressed={plusOne.entreeChoice === option.value}
                        onClick={() => setPlusOne((p) => ({ ...p, entreeChoice: option.value }))}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="plusOneComments">
                    Comments (optional)
                  </label>
                  <textarea
                    id="plusOneComments"
                    className={styles.commentsBox}
                    rows={3}
                    value={plusOne.comments}
                    onChange={(e) =>
                      setPlusOne((p) => ({ ...p, comments: e.target.value }))
                    }
                    placeholder="Any comments, concerns, song requests, or dietary restrictions? If you have any dietary restrictions (vegan, gluten-free, allergies), please let us know here and our caterer can accommodate you!"
                  />
                </div>
              </>
            )}
          </div>
        )}

        <div className="card">
          <div className={styles.reminderSection}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={wantsReminder}
                onChange={(e) => {
                  setWantsReminder(e.target.checked);
                  if (!e.target.checked) {
                    setReminderEmail('');
                  }
                }}
              />
              <span>Would you like an email reminder two weeks before the wedding?</span>
            </label>

            {wantsReminder && (
              <div className="form-group">
                <label htmlFor="reminderEmail">Email Address</label>
                <input
                  id="reminderEmail"
                  type="email"
                  value={reminderEmail}
                  onChange={(e) => setReminderEmail(e.target.value)}
                  placeholder="your@email.com"
                  required={wantsReminder}
                />
              </div>
            )}
          </div>
        </div>

        {submitError && <p className="error-message">{submitError}</p>}

        <div className={styles.formActions}>
          <button type="button" className="secondary" onClick={resetForm}>
            Start Over
          </button>
          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Submitting...' : 'Submit RSVP'}
          </button>
        </div>
      </form>
    </div>
  );
}
