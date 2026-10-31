// Sends one email through Resend. It does nothing, and says so, until RESEND_API_KEY and EMAIL_FROM are set.
export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export async function sendEmail(to: string, m: { subject: string; text: string; html: string }): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject: m.subject, text: m.text, html: m.html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
