// How far back appointments are read from the platform. Anything older than this is not in SubSync, and the screens say where history starts.
// Set APPOINTMENT_SYNC_PAST_DAYS (30 to 730) to read further back; the default is 90 days.
const asked = Number(process.env.APPOINTMENT_SYNC_PAST_DAYS);
export const APPOINTMENT_PAST_DAYS = Number.isFinite(asked) && asked >= 30 && asked <= 730 ? Math.floor(asked) : 90;
