import { db, sqlite } from './index.js';
import { adminUsers, households, guests, scheduleEvents, entreeOptions, faqs } from './schema.js';
import { hashPassword } from '../auth.js';

export async function seedDb() {
  // Sample households and guests
  const smithFamily = await db.insert(households).values({
    inviteCode: 'SMITH2024',
    name: 'The Smith Family',
    allowPlusOne: false,
    notes: 'Married couple with kids',
  }).returning();

  await db.insert(guests).values([
    { householdId: smithFamily[0].id, firstName: 'John', lastName: 'Smith', nickname: 'Johnny, JJ', type: 'adult' },
    { householdId: smithFamily[0].id, firstName: 'Jane', lastName: 'Smith', type: 'adult' },
    { householdId: smithFamily[0].id, firstName: 'Tommy', lastName: 'Smith', type: 'child' },
    { householdId: smithFamily[0].id, firstName: 'Sarah', lastName: 'Smith', type: 'child' },
  ]);

  const singleGuest = await db.insert(households).values({
    inviteCode: 'MIKE2024',
    name: 'Mike Johnson',
    allowPlusOne: true,
  }).returning();

  await db.insert(guests).values({
    householdId: singleGuest[0].id,
    firstName: 'Mike',
    lastName: 'Johnson',
    type: 'adult',
  });

  const wilsons = await db.insert(households).values({
    inviteCode: 'WILSON24',
    name: 'The Wilsons',
    allowPlusOne: false,
  }).returning();

  await db.insert(guests).values([
    { householdId: wilsons[0].id, firstName: 'Robert', lastName: 'Wilson', type: 'adult' },
    { householdId: wilsons[0].id, firstName: 'Emily', lastName: 'Wilson', type: 'adult' },
  ]);

  const singleNoPlus = await db.insert(households).values({
    inviteCode: 'CHEN2024',
    name: 'Lisa Chen',
    allowPlusOne: false,
  }).returning();

  await db.insert(guests).values({
    householdId: singleNoPlus[0].id,
    firstName: 'Lisa',
    lastName: 'Chen',
    type: 'adult',
  });

  // Sample schedule events
  await db.insert(scheduleEvents).values([
    {
      name: 'Guest Arrival',
      time: '2027-03-13T17:30:00',
      endTime: '2027-03-13T17:45:00',
      location: 'Museum of Fine Arts, St. Pete',
      description: 'Find the door with the "Annie and Nicholas" sign and head in.',
      order: 1,
    },
    {
      name: 'Ceremony',
      time: '2027-03-13T18:00:00',
      endTime: '2027-03-13T18:30:00',
      location: 'Membership Garden',
      description: 'The most pivotal moment of our lives... and the boring part for you, sorry.',
      order: 2,
    },
    {
      name: 'Cocktail Hour',
      time: '2027-03-13T18:30:00',
      endTime: '2027-03-13T19:30:00',
      location: 'Sculpture Garden',
      description: 'Enjoy drinks and appetizers amongst some sculptures and stuff.',
      order: 3,
    },
    {
      name: 'Reception',
      time: '2027-03-13T19:30:00',
      endTime: '2027-03-13T23:00:00',
      location: 'Marly Room',
      description: 'Food, drinks, dancing, more drinks, gladiator fights, cake.',
      order: 4,
    },
  ]);

  // Entree options
  await db.insert(entreeOptions).values([
    { value: 'shortrib', label: 'Shortrib', availableFor: 'both', order: 1 },
    { value: 'chicken', label: 'Chicken', availableFor: 'both', order: 2 },
    { value: 'eggplant', label: 'Eggplant (Vegan/GF)', availableFor: 'both', order: 3 },
    { value: 'kidsmeal', label: 'Kids Meal', availableFor: 'child', order: 0 },
  ]);

  // FAQs
  await db.insert(faqs).values([
    {
      question: 'When should I get there?',
      answer: 'Anytime between 5:45 and 6:00 PM is perfect; just make sure to be there before 6:00! The doors will be closing then as the ceremony starts at 6 PM.',
      order: 1,
    },
    {
      question: 'What should I wear?',
      answer: 'Cocktail attire! But make sure what you\'re wearing is comfortable enough for dancing :)',
      order: 2,
    },
    {
      question: 'What\'s the parking situation?',
      answer: 'A complimentary valet service is available at the venue. You may also utilize paid street parking or parking garages nearby. However, we recommend taking a taxi or Uber if you plan on taking advantage of the open bar!',
      order: 3,
    },
    {
      question: 'Will the ceremony be indoors or outdoors?',
      answer: 'The ceremony will be held outdoors in the gardens, weather permitting. In case of inclement weather, we have an indoor backup location at the same venue. The reception will be indoors.',
      order: 4,
    },
    {
      question: 'Can I take photos during the ceremony?',
      answer: 'We ask that you keep your phones and cameras put away during the ceremony. We will have a professional photographer capturing the moment, and we will share photos with everyone afterward. Take all the pictures you want at the reception, though!',
      order: 5,
    },
    {
      question: 'Is there a gift registry?',
      answer: 'We don\'t want any gifts. If you insist, we would always love a gift card to some of our favorite stores (Amazon, Chewy, Publix, Harbor Freight, Starbucks, Costco). But, we do not expect gifts whatsoever. We just want you to RSVP, show up, and have fun!',
      order: 6,
    },
    {
      question: 'Where\'s the venue?',
      answer: 'The venue is located at the address on the home page. (add photos of entrance doors, maybe say that a sign will be out there?)',
      order: 7,
    },
    {
      question: 'Where should I stay?',
      answer: 'There are many hotels in the area within walking distance of the venue. We recommend staying nearby as there are plenty of things to do, including bars, restaurants, and local attractions.',
      order: 8,
    },
    {
      question: 'Is it open bar?',
      answer: 'Is water wet? Is the sky blue? Do fish swim?',
      order: 9,
    },
    {
      question: 'Until when can I RSVP? Can I modify my RSVP?',
      answer: 'You can RSVP and/or modify your RSVP up until the deadline shown on the RSVP page.',
      order: 10,
    },
    {
      question: 'Can we walk around the gallery?',
      answer: 'Yeah, during the reception. You just can\'t bring in any food or drinks. Please make decisions that won\'t cost me $10 million in damages.',
      order: 11,
    },
  ]);

  console.log('Sample data seeded:');
}

export async function seedAdmin() {
  const exists = sqlite.prepare('SELECT 1 FROM admin_users LIMIT 1').get();
  if (exists) return;

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.warn(
      '[seedAdmin] ADMIN_USERNAME / ADMIN_PASSWORD not set — skipping admin seed. ' +
        'Set them in .env (or via your secrets manager) and restart to create the admin user.'
    );
    return;
  }

  const passwordHash = await hashPassword(password);
  await db.insert(adminUsers).values({
    username,
    passwordHash,
    createdAt: Date.now(),
  });

  console.log(`Admin user seeded with username "${username}".`);
}

if (process.argv[1]?.endsWith('seed.ts')) {
  const { initDb } = await import('./index.js');
  await initDb();
}
