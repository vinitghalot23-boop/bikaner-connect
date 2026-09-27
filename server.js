// Bikaner Connect — SMEPay backend (starter)
// -------------------------------------------------------------
// Why this file exists:
// Your SMEPay client_secret must NEVER be sent to the browser. Order
// creation and payment confirmation must happen here, on a server you
// control, not inside the HTML file. This tiny Express server does that.
//
// IMPORTANT: The exact SMEPay endpoint paths / field names below are my
// best-effort based on their WooCommerce plugin's publicly documented
// behaviour (client_id + client_secret auth, a create-order call that
// returns a QR, and a validate-order call to confirm payment). SMEPay's
// own merchant dashboard will show you the authoritative endpoint URLs
// and exact request/response fields — confirm those and adjust the
// SMEPAY_BASE / paths below before going live. Test everything in their
// sandbox/development mode first.
// -------------------------------------------------------------

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const {
  SMEPAY_CLIENT_ID,
  SMEPAY_CLIENT_SECRET,
  SMEPAY_MODE = 'development', // 'development' (staging) or 'production'
  RESEND_API_KEY,
  RESEND_FROM = 'Bikaner Connect <onboarding@resend.dev>', // swap to your verified domain later
  PORT = 3000,
} = process.env;

// In-memory OTP store — swap for a real database/Redis before going live
// (in-memory means restarting the server clears pending OTPs).
const otps = new Map(); // email -> { code, expires }

async function sendEmail(to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
  });
  if (!r.ok) throw new Error('Resend API error: ' + (await r.text()));
}

// 1) Frontend calls this when someone signs up.
app.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.json({ ok: false, error: 'Email required' });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    otps.set(email, { code, expires: Date.now() + 10 * 60 * 1000 }); // 10 min
    await sendEmail(
      email,
      'Your Bikaner Connect verification code',
      `<p>Your verification code is <b style="font-size:20px">${code}</b>. It expires in 10 minutes.</p>`
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('send-otp failed:', err);
    res.json({ ok: false, error: 'Could not send email right now' });
  }
});

// 2) Frontend calls this to check the code the user typed in.
app.post('/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  const rec = otps.get(email);
  if (!rec) return res.json({ valid: false, error: 'Request a new code' });
  if (Date.now() > rec.expires) { otps.delete(email); return res.json({ valid: false, error: 'Code expired, request a new one' }); }
  if (rec.code !== otp) return res.json({ valid: false, error: 'Incorrect code' });
  otps.delete(email);
  res.json({ valid: true });
});

// --- Username directory (so customers can find each other) ---
// In-memory — swap for a real database before going live, so usernames
// survive a server restart/redeploy.
const usernames = new Map(); // username -> { name }

app.get('/check-username', (req, res) => {
  const u = String(req.query.u || '').toLowerCase();
  res.json({ available: !usernames.has(u) });
});

app.post('/register-user', (req, res) => {
  const { username, name } = req.body;
  const u = String(username || '').toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(u)) return res.status(400).json({ ok: false, error: 'Invalid username' });
  if (usernames.has(u)) return res.status(409).json({ ok: false, error: 'Username taken' });
  usernames.set(u, { name: name || u });
  res.json({ ok: true });
});

app.get('/search-users', (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  if (q.length < 2) return res.json({ users: [] });
  const results = [];
  for (const [username, info] of usernames.entries()) {
    if (username.includes(q)) results.push({ username, name: info.name });
    if (results.length >= 20) break;
  }
  res.json({ users: results });
});

const SMEPAY_BASE =
  SMEPAY_MODE === 'production'
    ? 'https://api.smepay.in'
    : 'https://staging.smepay.in';

// In-memory order store — swap for a real database (Postgres/SQLite/etc.)
// before going live. Key = your internal orderId.
const orders = new Map();

// Map your coin packs here (must match the prices shown in the app).
// amountRs is what SMEPay will actually charge.
const COIN_PACKS = {
  '80': 62, '300': 149, '450': 251, '1100': 550, '1800': 1055,
  '3500': 1049, '5000': 1999, '9000': 2651, '20000': 5000,
};

function newOrderId() {
  return 'BC' + Date.now() + crypto.randomBytes(3).toString('hex');
}

// 1) Frontend calls this to start a purchase.
app.post('/create-order', async (req, res) => {
  try {
    const { coins } = req.body;
    const amountRs = COIN_PACKS[String(coins)];
    if (!amountRs) return res.status(400).json({ error: 'Unknown coin pack' });

    const orderId = newOrderId();

    // --- Call SMEPay to create the order. Confirm exact path/fields
    // with SMEPay's dashboard docs before going live. ---
    const smepayRes = await fetch(`${SMEPAY_BASE}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SMEPAY_CLIENT_ID,
        client_secret: SMEPAY_CLIENT_SECRET,
        order_id: orderId,
        amount: amountRs,
      }),
    });
    const smepayData = await smepayRes.json();
    if (!smepayRes.ok) {
      console.error('SMEPay create-order failed:', smepayData);
      return res.status(502).json({ error: 'Payment gateway error' });
    }

    orders.set(orderId, {
      coins: Number(coins),
      amountRs,
      status: 'pending',
      smepaySlug: smepayData.order_slug || smepayData.slug,
    });

    res.json({
      orderId,
      amountRs,
      qr: smepayData.qr || smepayData.qr_code, // base64 or URL, per SMEPay's response
      checkoutUrl: smepayData.payment_url,      // if SMEPay returns a hosted page instead
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 2) Frontend polls this every ~3s while the QR is on screen.
app.get('/order-status/:orderId', async (req, res) => {
  const order = orders.get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Not found' });

  if (order.status === 'paid') return res.json({ status: 'paid', coins: order.coins });

  try {
    // --- Confirm payment with SMEPay's validate-order endpoint. ---
    const smepayRes = await fetch(`${SMEPAY_BASE}/api/validate-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SMEPAY_CLIENT_ID,
        client_secret: SMEPAY_CLIENT_SECRET,
        slug: order.smepaySlug,
      }),
    });
    const data = await smepayRes.json();
    if (data.status === 'paid' || data.payment_status === 'success') {
      order.status = 'paid';
    }
  } catch (err) {
    console.error('validate-order check failed:', err);
  }

  res.json({ status: order.status });
});

// 3) Optional: SMEPay webhook, if they offer one — faster than polling.
app.post('/webhook/smepay', express.json(), (req, res) => {
  // TODO: verify the webhook signature per SMEPay's docs before trusting this.
  const { order_id, status } = req.body;
  const order = orders.get(order_id);
  if (order && (status === 'paid' || status === 'success')) {
    order.status = 'paid';
  }
  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`SMEPay backend running on port ${PORT}`));
