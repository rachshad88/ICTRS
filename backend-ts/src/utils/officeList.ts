import { getOfficesCollection } from '../config/database';

const CASE_INSENSITIVE = { locale: 'en', strength: 2 } as const;

// Names of the offices people can pick now, A to Z.
export async function activeOfficeNames(): Promise<string[]> {
  const docs = await getOfficesCollection()
    .find({ active: true }, { projection: { name: 1 } })
    .collation(CASE_INSENSITIVE)
    .sort({ name: 1 })
    .toArray();
  return docs.map((d) => d.name);
}

// The stored spelling of an office that can be picked, or null when there is none by that name.
export async function findActiveOffice(name: string): Promise<string | null> {
  const doc = await getOfficesCollection().findOne(
    { name: name.trim(), active: true },
    { collation: CASE_INSENSITIVE, projection: { name: 1 } }
  );
  return doc?.name ?? null;
}

// Checks an office sent from a form. Blank is allowed when blankOk; the account's current office is
// always allowed, so people on an office that was later hidden can still save other changes.
// Returns the office to store, or an error message.
export async function checkOffice(
  value: unknown,
  current: string | undefined,
  blankOk: boolean
): Promise<{ office: string } | { error: string }> {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) return blankOk ? { office: '' } : { error: 'Select your office' };
  if (current && name === current) return { office: current };
  const found = await findActiveOffice(name);
  return found ? { office: found } : { error: 'Select an office from the list' };
}
