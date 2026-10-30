# Developer Briefing & Production Hardening Task Sheet

**Target Project:** UDF Portal (`udfonline.in`, `admin.udfonline.in`, `employee.udfonline.in`)  
**Context:** Independent External Security Review Follow-up  
**Status:** 2 Immediate Configuration Action Items + Analysis of 3 Non-Issue Observations  

---

## Part 1: Action Items for Developer (Copy & Deploy)

### Task 1: Update `firebase.json` with Security Headers (CSP & Permissions-Policy)
**Issue:** The production hosting targets currently lack `Content-Security-Policy` and `Permissions-Policy` headers.  
**Fix:** Add the following two headers to the `source: "**"` block inside each of the 3 hosting targets (`main-site`, `admin-portal`, `employee-portal`) in `firebase.json`:

```json
{
  "key": "Content-Security-Policy",
  "value": "default-src 'self'; script-src 'self' 'unsafe-inline' https://apis.google.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://recaptchaenterprise.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.cloudfunctions.net https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://script.google.com; img-src 'self' data: blob: https://*.firebasestorage.app https://*.googleusercontent.com https://udfonline.in; frame-src https://*.firebaseapp.com https://accounts.google.com https://www.google.com/recaptcha/ https://recaptchaenterprise.googleapis.com;"
},
{
  "key": "Permissions-Policy",
  "value": "camera=(self), microphone=(), geolocation=(self)"
}
```

**Deploy Command:**
```bash
firebase deploy --only hosting
```

*(Note: Cloudflare Proxy / Orange Cloud for `admin.udfonline.in` and `employee.udfonline.in` has already been enabled in Cloudflare DNS.)*

---

## Part 2: Technical Breakdown of the Other 3 Observations (Why They Are Safe)

An external audit report highlighted 3 other architectural observations based on a passive web scan. Here is the verified technical reality from the actual codebase:

### 1. The Google Apps Script URL Observation (Finding UDF-02)
- **External Report Assumption:** The auditor assumed client browsers post sensitive KYC/identity documents (Aadhaar, PAN, Passbook) directly to an unauthenticated Google Apps Script URL.
- **Actual Code Architecture:**
  - Client uploads **never** post identity documents directly to Google Apps Script. All private KYC uploads go directly to **Google Cloud Storage via 15-minute cryptographically signed URLs (`getUploadUrl` in `functions/index.js:3245`)**.
  - The Google Apps Script URL (`functions/index.js:5543`) is strictly a **secondary server-to-server webhook** invoked by Google Cloud Functions (`streamStorageFileToDriveServer`) as an asynchronous backup trigger.
  - **Verdict:** Safe as implemented; no client-side KYC leak exists.

### 2. Exposed Collection Names & `setAdminClaims` Observation (Finding UDF-03)
- **External Report Assumption:** The auditor saw internal collection names (`employees`, `staff_accounts`, `onboarding_submissions`) and Cloud Function names (`setAdminClaims`) in the compiled JavaScript bundle and was concerned that any user could call `setAdminClaims` to elevate themselves to Admin.
- **Actual Code Architecture:**
  - In modern client-side Single Page Applications (React/Vite), collection names and function endpoints are always visible in compiled client code; security relies entirely on backend enforcement.
  - In `functions/index.js:3480-3565` (`computeAndApplyUserClaims`), `setAdminClaims` does **not** accept a role or permission payload from the client. It strictly takes `context.auth.uid`, performs an internal admin-level lookup against `/staff_accounts` and `/users`, and verifies server-side whether that UID is an active staff member.
  - If an unauthorized user or regular employee calls `setAdminClaims`, the function finds no staff record and explicitly assigns `{ isAdmin: false }`.
  - In addition, `firestore.rules` enforces zero-lookup JWT claim verification on every collection.
  - **Verdict:** Safe as implemented; unauthorized privilege escalation is cryptographically prevented.

### 3. Client-Side `localStorage` for `portalType` Observation (Finding UDF-05)
- **External Report Assumption:** The auditor noted `localStorage.getItem("portalType")` being used for `"admin"` or `"employee"` and flagged potential client-side tampering.
- **Actual Code Architecture:**
  - `portalType` in `localStorage` is used solely as a **cosmetic UI routing hint** (e.g., determining whether to present the staff login form or the employee login form).
  - It is **never** used for authorization. Every database read and write is validated against the cryptographically signed Firebase Auth ID token and Firestore Security Rules. Modifying `localStorage` in browser DevTools only affects local UI navigation and grants zero database permissions.
  - **Verdict:** Safe as implemented; cosmetic routing hint only.
