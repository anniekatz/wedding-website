# Wedding Website

Full-stack wedding website with RSVP management, event schedule, and FAQ pages. Built for my wedding :)
Built with Typescript, React 19, Vite, NodeJS, Express, Drizzle, and SQLite

## Project Structure

```
├── src/                        
│   ├── assets/                 # Decorative cherub images
│   ├── components/
│   │   ├── Layout.tsx          # navbar, page outlet, footer
│   │   └── Navbar.tsx          # nav links, logo, theme toggle
│   ├── pages/
│   │   ├── Home.tsx            # landing page
│   │   ├── RSVP.tsx            # guest lookup + RSVP form
│   │   ├── Schedule.tsx        # event timeline
│   │   ├── FAQs.tsx            # accordion FAQ list
│   │   └── Dashboard.tsx       # admin login + RSVP dashboard
│   ├── utils/dates.ts          # date formatting helper
│   ├── auth-client.ts          # frontend admin auth helpers
│   ├── App.tsx                 
│   ├── ThemeContext.tsx         # dark/light theme provider
│   ├── WeddingDataContext.tsx   # fetches schedule, FAQs, meal entrees, RSVP settings
│   ├── main.tsx                
│   └── index.css               
├── server/                     
│   ├── db/
│   │   ├── schema.ts           # drizzle table defs
│   │   └── index.ts            # DB init
|   |   |-- seed.ts             # seed data 
│   ├── routes/
│   │   ├── household.ts        # guest lookup & household endpoints
│   │   ├── rsvp.ts             # RSVP submissions
│   │   ├── schedule.ts         # schedule events
│   │   ├── faqs.ts             # FAQ items
│   │   ├── config.ts           # RSVP settings + entree options
│   │   └── admin.ts            # admin login/session/dashboard endpoints
│   ├── auth.ts                 # admin password/session auth helpers
│   ├── config.ts               # RSVP cutoff date logic
│   └── index.ts                # express setup
├── .env.example                # template to copy to .env
├── vite.config.ts              
├── drizzle.config.ts           
└── package.json
```

---

## Setup Guide

### Prerequisites

- **Node.js (& npm)** v18 or later

### 1. After cloning, configure the `.env` file

Copy the .env.example to .env and fill in your details.

```env
# ── Dates ──────────────────────────────────────────────────
# ISO format: YYYY-MM-DD
VITE_WEDDING_DATE=2025-10-15
VITE_RSVP_CUTOFF_DATE=2025-08-15      # deadline shown to guests
RSVP_CUTOFF_DATE=2025-08-16           # when RSVPs actually lock (grace period)

# ── Couple ─────────────────────────────────────────────────
VITE_PERSON1_FIRST_NAME=Alex          # full first name on home page
VITE_PERSON1_SHORT_NAME=Alex          # nickname
VITE_PERSON1_PHONE=555-123-4567       # shown on the FAQs contact section

VITE_PERSON2_FIRST_NAME=Jordan
VITE_PERSON2_SHORT_NAME=Jordan
VITE_PERSON2_PHONE=555-987-6543

# ── Venue ──────────────────────────────────────────────────
VITE_VENUE_NAME=The Grand Ballroom
VITE_VENUE_CITY=Austin, TX            # shown on hero section
VITE_VENUE_ADDRESS=123 Main St, Austin, TX 78701

# ── Misc ───────────────────────────────────────────────────
VITE_ARRIVAL_TIME=5:00 - 5:30 PM      # displayed on home page detail card

# ── Admin dashboard ────────────────────────────────────────
# recommended: don't use .env in production. Use a secrets manager or related.

ADMIN_USERNAME=admin                  
ADMIN_PASSWORD=change-me             
TRUSTED_ORIGINS=http://localhost:5173,http://localhost:3001
```

> **Note:** `VITE_RSVP_CUTOFF_DATE` is the deadline displayed to guests (embedded in the frontend bundle at build time), while `RSVP_CUTOFF_DATE` is when the backend actually locks RSVPs. Set the backend date a day (or more) later than the displayed date to give guests a quiet grace period, or set them equal for no grace period.

> **Admin note:** `ADMIN_USERNAME` and `ADMIN_PASSWORD` are only used when the `admin_users` table is empty. After the first admin user is created, changing those env values will not change the saved login. For production, set `NODE_ENV=production` so the admin session cookie uses the secure flag.

### 2. Add your guest list and wedding content

All other content for your wedding (guests, schedule events, menu options, FAQs) is in the database. The database is seeded automatically the first time you start the server. To customize it, edit `server/db/seed.ts`.

#### Households and guests

Each invited party is a **household**. A household has an invite code, a display name, and one or more guests. This is like sending one invitation to a family or inviting someone and allowing them to bring a plus 1. 

```ts

//example of a family
const smithFamily = await db.insert(households).values({
  inviteCode: 'SMITH2024',          
  name: 'The Smith Family',         
  allowPlusOne: false,
}).returning();

// example of adding guests for that family
await db.insert(guests).values([
  {
    householdId: smithFamily[0].id,
    firstName: 'John',
    lastName: 'Smith',
    nickname: 'Johnny, JJ',         // comma separated nicknames. If they decide they want to use their nickname to search for their invite code.
    type: 'adult',
  },
  {
    householdId: smithFamily[0].id,
    firstName: 'Jane',
    lastName: 'Smith',
    type: 'adult',
  },
  {
    householdId: smithFamily[0].id,
    firstName: 'Tommy',
    lastName: 'Smith',
    type: 'child',                   // children see the kids meal option and have it checked by default
  },
]);

// A single guest with a plus-one
const solo = await db.insert(households).values({
  inviteCode: 'MIKE2024',
  name: 'Mike Johnson',
  allowPlusOne: true,                // guest can bring +1
}).returning();

await db.insert(guests).values({
  householdId: solo[0].id,
  firstName: 'Mike',
  lastName: 'Johnson',
  type: 'adult',
});
```

#### Schedule events

```ts
await db.insert(scheduleEvents).values([
  {
    name: 'Guest Arrival',
    time: '2025-10-15T17:00:00',        // ISO datetime
    endTime: '2025-10-15T17:30:00',     // optional
    location: 'Main Entrance',
    description: 'Please arrive through the south doors.',  // optional
    order: 1,                           // display order
  },
  {
    name: 'Ceremony',
    time: '2025-10-15T18:00:00',
    endTime: '2025-10-15T18:30:00',
    location: 'Garden Pavilion',
    description: null,
    order: 2,
  },
  // ... add as many events as you need
]);
```

#### Entree options

```ts
await db.insert(entreeOptions).values([
  { value: 'steak',    label: 'Filet Mignon',         availableFor: 'both',  order: 1 },
  { value: 'salmon',   label: 'Grilled Salmon',       availableFor: 'both',  order: 2 },
  { value: 'risotto',  label: 'Mushroom Risotto (V)',  availableFor: 'both',  order: 3 },
  { value: 'kidsmeal', label: 'Kids Meal',             availableFor: 'child', order: 0 },
]);
```

- **`availableFor`**: `'adult'` | `'child'` | `'both'`. Children only see options marked `'child'` or `'both'`. Adults only see `'adult'` or `'both'`.

#### FAQs

```ts
await db.insert(faqs).values([
  {
    question: 'What should I wear?',
    answer: 'Whatever you want. Maybe avoid white dresses.',
    order: 1,
  },
  {
    question: 'Is it open bar?',
    answer: 'Obviously.',
    order: 2,
  },
  // etc.
]);
```

### 3. Customize hardcoded content

A few pieces of content are hardcoded in the src. You'll wanna update these:

**Schedule page notes** (`src/pages/Schedule.tsx`):
```tsx
<ul>
  <li>Complimentary valet parking is available on-site.</li>
  <li>The ceremony will be held outdoors, weather permitting.</li>
  <li>Cocktail attire is suggested.</li>
</ul>
```
Replace these with notes relevant to your wedding.

**Decorative images** (`src/assets/`):
The home page displays two decorative cherub images. Replace `cherub_left.PNG` and `cherub_right.PNG` with your own images, or remove the `<img>` tags from `src/pages/Home.tsx` (lines 17-18) to remove them entirely.

### 4. Look and feel

#### Colors

The color theme is defined in `src/index.css`. The dark theme is defined under `:root` and the light theme under `[data-theme="light"]`. 

#### Fonts

To change fonts, update the `@import` URL at the top of `index.css` and all the `font-family` declarations.

Fonts loaded by default:
- **Cinzel** for headings, buttons, labels
- **Spectral** for body text
- **Cormorant** for decorative (couple names on home page)
- **Cormorant Garamond** for footer credit

## RSVP System Details

### How guest lookup works

Guests can find their invitation two ways:

1. **Invite code**: matched case-insensitively against the `invite_code` column in `households`.
2. **First + last name**: both names are normalized (case, punctuation, and accents are ignored) and compared against all guests. The `nickname` field is also checked so if a guest's nickname is "Johnny, JJ", searching for "JJ Smith" will find them. If the same name matches guests in more than one household, the lookup asks the guest to use their invite code instead of guessing.

### RSVP locking

The `RSVP_CUTOFF_DATE` env variable controls when RSVPs actually close on the backend. The deadline guests see ("please RSVP by \<date\>") comes from `VITE_RSVP_CUTOFF_DATE` (which can be set a few days earlier, etc. to build in a grace period if you want).
- The RSVP form shows a "RSVPs are now closed" message
- Guests can still look up and view their existing reservation, but can't modify it.

### Audit log

Every RSVP submission (initial or modification) is logged to the `rsvp_logs` table with:
- The household ID
- Whether it was an `initial_rsvp` or `modification`
- A timestamp

## Admin Dashboard

The admin dashboard lives at `/dashboard`. It has a username/password login and shows RSVP data:

- Headline stats: attending (adults / children / plus-ones), declined, awaiting households, and per-entrée meal counts for the caterer
- Guests who are attending/declined
- Households still awaiting a response, including partial responses ("1 of 3 responded")
- The RSVP activity log with a readable summary of each submission (raw snapshot expandable)
- A search box to filter every table by guest, household, or invite code

## Database Schema

| Table            | Purpose                                                |
| ---------------- | ------------------------------------------------------ |
| `households`     | Invited parties (invite code, name, plus-one flag)     |
| `guests`         | Individual people within a household                   |
| `plus_ones`      | Plus-one guests                                        |
| `schedule_events` | Timeline events shown on the Schedule page            |
| `entree_options` | Menu choices available on the RSVP form                |
| `faqs`           | Questions and answers for the FAQ page                 |
| `rsvp_logs`      | Audit trail of every RSVP submission                   |
| `admin_users`    | Admin usernames and hashed passwords                   |
| `admin_sessions` | Admin session tokens and expiration timestamps         |

---

## Endpoints

| Method | Endpoint                     | Description                            |
| ------ | ---------------------------- | -------------------------------------- |
| GET    | `/api/health`                | Health check                           |
| GET    | `/api/household/lookup`      | Find household by `?code=` or `?firstName=&lastName=` |
| GET    | `/api/household/:id`         | Get household with all guests          |
| GET    | `/api/schedule`              | Get all schedule events (ordered)      |
| GET    | `/api/faqs`                  | Get all FAQs (ordered)                 |
| GET    | `/api/config`                | Get RSVP settings and entree options     |
| GET    | `/api/rsvp/settings`         | Get RSVP lock status                   |
| POST   | `/api/rsvp`                  | Submit or modify an RSVP               |
| POST   | `/api/admin/login`           | Sign in to the admin dashboard         |
| POST   | `/api/admin/logout`          | Sign out and destroy the admin session |
| GET    | `/api/admin/me`              | Get the current admin session          |
| GET    | `/api/admin/dashboard`       | Get dashboard RSVP data (admin only)   |
