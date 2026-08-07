import { eq } from 'drizzle-orm';
import { db, appSettings } from './db/index.js';

const CODE_LOOKUP_KEY = 'code_lookup_enabled';

// enabled unless an admin has explicitly turned it off
export async function isCodeLookupEnabled(): Promise<boolean> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, CODE_LOOKUP_KEY),
  });
  return row ? row.value === 'true' : true;
}

export async function setCodeLookupEnabled(enabled: boolean): Promise<void> {
  const value = enabled ? 'true' : 'false';
  await db
    .insert(appSettings)
    .values({ key: CODE_LOOKUP_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}
