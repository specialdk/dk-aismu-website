/* =========================================================
   aiskillmeup — tiny Express service for Railway.
   Two jobs:
     1. Serve the static site (index.html, work.html, etc.)
     2. Handle POST /api/contact  ->  email the enquiry via Resend
   No database. The enquirer's address is set as reply-to, so
   replying from your inbox goes straight back to them.
   ========================================================= */

const express = require('express');
const path = require('path');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Config (set these in Railway -> Variables) ---
// Construct Resend lazily: if the key is missing we still serve the whole
// site (only the form is disabled), instead of crashing on startup.
let _resend = null;
function getResend() {
  if (!_resend && process.env.RESEND_API_KEY) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}
const CONTACT_TO   = process.env.CONTACT_TO   || 'duane@aiskillmeup.com';
// Until aiskillmeup.com is verified in Resend, you can use the test sender
// 'onboarding@resend.dev' (it can only deliver to your own verified address).
const CONTACT_FROM = process.env.CONTACT_FROM || 'aiskillmeup <onboarding@resend.dev>';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the hand-written site from the repo root.
// extensions:['html'] lets /work resolve to work.html, etc.
app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

// --- helpers ---
const clean = (s, max = 4000) => String(s ?? '').trim().slice(0, max);
const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// --- contact endpoint ---
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, organisation, message, company } = req.body || {};

    // Honeypot: the form's hidden `company` field is invisible to people.
    // If it's filled, it's a bot — accept silently and drop.
    if (clean(company)) return res.status(200).json({ ok: true });

    const n = clean(name, 200);
    const e = clean(email, 200);
    const org = clean(organisation, 200);
    const m = clean(message, 5000);

    if (!n || !isEmail(e) || !m) {
      return res.status(400).json({ ok: false, error: 'Please include your name, a valid email, and a message.' });
    }

    const resend = getResend();
    if (!resend) {
      console.error('RESEND_API_KEY is not set — cannot send email.');
      return res.status(500).json({ ok: false, error: 'Email is not configured yet. Please email me directly.' });
    }

    const html = `
      <h2 style="font-family:Georgia,serif;color:#1F3A5F;">New enquiry via aiskillmeup</h2>
      <p><strong>Name:</strong> ${escapeHtml(n)}</p>
      <p><strong>Email:</strong> ${escapeHtml(e)}</p>
      ${org ? `<p><strong>Organisation:</strong> ${escapeHtml(org)}</p>` : ''}
      <p><strong>Message:</strong></p>
      <p>${escapeHtml(m).replace(/\n/g, '<br/>')}</p>
    `;
    const text =
      `New enquiry via aiskillmeup\n\n` +
      `Name: ${n}\nEmail: ${e}\n` +
      (org ? `Organisation: ${org}\n` : '') +
      `\nMessage:\n${m}\n`;

    await resend.emails.send({
      from: CONTACT_FROM,
      to: CONTACT_TO,
      replyTo: e, // hit reply in your inbox -> goes straight to the enquirer
      subject: `aiskillmeup enquiry — ${n}`,
      html,
      text,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('contact send failed:', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong sending your message. Please email me directly.' });
  }
});

// Health check — handy for Railway.
app.get('/healthz', (_req, res) => res.send('ok'));

app.listen(PORT, () => console.log(`aiskillmeup listening on ${PORT}`));