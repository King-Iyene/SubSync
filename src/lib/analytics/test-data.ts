// Obvious test accounts, so an agency can hide them from every number with one switch. A name is "test
// data" when it contains one of these words on its own ("KD Squares Test", "Demo Clinic", "Sandbox 2"):
// it never matches part of a real name such as "Contest Pros" or "Samplerate Audio".
const TEST_WORDS = /(^|[^a-z0-9])(test|testing|demo|sample|sandbox|dummy)([^a-z0-9]|$)/i;

export const isTestName = (name: string | null | undefined): boolean => (name ? TEST_WORDS.test(name) : false);
