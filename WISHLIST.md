# UDF Portal — Master Feature Wishlist & Future Roadmap

This file tracks all approved, user-wishlisted enterprise features and enhancements for future phases.

---

### 1. Document Expiry & Compliance Watchdog Cron (checkDocumentExpiryCron)
* **Category:** Automated Compliance & Risk Management
* **Description:** A daily scheduled Cloud Function running at 01:00 AM IST that scans expiry dates on active employee documents:
  - Driving Licenses
  - Police Verification Certificates (PVC)
  - Medical Fitness Certificates
  - Site Safety / Security Clearance Passes
* **Action:** Triggers automated 30-day, 15-day, and 7-day notifications (Email / In-App / WhatsApp) to both the employee and their Site HR Manager before a certificate lapses.

---

### 2. Multi-Site Manpower Muster & Attrition Analytics Dashboard
* **Category:** Executive BI & Workforce Analytics
* **Description:** An interactive analytics suite in the Admin Portal providing:
  - Site-wise sanctioned manpower strength vs. actual active headcount gauges.
  - Monthly onboarding-to-attrition trend charts.
  - Average onboarding approval Turnaround Time (TAT) by site supervisor.
  - Pending approval bottlenecks and role-wise queue heatmaps.

---

### 3. Bulk Monthly Payslip & Statutory Document Vault
* **Category:** Employee Self-Service & Payroll Distribution
* **Description:** 
  - Allows HR/Accounts to bulk upload password-protected monthly PDF payslips (mapped by Employee ID or PAN).
  - Employees can securely view, download, or share their past 12 months' payslips, PF UAN cards, and ESIC e-Pehchan cards directly from the Employee Portal.

---

### 4. Public QR Code Credential Verification (/verify/:badgeToken)
* **Category:** Field Security & Client Verification
* **Description:** 
  - Generates a tamper-proof QR code printed on every employee ID card / digital badge.
  - Scanning the QR code with any smartphone camera opens a public verification page displaying verified photo, active deployment site, designation, and validity badge without exposing sensitive PII.

---

### 5. Side-by-Side Split-Screen OCR Diff Highlighting
* **Category:** Onboarding Verification & Fraud Prevention
* **Description:** 
  - In AdminReviewSubmissionsPage, opens an interactive split-screen view: Candidate-typed form fields on the left side vs. uploaded Aadhaar/PAN/Bank card on the right side.
  - Automatically highlights mismatched letters, dates of birth, or fathers' names in yellow/red to prevent identity typos and KYC mismatches.

---

### 6. Client & Facility Headcount Portal
* **Category:** Client Transparency & Attendance Sharing
* **Description:** 
  - A restricted client-facing login for site facility managers (e.g., DLF, Amazon, GMR).
  - Allows facility heads to view deployed guards/marshalls, verified BGV badges, and daily attendance logs for their site only.

---

### 7. Phase 2 Full Server-Side Cursor Pagination for Secondary Tabs (IMP-8)
* **Category:** Scalability & Database Performance
* **Description:** 
  - Extend the existing startAfter cursor pagination from AdminMasterEmployeeListPage into secondary archive tabs (Disciplinary Actions, Inactive Referral Invites) when historical records exceed 5,000+ entries.

---

### 8. Single-Container Cloud API & Zero-Trust Database Isolation (Google Cloud Run + Fastify + SSE)
* **Category:** Advanced Cloud Architecture & Database Hardening
* **Description:** 
  - **Single-Container Architecture:** Package backend logic into a single, high-performance Node.js / Fastify container hosted on **Google Cloud Run** to eliminate micro-function sprawl and leverage Google's 2,000,000 free monthly requests and Startup CPU Boost (<300ms startup).
  - **Zero-Trust Database Lockdown:** Transition `firestore.rules` to complete lockdown (`allow read, write: if false;`), rendering the entire Firestore database invisible and untouchable to browser clients, accessible exclusively via authenticated Cloud Run API endpoints using master service account credentials.
  - **Server-Sent Events (SSE) Real-Time Bus:** Replace direct browser `onSnapshot` subscriptions with native HTTP Server-Sent Events (`EventSource`) to provide instantaneous live dashboard updates at near-zero infrastructure cost (avoiding expensive 24/7 WebSocket server clusters).
  - **Phased Migration Strategy:** Mount existing `functions/index.js` endpoints inside an Express/Fastify router on Cloud Run as a secondary backend, then migrate frontend service modules incrementally (Vacancies → Leaves → Staff → Master Employees) with zero operational downtime.
