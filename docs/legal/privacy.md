# Privacy Policy — C2PAVerify

**Effective date:** 2026-04-21
**Version:** 1.0.0-mvp

---

## 0. Plain-language summary (not part of the policy)

> We don't have accounts. We don't store the files you send us. We keep
> minimal logs (timestamps, IP, wallet address, status codes) for about
> 90 days to catch abuse and fix bugs. We use Cloudflare to run the
> service, Axiom to store logs, and payment facilitators to settle
> crypto payments. That's it.

---

## 1. Who is the data controller

`[OPERATOR_ENTITY]` ("**Operator**", "**we**", "**us**") controls any
personal data processed in connection with the C2PAVerify API (the
"**Service**") at `https://c2pa.mppfy.com`.

Contact for privacy inquiries: **`[CONTACT_EMAIL]`**.

---

## 2. What we collect

The Service is a machine-to-machine HTTP API with **no accounts**, **no
sign-ups**, and **no user identifiers** other than what arrives in each
HTTP request.

### 2.1 Request metadata (logged)

For every API request, we log:

- Timestamp
- IP address (of the requesting client)
- User-agent header
- HTTP method and path
- Response status code
- Response latency
- Request body size and content type
- Payment protocol used (`mpp`, `x402`, or `none`)
- Payer wallet address (public chain identifier, if payment was made)
- Facilitator used for settlement (`payai`, `cdp`, `x402-public`, etc.)
- On-chain transaction hash (if settlement completed)

### 2.2 Request body (NOT logged)

We do **not** log the contents of uploaded files or the contents of URLs
fetched on your behalf. File bytes exist only in memory during request
processing and are discarded when the response is sent.

We do **not** retain copies of submitted media in storage, cache, or
backups.

### 2.3 No cookies, no tracking

The API does not set cookies, tracking pixels, or any client-side
storage. The landing page at `https://c2pa.mppfy.com/` and
`https://mppfy.com/` does not use analytics SDKs, ad trackers, or
cross-site tracking.

### 2.4 Special categories

We do **not** intentionally collect special-category personal data
(health, political opinion, religion, biometric identifiers, sexual
orientation, or similar). If your submitted content contains such data,
we process it transiently and without retention per §2.2. You are
responsible for having the right to submit such content under your
jurisdiction's laws.

---

## 3. Why we collect it (legal basis)

Under GDPR Art. 6 and comparable frameworks:

- **Legitimate interest** (Art. 6(1)(f)): operating the Service, billing
  reconciliation, abuse prevention, debugging. IP address and user-agent
  are the minimum necessary to throttle abuse and investigate incidents.
- **Contract performance** (Art. 6(1)(b)): processing submitted files
  for the duration of the request is required to fulfill the API
  response you requested.
- **Legal obligation** (Art. 6(1)(c)): we may retain transaction records
  (payer address, amount, tx hash) for tax, anti-money-laundering, and
  sanctions-compliance purposes where applicable law requires.

We do not rely on consent, because the API has no account layer where
consent could be meaningfully captured per call. Your first API call is
treated as acceptance of the Terms and this Policy per §1.1 of the
Terms.

---

## 4. How long we keep it

| Data | Retention |
|---|---|
| Request metadata logs (Axiom) | 90 days, then purged |
| Error telemetry (Sentry, if enabled) | 90 days, then purged |
| On-chain transaction records | Public and permanent (we cannot delete them — they live on the blockchain, outside our control) |
| Cloudflare edge access logs | As set by Cloudflare's default retention (typically 30 days for free plans) |

Aggregate analytics (total request count per day, revenue sums) may be
retained indefinitely in anonymized form.

---

## 5. Who we share it with (processors and recipients)

We share the minimum necessary data with the following third parties
strictly to operate the Service. Each has its own privacy policy linked.

| Processor | What they receive | Purpose | Privacy policy |
|---|---|---|---|
| **Cloudflare, Inc.** | All request data (during processing) | Worker runtime, DNS, DDoS mitigation | https://www.cloudflare.com/privacypolicy/ |
| **Axiom, Inc.** | Request metadata logs | Log ingestion and search | https://axiom.co/privacy |
| **Sentry / Functional Software, Inc.** | Error stack traces (no request bodies) | Crash reporting, if enabled | https://sentry.io/privacy/ |
| **PayAI** | Payment payload + requirements | x402 facilitator verification + settlement | (see PayAI docs) |
| **Coinbase, Inc. (CDP)** | Payment payload + requirements | x402 facilitator verification + settlement | https://www.coinbase.com/legal/privacy |
| **Base (Coinbase L2), Tempo** | Transaction data | On-chain settlement; transaction data is publicly visible by design | n/a (public blockchain) |
| **Adobe (CAI trust list publisher)** | Nothing about you — we cache the trust list; no per-request call to Adobe | Trust-chain validation | https://www.adobe.com/privacy/policy.html |

We do not sell or rent data to anyone. We do not share data with
advertisers or data brokers.

---

## 6. International transfers

Because we run on Cloudflare's global edge, request data may be
processed in any Cloudflare data center worldwide, including the
United States. Cloudflare uses Standard Contractual Clauses for EU→US
transfers and is certified under the EU-US Data Privacy Framework.

Axiom is based in the United States and processes data under Standard
Contractual Clauses.

Facilitators (PayAI, Coinbase) may route data through their own
geographies per their privacy policies.

If you need data residency within a specific region, this Service is
not suitable for you.

---

## 7. Your rights

Because the Service has no account layer, we have no stable identifier
tying requests to a specific natural person. This makes some data-
subject rights technically impractical, but we honor them where we can.

### 7.1 Rights under GDPR / UK GDPR / similar frameworks

You may have the right to:

- **Access**: request a copy of the personal data we hold about you.
- **Rectification**: request correction of inaccurate personal data.
- **Erasure**: request deletion of your personal data.
- **Restriction**: request temporary pause of processing.
- **Objection**: object to processing based on legitimate interest.
- **Data portability**: request a copy in a machine-readable format.
- **Complaint**: lodge a complaint with your supervisory authority.

### 7.2 How to exercise them

Because we cannot look up "your" data without an identifier, you must
provide one or more of:

- Timestamp range of your requests (UTC)
- IP address(es) you used
- Payer wallet address(es) you used
- Transaction hash(es) of payments you made

Email **`[CONTACT_EMAIL]`** with the Subject line `Data Subject Request
— [access | erasure | etc.]` and include the identifying information
above.

We will respond within 30 days.

### 7.3 What we cannot delete

**On-chain payment records are permanent.** Once a payment transaction
is confirmed on Base or Tempo, it is written to a public blockchain that
we do not control and cannot modify. Deleting our copy of the tx hash
does not remove it from the chain; a third party can always re-derive
that data by observing the chain.

We also cannot delete data that we must retain for legal obligations
(tax, AML, sanctions compliance).

---

## 8. Security

We use:

- TLS 1.2+ for all endpoints
- Secret management via Cloudflare Workers secret store
- Principle of least privilege for all third-party integrations
- Dependency patching and vulnerability monitoring

We do **not** operate a SOC 2 / ISO 27001 program at MVP scale. If your
use case requires certified processing, this Service is not suitable
for you at this time.

Report vulnerabilities to **`[SECURITY_EMAIL]`** — see Terms §11.2.

---

## 9. Children

The Service is not directed at children under 16. We do not knowingly
collect personal data from children. If you believe a child has used
the Service and their data should be removed, email
**`[CONTACT_EMAIL]`**.

---

## 10. Changes to this Policy

We may update this Policy. The version and effective date at the top
always reflect the current version. Material changes will be announced
on the landing page for 7 days where practical. Continued use of the
Service after a change constitutes acceptance of the updated Policy.

---

## 11. Contact

**`[CONTACT_EMAIL]`** — privacy inquiries and data subject requests.

**`[SECURITY_EMAIL]`** — security disclosure.

Operator: **`[OPERATOR_ENTITY]`**, governed by the laws of
**`[JURISDICTION]`**.

---

## Change log

| Date | Version | Summary |
|---|---|---|
| 2026-04-21 | 1.0.0-mvp | Initial publication. |
