# Bikaner Connect — SMEPay backend (starter)

## Yeh kyu chahiye
`client_secret` browser mein kabhi bhi nahi jaana chahiye — warna koi bhi
usse chura sakta hai. Isliye order-create aur payment-confirm dono steps
yahan, server par hote hain, HTML file mein nahi.

## Setup (5 steps)

1. **SMEPay merchant account** banao (KYC + business details bharo).
   Dashboard se `client_id` aur `client_secret` milega.

2. Yeh folder kisi bhi free/cheap Node hosting par deploy karo — sabse
   aasaan: **Render.com** (free tier) ya **Railway.app**.
   - Render: "New Web Service" → yeh folder/GitHub repo connect karo →
     Build command: `npm install` → Start command: `npm start`.

3. Hosting ke "Environment Variables" section mein yeh set karo
   (`.env.example` dekho):
   - `SMEPAY_CLIENT_ID`
   - `SMEPAY_CLIENT_SECRET`
   - `SMEPAY_MODE` (`development` jab tak testing chal rahi ho, phir
     `production`)

4. Deploy hone ke baad tumhe ek URL milega, jaise
   `https://bikaner-connect-backend.onrender.com`.

5. Us URL ko `Bikaner_Connect_2_0.html` file ke top wali
   `APP_BACKEND` variable mein daal do (Claude se bolo "yeh backend
   URL hai, isse jod do" aur woh line update kar dega).

## Real Gmail OTP (email verification)

Signup ke waqt jo 6-digit code bheja jaata hai, woh ab bhi **real email**
se bhej sakte ho — isi backend se, alag se kuch nahi banana:

1. **Resend** (resend.com) par free account banao — 3,000 emails/month
   free hain, credit card nahi chahiye.
2. Dashboard se **API key** milega — usse `.env` mein `RESEND_API_KEY`
   ke saamne daal do.
3. Testing ke liye `RESEND_FROM` waisa hi rehne do
   (`onboarding@resend.dev`) — yeh Resend ka shared test address hai,
   turant kaam karega. Jab apna domain (jaise `bikanerconnect.com`)
   verify kar lo, `RESEND_FROM` ko `noreply@bikanerconnect.com` jaisa
   kar dena — professional dikhega aur spam mein jaane ke chances kam
   honge.
4. Deploy karne ke baad, HTML file mein `APP_BACKEND` set hote hi
   signup OTP automatically real email se jaayega — koi aur change
   nahi karna padega.

## ⚠️ Zaroor check karo before going live
`server.js` mein SMEPay ke `/api/create-order` aur `/api/validate-order`
calls maine unke WooCommerce plugin ke public behaviour se best-guess
banaye hain (exact field names SMEPay dashboard ke docs mein confirm
karo — thoda farak ho sakta hai). Pehle **development/sandbox mode**
mein test karo, real paisa involve karne se pehle.

## Diamonds → withdrawal wala hissa
Yeh backend sirf **coins kharidna** (paisa andar aana) handle karta hai.
Listener ka withdrawal (paisa bahar bhejna, UPI se) alag process hai —
uske liye SMEPay ka payout/settlement dekhna hoga ya woh manually bank
transfer/UPI se karna hoga, jaisa abhi app mein already likha hai
("processed manually by our team").
