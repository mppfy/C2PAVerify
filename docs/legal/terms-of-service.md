# Terms of Service — C2PAVerify

**Effective date:** 2026-04-21
**Version:** 1.0.0-mvp

---

## 0. Plain-language summary (not part of the contract)

> This is an API that checks C2PA manifests on media files. Each call costs
> 0.01 USDC, paid in stablecoin on-chain. We don't store your files, don't
> have accounts, and don't moderate content. We check cryptographic
> signatures — we don't tell you whether a photo is "real." Crypto payments
> are final. Read the full terms below; they are the binding agreement.

---

## 1. Who we are and what this is

This agreement ("**Terms**") is between you ("**User**", "**you**") and
`[OPERATOR_ENTITY]` ("**Operator**", "**we**", "**us**"), governing your
use of the C2PAVerify API (the "**Service**") available at
`https://c2pa.mppfy.com` and any related endpoints.

The Service is a machine-readable HTTP API. It has no accounts, no user
registration, and no human-facing interface beyond documentation. Agents,
bots, and scripts are its primary audience.

### 1.1 Acceptance

You accept these Terms each time you make an API call to the Service. By
sending an HTTP request to any endpoint, you represent that you have read,
understood, and agreed to the then-current version of these Terms.

The then-current version is served at `https://c2pa.mppfy.com/legal/terms`
and identified by the `Effective date` and `Version` at the top of this
document.

If you do not agree, do not use the Service.

---

## 2. The Service

### 2.1 What the Service does

The Service extracts embedded C2PA (Content Provenance and Authenticity
Initiative) manifests from media files (images, video, audio) submitted
by the User via HTTP upload or URL reference, and returns a structured
validation result containing:

- Signature-chain validation status (`valid`, `partial`, `unknown`)
- Manifest contents (signer, claim generator, assertion labels)
- Warnings encountered during parsing

### 2.2 What the Service does NOT do

**This is a critical carve-out. Read it carefully.**

- The Service does **not** verify the truth, accuracy, or authenticity of
  depicted content. A valid C2PA signature proves that a manifest has not
  been tampered with since signing — it does **not** prove that the
  manifest itself is honest, that the signing party is who they claim to
  be, or that the media depicts real events.
- The Service does **not** detect deepfakes, synthetic media, or AI-
  generated content beyond what the manifest self-declares.
- The Service does **not** moderate content, assess copyright, detect
  illegal material, or make editorial judgments.
- The Service does **not** act as a notary, authority, or attestation
  provider. Validation results are informational only.
- The Service makes **no** representation about the Adobe Content
  Authenticity Initiative (CAI) trust list or any certificate authority.
  Trust-list state is queried at the time of request; prior results may
  become invalid if upstream revocations occur.

Users who rely on Service output to make editorial, journalistic,
evidentiary, legal, or safety-critical decisions do so at their own risk
and outside the intended use of the Service.

### 2.3 Endpoints and documentation

The authoritative list of endpoints and their semantics is at
`https://c2pa.mppfy.com/openapi.json` (OpenAPI 3.1).

We may add, remove, modify, or deprecate endpoints at any time. Breaking
changes to paid endpoints will be announced on the landing page for 7
days before taking effect, where practical. No notice is required for
free endpoints.

---

## 3. Payment

### 3.1 Pricing

Paid endpoints cost a fixed per-call amount in a supported stablecoin,
currently **0.01 USDC per call**. The authoritative price is in the
OpenAPI document at `/openapi.json` under `x-x402.accepts[].maxAmountRequired`
(atomic units) and `x-payment-info.price` (decimal USD).

Prices may change. Any change takes effect at the moment the OpenAPI
document is updated; clients that cache the document are responsible for
refreshing.

### 3.2 Payment protocols

The Service accepts payment via:

- **x402** (HTTP 402 Payment Required protocol, settled in USDC on
  Base L2 via EIP-3009 `transferWithAuthorization`). See
  https://x402.org.
- **MPP** (Machine Payments Protocol, settled in USDC.e on the Tempo
  chain). See https://mpp.dev.

The Service may add, remove, or adjust supported protocols and networks
at its sole discretion.

### 3.3 On-chain settlement is final and irreversible

**Payments settle on public blockchains.** Once a transaction is
confirmed, it **cannot be reversed, refunded, or cancelled** by the
Operator, the User, or any third party. You acknowledge:

1. You are solely responsible for sending the correct amount to the
   correct recipient address on the correct network using the correct
   asset contract.
2. Overpayments, payments to wrong addresses, payments on wrong networks,
   and payments in wrong assets are **non-recoverable**. The Operator has
   no ability or obligation to return such funds.
3. Chain reorganizations, mempool displacement, MEV, and facilitator
   outages are inherent to the protocols used. The Operator is not
   liable for losses caused by such events.
4. You are responsible for any gas fees, facilitator fees, exchange
   spreads, or network costs incurred on your side.
5. Transaction metadata (payer address, amount, timestamp) is publicly
   visible on the blockchain. Do not use payment addresses you need to
   keep private.

### 3.4 No refunds

We do not issue refunds. If the Service returns a 5xx error after
settling your payment, we may, at our sole discretion, credit a
replacement call. This credit is a courtesy, not an obligation. There is
no refund for:

- Validation results you consider unfavorable
- Mispredictions of pricing or network fees
- User-side integration errors (wrong endpoint, malformed request,
  expired payment signature)
- Rate-limited or blocked requests (see §4)

### 3.5 Third-party facilitators

Payment verification and settlement depend on third-party facilitator
services (currently PayAI, Coinbase Developer Platform, and x402.org).
We route across these facilitators using a pool-with-fallback strategy.
**We are not liable for their uptime, fee changes, policy changes,
censorship, withdrawal limits, geographic restrictions, or KYC
requirements they may impose on your wallet.**

If all configured facilitators are unavailable, paid requests will
return HTTP 402 or 503. No payment is charged in that case.

---

## 4. Acceptable use

### 4.1 Agent and bot traffic is explicitly permitted

The Service is designed for automated clients. Use by AI agents, LLMs,
scrapers, scripts, and bots is **permitted and encouraged**, subject to
the rest of this section.

### 4.2 Prohibited uses

You may not, and may not permit any party to:

1. **Submit illegal content**: CSAM, content violating export-control
   laws, content infringing third-party intellectual property rights
   where you have no license.
2. **Submit content you have no right to process**: media where the
   copyright holder or subject has not consented to processing.
3. **Attempt to impersonate the Operator's attestation**: representing
   Service output as a notarized, certified, or first-party attestation
   of content authenticity. The Service provides cryptographic
   validation, not editorial endorsement.
4. **Resell Service output as your own authenticity verdict** without
   disclosing that it was produced by a third-party C2PA verifier and
   without the "Service does NOT do" disclaimers from §2.2 being
   clearly surfaced to your own users.
5. **Attack the Service**: denial-of-wallet attacks, rate-limit evasion,
   credential-stuffing, reverse-engineering beyond what is necessary for
   interoperability permitted by local law, exploiting bugs without
   disclosure (see §11.2 for responsible disclosure).
6. **Violate sanctions law**: use the Service from, or on behalf of,
   jurisdictions or parties subject to comprehensive sanctions by OFAC,
   EU, UK, or UN. The Operator reserves the right to block requests
   from sanctioned addresses or IP ranges at any time without notice.
7. **Circumvent payment**: accessing paid endpoints without a valid
   payment, replaying previously-used payment signatures, or exploiting
   facilitator race conditions.

Violation of this section authorizes us to block your IP, wallet
address, or user-agent without notice. Repeat violations may be reported
to law enforcement in the relevant jurisdiction.

### 4.3 Rate limits

We may throttle, queue, or reject requests at our sole discretion with
no advance notice. There is **no SLA** for the MVP version of the
Service. Rate limits may be per-IP, per-wallet, per-user-agent, or
global. A rate-limited request returns HTTP 429 and does **not** incur
a payment charge.

### 4.4 Request size and format

We accept uploads up to 25 MB per request. Requests larger than this
return HTTP 413 without a payment charge. We accept common media MIME
types (`image/*`, `video/*`, `audio/*`); unsupported types return HTTP
415 without a charge.

---

## 5. User-submitted content

### 5.1 Your representations

By submitting any file or URL to the Service, you represent and warrant
that:

1. You have the right to submit that content for processing under
   applicable copyright, privacy, publicity, and data-protection laws.
2. The content does not violate §4.2.
3. You are not processing content on behalf of a subject who has not
   consented, where consent is required by applicable law.

### 5.2 No storage

**We do not store submitted content beyond the duration of the request.**
File bytes are held in worker memory only during processing and are
discarded when the response is sent. We do not log file contents, do not
cache uploaded files, and do not share file contents with third parties
other than the upstream infrastructure required to process the request
(Cloudflare Workers runtime).

We may log **request metadata** — timestamp, IP address, user-agent,
payment protocol, payer wallet address, status code, latency, content
size — for operational, security, billing, and abuse-prevention purposes.
See the Privacy Policy at `/legal/privacy`.

### 5.3 Indemnification

You agree to defend, indemnify, and hold harmless the Operator, its
officers, employees, contractors, and affiliates from and against any
claims, damages, losses, liabilities, fines, or expenses (including
reasonable attorneys' fees) arising out of:

- Content you submit to the Service
- Your violation of §4.2 or §5.1
- Your representation of Service output to third parties in violation
  of §4.2(3) or §4.2(4)
- Your violation of applicable law while using the Service

---

## 6. Intellectual property

### 6.1 Service

The Service, including its source code, APIs, documentation, and
trademarks, is the property of the Operator or its licensors. Nothing in
these Terms grants you any right to the Service's intellectual property
except the limited right to make API calls as documented.

### 6.2 Your content

You retain all rights in content you submit. You grant the Operator a
narrow, non-exclusive, worldwide, royalty-free license to process that
content solely to provide the Service response to you, for the duration
of the request. This license terminates the moment the request completes.

### 6.3 Validation results

Validation results returned by the Service are factual reports about
cryptographic properties of your submitted manifest. You may use them
freely, subject to §4.2(3) and §4.2(4) (disclosure requirements when
you republish them).

---

## 7. Third-party dependencies

The Service depends on third-party infrastructure whose availability and
correctness are outside our control. We specifically disclaim liability
for:

- **Cloudflare** (compute runtime, DNS, edge cache, DDoS protection)
- **Base L2** and **Tempo** (payment settlement chains)
- **PayAI, Coinbase Developer Platform (CDP), x402.org** (payment
  facilitators)
- **Adobe Content Authenticity Initiative** (CAI trust list maintenance)
- **Axiom** (log ingestion)
- **Sentry** (error telemetry)

Outages, degraded performance, fee changes, terms-of-service changes,
geographic blocks, and sanctions enforcement by any of these providers
may affect the Service without notice. We will not be liable for such
third-party actions.

---

## 8. No warranty

**THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE."** To the maximum
extent permitted by applicable law, we disclaim all warranties, express
or implied, including:

- Merchantability
- Fitness for a particular purpose
- Non-infringement
- Availability, uptime, or response time
- Accuracy, completeness, or correctness of validation results
- Continuity of the CAI trust list, payment protocols, or underlying
  chains

Validation results reflect the state of the submitted manifest and the
CAI trust list at the moment of processing. We make **no** warranty that
a `valid` result today will remain `valid` tomorrow, or that a manifest
declared `partial` is not in fact fully valid via some chain we do not
recognize.

---

## 9. Limitation of liability

**To the maximum extent permitted by applicable law:**

1. Neither party will be liable for any indirect, incidental, special,
   consequential, exemplary, or punitive damages, including lost
   profits, lost revenue, lost data, lost goodwill, or business
   interruption, arising out of or related to these Terms or the
   Service, even if advised of the possibility of such damages.
2. The Operator's total aggregate liability to you for all claims
   arising out of or related to the Service in any twelve (12) month
   period will not exceed the **greater of** (a) the total payments you
   paid to the Operator for the Service during the preceding twelve
   (12) months, or (b) one hundred USD ($100).
3. These limitations apply regardless of the legal theory (contract,
   tort, negligence, strict liability, or otherwise) and even if a
   limited remedy fails of its essential purpose.

Some jurisdictions do not allow exclusion of implied warranties or
limitation of incidental damages. In those jurisdictions, the exclusions
and limitations apply to the fullest extent permitted.

---

## 10. Sanctions and export controls

You represent and warrant that you are not:

- Located in, a national of, or a resident of, any country or region
  subject to comprehensive economic sanctions by the United States,
  European Union, United Kingdom, or United Nations
- Listed on any sanctions list maintained by OFAC, the EU Consolidated
  List, HM Treasury, or the UN Security Council
- Acting on behalf of any such person

You will not use the Service in violation of applicable export-control
laws. The Operator may refuse service to any wallet address or IP range
associated with sanctioned parties, at any time, without notice and
without liability.

---

## 11. Security

### 11.1 Operator's commitments

We will:

- Keep our infrastructure reasonably secure using industry-standard
  practices (TLS, secrets management, dependency patching)
- Log abuse signals for post-incident review
- Publish any post-incident reports relevant to users on the landing
  page

We explicitly do **not** commit to:

- Zero-downtime operation
- Post-quantum cryptography
- Any specific incident-response SLA

### 11.2 Responsible disclosure

If you discover a security vulnerability, email `[SECURITY_EMAIL]`
before public disclosure. We will acknowledge within 5 business days.
We do not operate a paid bug-bounty program; disclosure is goodwill-
based. Acting in bad faith (exploit-first-disclose-later, holding the
Service hostage, requesting ransom) voids any goodwill acknowledgement
and may trigger §4.2(5) enforcement.

---

## 12. Modifications, suspension, and termination

### 12.1 We may modify the Service

We may change, suspend, deprecate, or discontinue the Service, any
endpoint, any price, or any supported payment protocol at any time,
with or without notice. Breaking changes to paid endpoints will be
announced on the landing page for 7 days where practical.

### 12.2 We may terminate your use

We may suspend or terminate your access to the Service (by blocking
your IP, wallet, or user-agent) at our sole discretion, especially for
violations of §4.2. No refund is owed for pre-paid or in-flight calls
at termination.

### 12.3 You may terminate

You may stop using the Service at any time simply by not making further
requests. No notice is required. No refund is owed.

### 12.4 Survival

Sections 2.2, 3.3, 3.4, 4.2, 5.3, 6, 7, 8, 9, 10, 11.2, 12.4, 13, 14,
and 15 survive termination.

---

## 13. Governing law and dispute resolution

### 13.1 Governing law

These Terms are governed by the laws of **`[JURISDICTION]`**, without
regard to its conflict-of-laws rules.

### 13.2 Dispute resolution

Before filing suit, the parties will attempt to resolve any dispute
arising out of these Terms through good-faith written negotiation for
at least thirty (30) days.

If unresolved, disputes will be brought exclusively in the courts of
**`[DISPUTE_VENUE]`**, and both parties consent to personal jurisdiction
there.

### 13.3 No class actions

To the extent permitted by applicable law, disputes may only be brought
in your individual capacity, not as a plaintiff or class member in any
purported class or representative proceeding.

---

## 14. Miscellaneous

### 14.1 Entire agreement

These Terms (together with the Privacy Policy at `/legal/privacy`)
constitute the entire agreement between you and the Operator regarding
the Service and supersede any prior oral or written agreements.

### 14.2 Severability

If any provision of these Terms is held invalid or unenforceable, the
remaining provisions will remain in full force and effect.

### 14.3 No waiver

Our failure to enforce any provision is not a waiver of our right to
enforce it later.

### 14.4 Assignment

You may not assign or transfer your rights under these Terms without our
written consent. We may assign these Terms in connection with a merger,
acquisition, sale of assets, or by operation of law, without notice.

### 14.5 No agency

Nothing in these Terms creates a partnership, joint venture, agency,
employment, or fiduciary relationship between the parties.

### 14.6 Force majeure

Neither party is liable for failure to perform caused by events outside
its reasonable control, including third-party infrastructure failures,
chain outages, sanctions enforcement, or government action.

### 14.7 Language

These Terms are in English. Any translation is for convenience only;
the English version controls in case of conflict.

---

## 15. Contact

For legal inquiries: **`[CONTACT_EMAIL]`**
For security disclosure: **`[SECURITY_EMAIL]`**

Operator: **`[OPERATOR_ENTITY]`**, governed by the laws of
**`[JURISDICTION]`**.

---

## Change log

| Date | Version | Summary |
|---|---|---|
| 2026-04-21 | 1.0.0-mvp | Initial publication. |
