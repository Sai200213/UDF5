# UDF Portal — Master Audit, Cloud-Level Security Architecture & Feature Roadmap (Commit `575c3d2`)

**Repository:** [`https://github.com/Sai200213/udf-portal`](https://github.com/Sai200213/udf-portal)  
**Latest Audited Commit:** [575c3d29e4583fb830cc6a57c2adb41d737d8cb8](https://www.google.com/search?q=https://github.com/Sai200213/udf-portal/commit/575c3d29e4583fb830cc6a57c2adb41d737d8cb8) (`575c3d2`)  
**Previous Baseline Commit:** [fa18e254a7229b924fec577ca02f6c1c5418c17b](https://www.google.com/search?q=https://github.com/Sai200213/udf-portal/commit/fa18e254a7229b924fec577ca02f6c1c5418c17b) (`fa18e25`)  
**Scope:**
1. **Part 1:** Developer-Agent Execution Spec for all **8 Active Flaws in Commit `575c3d2`** (with exact file paths, line numbers, and drop-in code blocks).
2. **Part 2:** **Cloud-Level Security & Backend Migration Blueprint** — Following your recent migration of `storage.rules` (`allow read, write: if false;` + signed URL Cloud Functions) and Custom Claims RBAC, this section details the **8 next high-impact migrations from Client-Side / Rules to Cloud Functions** so sensitive business logic, multi-doc workflows, and guest tokens are 100% server-enforced.
3. **Part 3:** **High-Impact New Product Features & Operational Enhancements** tailored specifically for UDF Portal's HR, site operations, compliance, and employee lifecycle workflows.
4. **Part 4:** Verification Scorecard of the 32 Findings from `fa18e25` (26 Fixed, 6 Residual/Regressed).

---

## Part 1: Developer Agent Action Plan — Fix All 8 Active Flaws in `575c3d2`

> **Instructions for Developer Agent:** Apply each of the 8 patches below in sequence. Every file path and line number references commit `575c3d29e4583fb830cc6a57c2adb41d737d8cb8`.

---

### TASK 1 (`CORRECTION-FLOW-01` — Critical): Fix Data Correction Guest Read Permissions, Applicant Name Corruption & PII Exposure

**Target Files:**
1. `firestore.rules` (Lines `184-188` and `216-220`)
2. `src/services/employeeService.ts` (Lines `4845-4865` and `5022-5030`)
3. `utils/formDataHelper.ts` (Lines `46-55`)

#### Step 1A: Allow Guest `get` When `hasActiveCorrectionToken(resource.data)` Is True (`firestore.rules:184-188, 216-220`)
Without this rule, `getDoc(targetRef)` in `submitCorrectionResponse` (`src/services/employeeService.ts:4846`) throws `permission-denied` for unauthenticated candidates/employees using a correction link, causing `targetData` to be `{}` and corrupting `applicantName` and `driveFolderName`.

**In `firestore.rules` (Lines `184-188`), replace:**
```javascript
    match /employees/{userId} {
      allow get: if resource == null ||
                    isSelfEmployee(userId, resource.data) || 
                    (isAdmin() && canStaffViewSite(resource.data.get('currentSiteId', resource.data.get('siteId', ''))));
```
**With:**
```javascript
    match /employees/{userId} {
      allow get: if resource == null ||
                    hasActiveCorrectionToken(resource.data) ||
                    isSelfEmployee(userId, resource.data) || 
                    (isAdmin() && canStaffViewSite(resource.data.get('currentSiteId', resource.data.get('siteId', ''))));
```

**In `firestore.rules` (Lines `216-220`), replace:**
```javascript
    match /onboarding_submissions/{id} {
      allow get: if resource == null ||
                    isSelfSubmission(resource.data) || 
                    (isAdmin() && canStaffViewSite(resource.data.get('siteId', '')));
```
**With:**
```javascript
    match /onboarding_submissions/{id} {
      allow get: if resource == null ||
                    hasActiveCorrectionToken(resource.data) ||
                    isSelfSubmission(resource.data) || 
                    (isAdmin() && canStaffViewSite(resource.data.get('siteId', '')));
```

#### Step 1B: Prevent `getApplicantName` From Overwriting `applicantName` When Name Fields Were Not Part of the Correction (`src/services/employeeService.ts:5022-5030` & `utils/formDataHelper.ts:46-55`)
**In `src/services/employeeService.ts` (Lines `5022-5030`), replace:**
```typescript
        // Also update applicantName if name field was updated
        const combinedForm = { ...(targetData.formData || {}), ...processedData };
        if (sectionsToUse.length > 0) {
            const newName = getApplicantName(combinedForm, sectionsToUse);
            if (newName && newName !== targetData.applicantName) {
                updates.applicantName = newName;
                updates.driveFolderName = `${req.targetId} - ${newName}`;
            }
```
**With:**
```typescript
        // Only update applicantName if an actual name field was modified in processedData
        const combinedForm = { ...(targetData.formData || {}), ...processedData };
        const nameFieldUpdated = Object.keys(processedData).some(k =>
            /name|first_?name|last_?name|full_?name/i.test(k) ||
            sectionsToUse.some((s: any) => s.fields?.some((f: any) => f.id === k && /name/i.test(f.label || '')))
        );
        if (sectionsToUse.length > 0 && nameFieldUpdated) {
            const newName = getApplicantName(combinedForm, sectionsToUse);
            if (newName && newName !== 'Unknown' && newName !== targetData.applicantName) {
                updates.applicantName = newName;
                updates.driveFolderName = `${req.targetId} - ${newName}`;
            }
```

**In `utils/formDataHelper.ts` (Lines `46-55`), remove the blind first-string fallback at the end of `getApplicantName` so it never returns a PAN/Bank/IFSC string as a person's name.**

---

### TASK 2 (`ATTACH-VIEW-01` — High): Fix Missing / Broken Supporting Document & Proof Rendering Across 4 Modules

**Target Files:**
1. `components/AdminAccountUpdateManagementPage.tsx` (Lines `142-148`)
2. `components/AdminLeaveManagementPage.tsx` (Lines `320-346`)
3. `components/AdminResignationManagementPage.tsx` (Lines `206-212`)
4. `components/employee/EmployeeDisciplinaryPage.tsx` (Lines `76-84`) & `components/AdminDisciplinaryPage.tsx` (Lines `187-193`)

#### Step 2A: Render `supportingDocument` and File `requestedValue` in `components/AdminAccountUpdateManagementPage.tsx` (Lines `142-148`)
Ensure `SecureDocumentLink` is imported at the top of `components/AdminAccountUpdateManagementPage.tsx` (`import SecureDocumentLink from './SecureDocumentLink';`).

**Replace lines `142-148`:**
```tsx
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-400 uppercase font-bold">Employee</p><p>{selectedRequest.employeeName}</p></div>
              <div><p className="text-xs text-gray-400 uppercase font-bold">Update Field</p><p>{selectedRequest.fieldLabel}</p></div>
              <div><p className="text-xs text-gray-400 uppercase font-bold">Current</p><p className="text-gray-500">{String(selectedRequest.currentValue || 'None')}</p></div>
              <div><p className="text-xs text-blue-600 uppercase font-bold">Requested</p><p className="font-bold text-blue-700">{String(selectedRequest.requestedValue)}</p></div>
            </div>
```
**With:**
```tsx
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-400 uppercase font-bold">Employee</p><p>{selectedRequest.employeeName}</p></div>
              <div><p className="text-xs text-gray-400 uppercase font-bold">Update Field</p><p>{selectedRequest.fieldLabel}</p></div>
              <div>
                <p className="text-xs text-gray-400 uppercase font-bold">Current</p>
                {typeof selectedRequest.currentValue === 'string' && (selectedRequest.currentValue.startsWith('employees/') || selectedRequest.currentValue.startsWith('onboarding/') || selectedRequest.currentValue.startsWith('http')) ? (
                  <SecureDocumentLink path={selectedRequest.currentValue} className="text-sm text-gray-600 underline">View Current File</SecureDocumentLink>
                ) : (
                  <p className="text-gray-500">{String(selectedRequest.currentValue || 'None')}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-blue-600 uppercase font-bold">Requested</p>
                {typeof selectedRequest.requestedValue === 'string' && (selectedRequest.requestedValue.startsWith('employees/') || selectedRequest.requestedValue.startsWith('onboarding/') || selectedRequest.requestedValue.startsWith('http')) ? (
                  <SecureDocumentLink path={selectedRequest.requestedValue} className="text-sm font-bold text-blue-700 underline">View New Uploaded File</SecureDocumentLink>
                ) : (
                  <p className="font-bold text-blue-700">{String(selectedRequest.requestedValue)}</p>
                )}
              </div>
            </div>

            {(selectedRequest.supportingDocument || (selectedRequest as any).document) && (
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-md flex items-center justify-between">
                <span className="text-xs font-bold text-blue-800 uppercase">Supporting Proof Document</span>
                <SecureDocumentLink
                  path={selectedRequest.supportingDocument || (selectedRequest as any).document}
                  className="text-sm font-semibold text-blue-600 hover:text-blue-800 underline"
                >
                  View Attached Proof
                </SecureDocumentLink>
              </div>
            )}
```

#### Step 2B: Render `supportingDoc` / `document` in `components/AdminLeaveManagementPage.tsx` (After Line `345`)
Ensure `SecureDocumentLink` is imported at the top of `components/AdminLeaveManagementPage.tsx` (`import SecureDocumentLink from './SecureDocumentLink';`).

**Insert immediately after line `345`:**
```tsx
                        {((selectedRequest as any).supportingDoc || (selectedRequest as any).document || (selectedRequest as any).supportingDocument) && (
                            <div className="bg-indigo-50 border border-indigo-100 rounded-md p-3 flex items-center justify-between">
                                <span className="text-xs font-bold text-indigo-800 uppercase">Supporting / Medical Document</span>
                                <SecureDocumentLink
                                    path={typeof ((selectedRequest as any).supportingDoc || (selectedRequest as any).document) === 'string'
                                        ? ((selectedRequest as any).supportingDoc || (selectedRequest as any).document)
                                        : ((selectedRequest as any).document?.url || (selectedRequest as any).supportingDocument)}
                                    className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 underline"
                                >
                                    View Attached Document
                                </SecureDocumentLink>
                            </div>
                        )}
```

#### Step 2C: Fix `selectedRequest.document` String Path Rendering in `components/AdminResignationManagementPage.tsx` (Lines `206-211`)
Ensure `SecureDocumentLink` is imported at the top of `components/AdminResignationManagementPage.tsx` (`import SecureDocumentLink from './SecureDocumentLink';`).

**Replace lines `206-211`:**
```tsx
            {selectedRequest.document && (
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-md flex items-center">
                <CheckCircle size={16} className="text-blue-500 mr-2" />
                <span className="text-sm text-blue-700 font-medium">{selectedRequest.document.name} (Uploaded)</span>
              </div>
            )}
```
**With:**
```tsx
            {selectedRequest.document && (
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-md flex items-center justify-between">
                <div className="flex items-center">
                  <CheckCircle size={16} className="text-blue-500 mr-2" />
                  <span className="text-sm text-blue-700 font-medium">
                    {typeof selectedRequest.document === 'string' ? 'Resignation Letter Attached' : (selectedRequest.document.name || 'Resignation Letter')}
                  </span>
                </div>
                <SecureDocumentLink
                  path={typeof selectedRequest.document === 'string' ? selectedRequest.document : selectedRequest.document.url}
                  className="text-sm font-semibold text-blue-600 hover:text-blue-800 underline"
                >
                  View Document
                </SecureDocumentLink>
              </div>
            )}
```

#### Step 2D: Fix `action.document` vs `action.documentUrl` Mismatch in Disciplinary Pages
1. **In `components/employee/EmployeeDisciplinaryPage.tsx` (Lines `76-83`), replace:**
```tsx
                                        {action.documentUrl && (
                                            <SecureDocumentLink
                                                path={action.documentUrl}
                                                className="mt-3 inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-800 underline"
                                            >
                                                <Info size={16} className="mr-1" /> View Warning Letter / Proof
                                            </SecureDocumentLink>
                                        )}
```
**With:**
```tsx
                                        {(action.documentUrl || (action as any).document) && (
                                            <SecureDocumentLink
                                                path={action.documentUrl || (action as any).document}
                                                className="mt-3 inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-800 underline"
                                            >
                                                <Info size={16} className="mr-1" /> View Warning Letter / Proof
                                            </SecureDocumentLink>
                                        )}
```
2. **In `components/AdminDisciplinaryPage.tsx` (Lines `187-189`), render a `<SecureDocumentLink>` under the description when `action.documentUrl || (action as any).document` is present:**
```tsx
                <td className="px-6 py-4 text-sm text-gray-600 max-w-xs" title={action.description}>
                  <div className="truncate">{action.description}</div>
                  {(action.documentUrl || (action as any).document) && (
                    <SecureDocumentLink
                      path={action.documentUrl || (action as any).document}
                      className="text-xs font-semibold text-blue-600 hover:underline mt-1 inline-block"
                    >
                      View Attached Proof
                    </SecureDocumentLink>
                  )}
                </td>
```

---

### TASK 3 (`RULES-STAFF-LIST-01` — High Security): Prevent Any Google User From Listing All Admin & Staff Accounts

**Target File:** `firestore.rules` (Lines `162-181`)

**Replace lines `162-181`:**
```javascript
    match /users/{userId} {
      allow get: if isAuthenticated() && (request.auth.uid == userId || isAdmin() || (request.auth.token.get('email', '') != '' && request.auth.token.email == resource.data.get('email', '')));
      allow list: if isAdmin() || (isAuthenticated() && request.auth.token.get('email', '') != '');
      allow write: if isSuperAdmin();
    }

    // ─── Staff Accounts ─────────────────────────────────────────────────────
    match /staff_accounts/{userId} {
      allow get: if isAuthenticated() && (request.auth.uid == userId || isAdmin() || (request.auth.token.get('email', '') != '' && request.auth.token.email == resource.data.get('email', '')));
      allow list: if isAdmin() || (isAuthenticated() && request.auth.token.get('email', '') != '');
      allow update: if isSuperAdmin() || (isAuthenticated() && (request.auth.uid == userId || (request.auth.token.get('email', '') != '' && request.auth.token.email == resource.data.get('email', ''))) && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['profilePhotoURL', 'updatedAt', 'lastUpdated']));
      allow create, delete: if isSuperAdmin();
    }

    match /staff/{userId} {
      allow get: if isAuthenticated() && (request.auth.uid == userId || isAdmin() || (request.auth.token.get('email', '') != '' && request.auth.token.email == resource.data.get('email', '')));
      allow list: if isAdmin() || (isAuthenticated() && request.auth.token.get('email', '') != '');
      allow update: if isSuperAdmin() || (isAuthenticated() && (request.auth.uid == userId || (request.auth.token.get('email', '') != '' && request.auth.token.email == resource.data.get('email', ''))) && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['profilePhotoURL', 'updatedAt', 'lastUpdated']));
      allow create, delete: if isSuperAdmin();
    }
```
**With:**
```javascript
    match /users/{userId} {
      allow get, list: if isAuthenticated() && (request.auth.uid == userId || isAdmin() || (request.auth.token.get('email', '') != '' && request.auth.token.email == resource.data.get('email', '')));
      allow write: if isSuperAdmin();
    }

    // ─── Staff Accounts ─────────────────────────────────────────────────────
    match /staff_accounts/{userId} {
      allow get, list: if isAuthenticated() && (request.auth.uid == userId || isAdmin() || (request.auth.token.get('email', '') != '' && request.auth.token.email == resource.data.get('email', '')));
      allow update: if isSuperAdmin() || (isAuthenticated() && (request.auth.uid == userId || (request.auth.token.get('email', '') != '' && request.auth.token.email == resource.data.get('email', ''))) && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['profilePhotoURL', 'updatedAt', 'lastUpdated']));
      allow create, delete: if isSuperAdmin();
    }

    match /staff/{userId} {
      allow get, list: if isAuthenticated() && (request.auth.uid == userId || isAdmin() || (request.auth.token.get('email', '') != '' && request.auth.token.email == resource.data.get('email', '')));
      allow update: if isSuperAdmin() || (isAuthenticated() && (request.auth.uid == userId || (request.auth.token.get('email', '') != '' && request.auth.token.email == resource.data.get('email', ''))) && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['profilePhotoURL', 'updatedAt', 'lastUpdated']));
      allow create, delete: if isSuperAdmin();
    }
```

---

### TASK 4 (`CLAIMS-EMAIL-SYNC-01` — High): Fix `setAdminClaims` Wiping Claims for `staff` Collection & Email-Matched Admins

**Target File:** `functions/index.js` (Lines `3187-3228`)

**Replace lines `3187-3228` in `functions/index.js`:**
```javascript
        // Look up the user in staff_accounts first, then users (super-admins)
        const [staffAccSnap, userSnap] = await Promise.all([
            db.collection('staff_accounts').doc(uid).get(),
            db.collection('users').doc(uid).get()
        ]);

        const staffDoc = staffAccSnap.exists ? staffAccSnap.data() : null;
        const userDoc = userSnap.exists ? userSnap.data() : null;
        const doc = staffDoc || userDoc;
```
**With:**
```javascript
        // Look up the user in staff_accounts, users, and legacy staff by UID first, then by email fallback
        const [staffAccSnap, userSnap, legacyStaffSnap] = await Promise.all([
            db.collection('staff_accounts').doc(uid).get(),
            db.collection('users').doc(uid).get(),
            db.collection('staff').doc(uid).get()
        ]);

        let resolvedDocId = uid;
        let staffDoc = staffAccSnap.exists ? staffAccSnap.data() : (legacyStaffSnap.exists ? legacyStaffSnap.data() : null);
        let userDoc = userSnap.exists ? userSnap.data() : null;
        let doc = staffDoc || userDoc;

        if (!doc) {
            const authUser = await admin.auth().getUser(uid).catch(() => null);
            const email = authUser && authUser.email ? authUser.email.trim() : '';
            if (email) {
                for (const colName of ['staff_accounts', 'users', 'staff']) {
                    const qSnap = await db.collection(colName).where('email', '==', email).limit(1).get();
                    if (!qSnap.empty) {
                        resolvedDocId = qSnap.docs[0].id;
                        doc = qSnap.docs[0].data();
                        if (colName === 'users') userDoc = doc;
                        else staffDoc = doc;
                        break;
                    }
                }
            }
        }
```
And at lines `3219-3224` of `functions/index.js`, update the supervisor site check so it matches `uid`, `resolvedDocId`, `doc.username`, and `doc.employeeId`:
```javascript
                const adminIdentifiers = new Set([uid, resolvedDocId, doc.id, doc.username, doc.employeeId].filter(Boolean));
                for (const s of list) {
                    if (!s || !s.id) continue;
                    const supIds = Array.isArray(s.supervisorIds) ? s.supervisorIds : [];
                    if (adminIdentifiers.has(s.supervisorId) || supIds.some(id => adminIdentifiers.has(id))) {
                        sitesManagedSet.add(s.id);
                    }
                }
```

---

### TASK 5 (`STORAGE-CF-EDGE-01` — High): Fix `deleteStoragePath` Legacy Employee ID Fallback & `getStorageFolderSizeServer` Onboarding Authorization

**Target File:** `functions/index.js` (Lines `2079-2095` and `2144-2156`)

#### Step 5A: Add `employeeId` & `portalId` Query Fallback in `deleteStoragePath` (`functions/index.js:2079-2095`)
**Replace lines `2079-2095`:**
```javascript
        } else if (cleanPath.startsWith('employees/')) {
            const empId = cleanPath.split('/')[1];
            if (empId) {
                const empDoc = await db.collection('employees').doc(empId).get();
                if (empDoc.exists) {
                    const ed = empDoc.data();
                    if (ed.linkedUid === uid || ed.uid === uid || ed.portalId === uid) {
                        isAuthorized = true;
                    } else if (ed.activeCorrectionToken) {
                        const crDoc = await db.collection('correction_requests').doc(ed.activeCorrectionToken).get();
                        if (crDoc.exists && crDoc.data().status === 'pending') {
                            isAuthorized = true;
                        }
                    }
                }
            }
        }
```
**With:**
```javascript
        } else if (cleanPath.startsWith('employees/')) {
            const empId = cleanPath.split('/')[1];
            if (empId) {
                let empDoc = await db.collection('employees').doc(empId).get();
                if (!empDoc.exists) {
                    const byEmpId = await db.collection('employees').where('employeeId', '==', empId).limit(1).get();
                    if (!byEmpId.empty) empDoc = byEmpId.docs[0];
                    else {
                        const byPortalId = await db.collection('employees').where('portalId', '==', empId).limit(1).get();
                        if (!byPortalId.empty) empDoc = byPortalId.docs[0];
                    }
                }
                if (empDoc && empDoc.exists) {
                    const ed = empDoc.data();
                    if (ed.linkedUid === uid || ed.uid === uid || ed.portalId === uid) {
                        isAuthorized = true;
                    } else if (ed.activeCorrectionToken) {
                        const crDoc = await db.collection('correction_requests').doc(ed.activeCorrectionToken).get();
                        if (crDoc.exists && crDoc.data().status === 'pending') {
                            isAuthorized = true;
                        }
                    }
                }
            }
        }
```

#### Step 5B: Authorize `onboarding/${draftId}` in `getStorageFolderSizeServer` (`functions/index.js:2144-2156`)
**Replace lines `2144-2156`:**
```javascript
    // Check authorization: caller can view their own folder or must be staff/admin
    let isAuthorized = cleanPath.startsWith(`onboarding/${uid}`) || cleanPath.startsWith(`draft_submissions/${uid}`) || cleanPath.startsWith(`employees/${uid}`);
    if (!isAuthorized) {
        if (request.auth.token && (request.auth.token.isAdmin || request.auth.token.isSuperAdmin)) {
            isAuthorized = true;
        } else {
            const staffSnap = await db.collection('staff_accounts').doc(uid).get();
            if (staffSnap.exists) isAuthorized = true;
        }
    }
```
**With:**
```javascript
    // Check authorization: caller can view their own folder or must be staff/admin
    let isAuthorized = cleanPath.startsWith(`onboarding/${uid}`) || cleanPath.startsWith(`draft_submissions/${uid}`) || cleanPath.startsWith(`employees/${uid}`);
    if (!isAuthorized) {
        if (request.auth.token && (request.auth.token.isAdmin || request.auth.token.isSuperAdmin)) {
            isAuthorized = true;
        } else {
            const staffSnap = await db.collection('staff_accounts').doc(uid).get();
            if (staffSnap.exists) isAuthorized = true;
        }
    }
    if (!isAuthorized && cleanPath.startsWith('onboarding/')) {
        const draftId = cleanPath.split('/')[1];
        if (draftId) {
            const [draftSnap, subSnap] = await Promise.all([
                db.collection('draft_submissions').doc(draftId).get(),
                db.collection('onboarding_submissions').doc(draftId).get()
            ]);
            if (draftSnap.exists) {
                const dd = draftSnap.data();
                if (!dd.ownerUid || dd.ownerUid === uid || !dd.isGoogleDraft) isAuthorized = true;
            }
            if (!isAuthorized && subSnap.exists) {
                const sd = subSnap.data();
                if (sd.uid === uid || sd.linkedUid === uid || sd.ownerUid === uid || sd.activeCorrectionToken) isAuthorized = true;
            }
        }
    }
```

---

### TASK 6 (`RECYCLE-PURGE-01` — Medium-High): Complete Permanent Purge in `src/services/recycleBinService.ts`

**Target File:** `src/services/recycleBinService.ts` (Lines `264-292`)

**Replace lines `264-292`:**
```typescript
export async function permanentDeleteFromRecycleBin(recycleBinItemId: string): Promise<void> {
  const binDocRef = doc(db, RECYCLE_BIN_COLLECTION, recycleBinItemId);
  const snap = await getDoc(binDocRef);
  if (snap.exists()) {
    const binData = snap.data();
    if (binData.itemType === 'STAFF' && binData.originalId) {
      try {
        const { deleteStaffUser } = await import('./staffService');
        await deleteStaffUser(binData.originalId);
      } catch (authErr) {
        console.warn('Could not delete Firebase Auth user during permanent purge:', authErr);
      }
    }
  }
  await deleteDoc(binDocRef);
}

/**
 * Permanently purge all items currently in the Recycle Bin.
 */
export async function emptyRecycleBin(): Promise<number> {
  const snap = await getDocs(collection(db, RECYCLE_BIN_COLLECTION));
  let count = 0;
  for (const d of snap.docs) {
    await deleteDoc(d.ref);
    count++;
  }
  return count;
}
```
**With:**
```typescript
export async function permanentDeleteFromRecycleBin(recycleBinItemId: string): Promise<void> {
  const binDocRef = doc(db, RECYCLE_BIN_COLLECTION, recycleBinItemId);
  const snap = await getDoc(binDocRef);
  if (snap.exists()) {
    const binData = snap.data();
    const originalId = binData.originalId;
    if (originalId) {
      try {
        if (binData.itemType === 'STAFF') {
          const { deleteStaffUser } = await import('./staffService');
          await deleteStaffUser(originalId);
        } else if (binData.itemType === 'EMPLOYEE') {
          const { permanentDeleteEmployee } = await import('./employeeService');
          await permanentDeleteEmployee(originalId);
        } else if (binData.itemType === 'SUBMISSION') {
          const { deleteSubmission } = await import('./employeeService');
          await deleteSubmission(originalId);
        }
      } catch (purgeErr) {
        console.warn(`Could not purge underlying ${binData.itemType} (${originalId}):`, purgeErr);
      }
    }
  }
  await deleteDoc(binDocRef);
}

/**
 * Permanently purge all items currently in the Recycle Bin.
 */
export async function emptyRecycleBin(): Promise<number> {
  const snap = await getDocs(collection(db, RECYCLE_BIN_COLLECTION));
  let count = 0;
  for (const d of snap.docs) {
    await permanentDeleteFromRecycleBin(d.id);
    count++;
  }
  return count;
}
```

---

### TASK 7 (`RULES-SETTINGS-PERM-01` — Medium-High): Align Granular Permissions in `firestore.rules`

**Target File:** `firestore.rules` (Lines `149-150` and `368`)

1. **In `firestore.rules` (Lines `149-150`), replace:**
```javascript
        (docId == 'gamification_rules' && hasPermission('MANAGE_SYSTEM')) ||
        (docId == 'legacy_claim_config' && hasPermission('MANAGE_SYSTEM')) ||
```
**With:**
```javascript
        (docId == 'gamification_rules' && (hasPermission('MANAGE_SYSTEM') || hasPermission('GAMIFICATION_MANAGE'))) ||
        (docId == 'legacy_claim_config' && (hasPermission('MANAGE_SYSTEM') || hasPermission('EMPLOYEES_IMPORT'))) ||
```

2. **In `firestore.rules` (Line `368`), replace:**
```javascript
      allow write: if hasPermission('DISCIPLINE_MANAGE') || hasPermission('DISCIPLINE_CREATE') || isSuperAdmin();
```
**With:**
```javascript
      allow create, update: if hasPermission('DISCIPLINE_MANAGE') || hasPermission('DISCIPLINE_CREATE') || hasPermission('DISCIPLINE_ISSUE') || isSuperAdmin();
      allow delete: if hasPermission('DISCIPLINE_MANAGE') || hasPermission('DISCIPLINE_DELETE') || isSuperAdmin();
```

---

### TASK 8 (`GFORM-URL-01` — Medium): Sequence Google Drive Sync Before Google Forms Sync so Sheet Links Are Accessible

**Target File:** `src/services/employeeService.ts` (Lines `1041-1063`)

**Replace lines `1041-1063`:**
```typescript
        // Detached background pipeline: Auto-sync to Google Drive + Google Form in background
        // 1. Immediately trigger Google Form sync first (fast ~1.5s execution, ensures Google Sheet row is recorded even if user exits!)
        setTimeout(async () => {
            try {
                log.log(`[BACKGROUND_PIPELINE] Immediately syncing to Google Form for ${submissionId}...`);
                await syncSubmissionToGoogleForm(submissionId);
                log.log(`[BACKGROUND_PIPELINE] ✅ Immediate Google Form sync completed for ${submissionId}`);
            } catch (formErr) {
                console.warn(`[BACKGROUND_PIPELINE] Immediate Google Form sync error for ${submissionId}:`, formErr);
            }
        }, 50);

        // 2. Drive file backup in background
        setTimeout(async () => {
            try {
                log.log(`[BACKGROUND_PIPELINE] Starting background Drive backup for ${submissionId}...`);
                await syncDriveFolder(submissionId);
                log.log(`[BACKGROUND_PIPELINE] ✅ Completed background Drive backup for ${submissionId}`);
            } catch (syncErr) {
                console.warn(`[BACKGROUND_PIPELINE] Background Drive sync error for ${submissionId}:`, syncErr);
            }
        }, 200);
```
**With:**
```typescript
        // Detached background pipeline: Sync files to Google Drive first so Drive links are saved on the submission, then sync to Google Form
        setTimeout(async () => {
            try {
                log.log(`[BACKGROUND_PIPELINE] Starting background Drive backup for ${submissionId}...`);
                await syncDriveFolder(submissionId);
                log.log(`[BACKGROUND_PIPELINE] ✅ Completed background Drive backup for ${submissionId}`);
            } catch (syncErr) {
                console.warn(`[BACKGROUND_PIPELINE] Background Drive sync error for ${submissionId}:`, syncErr);
            } finally {
                try {
                    log.log(`[BACKGROUND_PIPELINE] Syncing submission (with Drive links) to Google Form for ${submissionId}...`);
                    await syncSubmissionToGoogleForm(submissionId);
                    log.log(`[BACKGROUND_PIPELINE] ✅ Google Form sync completed for ${submissionId}`);
                } catch (formErr) {
                    console.warn(`[BACKGROUND_PIPELINE] Google Form sync error for ${submissionId}:`, formErr);
                }
            }
        }, 100);
```

---

## Part 2: Cloud-Level Security & Architecture Migration Blueprint (Moving Client-Side Trust to Cloud Functions)

Just as you recently locked down `storage.rules` (`allow read, write: if false;`) behind Cloud Function signed URLs (`getUploadUrl`, `getSignedViewUrl`, `deleteStoragePath`) and migrated Admin RBAC to Firebase Custom Claims (`setAdminClaims`), the following **8 Cloud-Level Migrations** eliminate the remaining places where sensitive business logic, multi-collection transactions, or guest tokens still rely on client-side execution or permissive `firestore.rules`.

| # | Migration Module | Current Client-Side / Rule Vulnerability in `575c3d2` | Target Cloud-Level Architecture (`functions/index.js` + `firestore.rules`) |
| :--- | :--- | :--- | :--- |
| **CLOUD-1** | **Data Correction Flow (`correction_requests`)** | `firestore.rules:476` sets `allow get: if true;` on `/correction_requests/{id}`, exposing `verificationDob`, `verificationPhone`, and `requestedFieldValues` to the browser *before* verification. Then `DataCorrectionPage.tsx` verifies DOB/Phone in client JS and writes directly to `/employees` or `/onboarding_submissions`. | **Lock `/correction_requests` to `allow read, write: if isAdmin();`.** Add 3 Cloud Functions:<br>1. `getCorrectionChallenge({ requestId })`: Returns only `{ applicantName, status, expiresAt, maskedPhone }`.<br>2. `verifyCorrectionIdentity({ requestId, dob, phone })`: Enforces server-side rate limiting (`failedAttempts < 5`), verifies DOB/phone on the backend, and returns `requestedFieldDefinitions`, `requestedFieldValues`, and an HMAC-signed `correctionSessionToken`.<br>3. `submitCorrectionServer({ requestId, correctionSessionToken, updatedData })`: Validates the token and updates `/employees` or `/onboarding_submissions` via Admin SDK—allowing you to **remove `hasActiveCorrectionToken` guest write access from `firestore.rules` entirely**. |
| **CLOUD-2** | **Draft Recovery & Onboarding Submission Pipeline (`draft_submissions` & `onboarding_submissions`)** | `firestore.rules:241-257` sets `allow get: if true;` and allows anyone to update/delete non-Google drafts (`isGoogleDraft == false`). Worse, `submitEmployeeForm` (`employeeService.ts:624-1064`) runs a 400-line client orchestration and fires Google Drive + Google Form sync inside browser `setTimeout(..., 50 / 200)`—which silently aborts if the candidate closes their browser tab after clicking Submit! | **Lock `/draft_submissions` to `allow read, write: if false;` for unauthenticated users.**<br>1. Add `getOrSaveDraftServer({ recoveryCode, draftData })` and `submitOnboardingServer({ draftId, formData })`.<br>2. Add a **Firestore v2 Trigger `onDocumentCreated('onboarding_submissions/{submissionId}')`** in `functions/index.js` that automatically runs duplicate detection, syncs files to Google Drive, updates `driveFolderUrl`, and posts the row to Google Forms/Sheets **100% server-side**, guaranteeing completion even if the user closes their mobile browser immediately. |
| **CLOUD-3** | **Automatic Custom Claims Sync Trigger (`onStaffOrRoleUpdated`)** | You migrated `firestore.rules` to check `request.auth.token.permissions` and `sitesManaged`. However, when a SuperAdmin updates a Role (`roles/{roleId}`), edits `settings/sites`, or edits `staff_accounts/{id}`, the target staff member's Custom Claims remain stale until `refreshAdminClaims` is manually called. | **Add Firestore v2 `onDocumentWritten` Triggers** on `staff_accounts/{id}`, `users/{id}`, `staff/{id}`, `roles/{roleId}`, and `settings/sites` in `functions/index.js`. Whenever a role's permissions or a site's supervisor changes, the trigger automatically recomputes `admin.auth().setCustomUserClaims(uid, claims)` for all affected staff members and stamps `claimsUpdatedAt` on their profile doc so the client's `onSnapshot` listener automatically calls `auth.currentUser.getIdToken(true)` in real time. |
| **CLOUD-4** | **Multi-Level Approval Engine for Leave, Resignation & Account Updates (`processRequestReviewServer`)** | When a Supervisor or HR Admin approves/rejects a request (`App.tsx:1215-1450`), the **browser** computes the next workflow level, mutates `emp.leaveBalance` (`updateEmployeeLeaveBalance`), or overwrites sensitive fields (`bankAccountNumber`, `panNumber`, `aadhaarNumber`) on `/employees/{id}`. This forces `firestore.rules` to grant broad `update` permissions on `/employees` and request collections. | **Move all request approvals to a single Callable `processRequestReviewServer({ requestType, requestId, action, comment })`.**<br>- Verifies the caller holds the exact role/site authority required for `request.currentLevel` according to `settings/workflows`.<br>- Runs inside `db.runTransaction()` to advance `currentLevel` or mark `Approved`/`Rejected`.<br>- On final approval, atomically deducts `leaveBalance` (preventing double-deduction or race conditions) or applies the approved `AccountUpdate` field to `/employees/{id}` and `/onboarding_submissions/{id}`.<br>- Lock `leave_requests`, `account_updates`, and `resignations` `update` rules to `if false;` (server-only mutation). |
| **CLOUD-5** | **Atomic Employee Lifecycle State Machine (`approveOnboardingServer`, `relieveEmployeeServer`, `rejoinEmployeeServer`)** | `approveOnboardingSubmission` (`employeeService.ts:1833`), `relieveEmployee` (`line 2343`), and `rejoinEmployee` (`line 2413`) execute 6–10 sequential client-side Firestore/Storage/Drive calls. If the admin's connection drops mid-way, the employee is left in a corrupted half-approved or half-relieved state. | **Move all 3 lifecycle transitions into transactional Cloud Functions:**<br>- `approveOnboardingServer({ submissionId, assignedEmployeeId, siteId, joiningDate })`<br>- `relieveEmployeeServer({ employeeId, relievingDate, reason, remarks })`<br>- `rejoinEmployeeServer({ employeeId, newEmployeeId, newSiteId, rejoinDate })`<br>Each function runs a single `db.runTransaction()` across `employees`, `onboarding_submissions`, and `employee_documents`, moves Storage files directly inside the GCP bucket, and disables/enables the Firebase Auth account atomically. |
| **CLOUD-6** | **Server-Enforced Immutable Audit Trail & Gamification Ledger (`audit_logs` & `gamification_logs`)** | `firestore.rules:421` allows any authenticated user (`isAuthenticated()`) to `create` arbitrary documents in `/audit_logs`, and allows client-side writes to `/gamification_logs`. A malicious or compromised client can inject fake audit log entries or spoof point awards. | **Set `allow create, update, delete: if false;` on `/audit_logs` and `/gamification_logs` in `firestore.rules`.**<br>- Emit audit logs automatically from your Cloud Functions (`approveOnboardingServer`, `processRequestReviewServer`, `deleteStoragePath`, etc.) and via a lightweight `logClientAuditEvent` callable that stamps the verified `request.auth.uid`, IP address (`request.rawRequest.ip`), and server timestamp.<br>- Move quiz completion and gamification point awards to `completeTrainingQuizServer({ moduleId, answers })` so quiz answers are graded server-side and points cannot be farmed from the browser console. |
| **CLOUD-7** | **Replace Google Apps Script Proxy (`GOOGLE_APPS_SCRIPT_v7.2.js`) with Native `googleapis` in Cloud Functions** | Currently, `proxyDriveUpload` base64-encodes files and sends them over HTTP to a Google Apps Script Web App URL (`GOOGLE_APPS_SCRIPT_v7.2.js`), which has a 6-minute timeout, 50MB payload cap, no cryptographic JWT verification, and sets files to `ANYONE_WITH_LINK`. | **Use the official `googleapis` Node SDK (`google.drive('v3')` & `google.sheets('v4')`) directly inside `functions/index.js`.**<br>- Stream files directly from Firebase Storage (`bucket.file(path).createReadStream()`) to Google Drive folders without base64 memory bloat.<br>- Keep Drive files restricted to your HR Google Workspace domain/service account instead of `ANYONE_WITH_LINK`.<br>- Append onboarding rows directly to Google Sheets via `sheets.spreadsheets.values.append()` instead of fragile Google Form `entry.xxxx` POST scraping. |
| **CLOUD-8** | **Batch Signed URL Resolver (`getBatchSignedViewUrls`) + Firebase App Check Enforcement** | Opening an employee profile or submission with 10 documents triggers 10 separate `getSignedViewUrl` Cloud Function invocations in parallel, causing cold-start latency spikes. Additionally, callable functions currently have `enforceAppCheck` disabled. | **1. Create `getBatchSignedViewUrls({ paths: string[] })`** in `functions/index.js` that validates ownership once per employee/submission prefix and signs up to 25 storage paths in a single round-trip, paired with a 25-minute client `sessionStorage` cache in `SecureDocumentLink.tsx`.<br>**2. Enable `enforceAppCheck: true`** (with reCAPTCHA Enterprise) on `sendEmailOtp`, `sendSmsOtp`, `getUploadUrl`, and `getSignedViewUrl` to block automated bot abuse. |

---

## Part 3: High-Impact New Features & Product Improvements to Add

### 1. Side-by-Side Document Verification Split-Screen with OCR Diff Highlighting
- **Why it fits UDF Portal:** You already have client-side OCR/parsing in `utils/aadhaarParser.ts` and `utils/panParser.ts`, and admins spend most of their time verifying Aadhaar, PAN, Bank Passbooks/Cancelled Cheques, and Medical Certificates.
- **How to build it:**
  - Upgrade the Admin Submission Review Modal (`SubmissionList.tsx`), Account Update Modal (`AdminAccountUpdateManagementPage.tsx`), and Leave Modal (`AdminLeaveManagementPage.tsx`) into a **2-column split-screen layout**:
    - **Left Pane:** Form fields with automatic **OCR Match Badges** (Green `✓ Matches Uploaded Aadhaar/PAN` or Amber `⚠️ Name/DOB Mismatch Detected`).
    - **Right Pane:** Sticky interactive Document Viewer (PDF & Image pan/zoom/rotate) powered by `getBatchSignedViewUrls` so HR never has to open 10 separate browser tabs to verify a candidate.

### 2. Automated HR Letter Generation & Digital E-Sign Engine (`settings/letter_templates`)
- **Why it fits UDF Portal:** You already include `jspdf` and `html2canvas` for `IDCardGeneratorModal.tsx`. Extending this to HR letters eliminates manual Word/PDF drafting for every hire and exit.
- **How to build it:**
  - Add an **HR Letter Templates Builder** in Admin Settings supporting dynamic placeholders (`{{employeeName}}`, `{{employeeId}}`, `{{designation}}`, `{{siteName}}`, `{{joiningDate}}`, `{{lastWorkingDay}}`, `{{ctc}}`).
  - Automatically generate, watermark, QR-stamp, and email PDFs at key lifecycle events:
    1. **Offer / Appointment Letter** upon `approveOnboardingServer`.
    2. **Site Transfer / Deputation Letter** upon `assignToSite`.
    3. **Show-Cause / Warning Letter** upon issuing a Disciplinary Action.
    4. **Relieving & Experience Certificate** upon final Resignation & Exit Clearance.

### 3. Public QR Code Live Badge & Letter Verification Portal (`/verify/:badgeToken`)
- **Why it fits UDF Portal:** Security guards, client facility managers, and third-party verifiers need a fast way to confirm whether a physical UDF ID Card or Experience Letter is genuine and whether the employee is still **Active** or **Relieved**.
- **How to build it:**
  - Embed a signed verification URL (`https://portal.yourdomain.com/verify/<hmacToken>`) into the QR code on `IDCardGeneratorModal.tsx` and generated HR letters.
  - Create a lightweight public Cloud Function `verifyCredentialPublic({ token })` that returns **only** non-sensitive verification status (`{ valid: true, employeeName, employeeId, designation, currentSiteName, employmentStatus: 'ACTIVE' | 'RELIEVED', photoSignedUrl }`)—never exposing phone numbers, Aadhaar, PAN, or bank details.

### 4. Multi-Department Exit Clearance (No-Dues) & Full-and-Final (FnF) Tracker
- **Why it fits UDF Portal:** Currently, `AdminResignationManagementPage.tsx` only has a single-track workflow approval. In facility/workforce management, relieving an employee without recovering uniforms, ID cards, walkie-talkies, or site keys causes financial loss.
- **How to build it:**
  - Add a **No-Dues Clearance Checklist** inside every Resignation record with 4 sign-off stages:
    1. **Site Supervisor Clearance:** Handover of site keys, tools, and attendance sign-off.
    2. **Admin / Store Clearance:** Return of Uniform, Safety Shoes, and Physical ID Card.
    3. **HR Clearance:** Exit interview & document completion.
    4. **Finance / Payroll Clearance:** Advance recovery & Full-and-Final (FnF) settlement calculation.
  - Pair with a daily scheduled Cloud Function (`deactivateRelievedEmployeesCron`) that automatically disables portal access on `lastWorkingDay + 1` once clearance is completed.

### 5. Cloud-Scheduled Leave Accrual, State Holiday Calendar & LOP Calculation Engine
- **Why it fits UDF Portal:** Currently, leave balances are static numbers initialized on the employee record, and `EmployeeLeaveRequestPage.tsx` calculates calendar days without awareness of site/state public holidays or Loss of Pay (LOP).
- **How to build it:**
  - Add `settings/holiday_calendars` (mapped by State/Site) and `settings/leave_accrual_rules`.
  - Add a monthly scheduled Cloud Function (`onSchedule("0 0 1 * *")`) that automatically credits monthly Casual/Earned leave entitlements and logs each credit in a `leave_ledger` subcollection.
  - Update `EmployeeLeaveRequestPage.tsx` to automatically exclude Sundays and Site Public Holidays from requested leave days (with optional Sandwich Rule toggle per site) and allow splitting excess days into `Loss of Pay (LOP)` when paid balance is insufficient.

### 6. Automated Compliance & Document Expiry Watchdog (`checkDocumentExpiriesCron`)
- **Why it fits UDF Portal:** Workforce deployments require time-bound documents (Police Verification, Driving License, Medical Fitness Certificate, PSARA Guard License, Vendor Contract Expiry, Probation Period End).
- **How to build it:**
  - Add an optional `expiryDate` field to `employee_documents` and dynamic `FILE_UPLOAD` form fields.
  - Add a daily scheduled Cloud Function (`onSchedule("every day 08:30")`) that queries documents expiring in **30, 15, 7, and 1 days**, automatically sends an in-app + email alert to both the Employee and their Site Supervisor, and displays an **"Expiring Soon (Compliance Risk)"** widget on the Admin Dashboard.

### 7. Bulk Monthly Payslip, ESIC & PF UAN Slip Distribution Vault
- **Why it fits UDF Portal:** Employees frequently contact HR for monthly payslips, ESIC e-Pehchan cards, or PF details.
- **How to build it:**
  - Add a **Bulk Payslip Dropzone** in the Admin Portal where HR can upload a single `.zip` file containing PDFs named `<EmployeeID>_<YYYY_MM>.pdf` (e.g., `HY123456_2026_10.pdf`) or a single Excel payroll sheet that auto-renders PDF payslips via Cloud Functions.
  - Employees can view and download their monthly payslips and statutory cards inside a dedicated **Payslips & PF/ESIC** tab in `EmployeePortal.tsx` via `SecureDocumentLink`.

### 8. Server-Side Cursor Pagination & Code-Splitting (`React.lazy`) for 10x Faster Load Times
- **Why it fits UDF Portal:** `App.tsx` currently bundles all Admin, Employee, PDF (`jspdf`), and Excel (`xlsx`) modules into one initial JS download and loads entire collections into memory.
- **How to build it:**
  - Wrap `AdminAnalyticsPage`, `FormBuilderPage`, `IDCardGeneratorModal`, `BulkImportModal`, and `AdminAuditLogsPage` in `React.lazy()` + `<Suspense>` to cut initial mobile 4G bundle size by ~60%.
  - Replace full-collection client filtering on `employees`, `onboarding_submissions`, and `audit_logs` with Firestore server-side cursor pagination (`limit(50)`, `startAfter(lastDoc)`) + server-side search indexes.

---

## Part 4: Verification Scorecard of Previous 32 Findings (`fa18e25` → `575c3d2`)

| ID | Original Issue Summary | Status in `575c3d2` | Verification Details |
| :--- | :--- | :--- | :--- |
| **`CF-STORAGE-01`** | `getUploadUrl` blocked candidate self-onboarding (`onboarding/...`) and legacy IDs | **FIXED** | `functions/index.js:3049-3092` now authorizes `onboarding/${draftId}` via `draft_submissions` / `onboarding_submissions` lookup and resolves `employees` by doc ID, `employeeId`, or `portalId`. |
| **`CF-STORAGE-02`** | `getSignedViewUrl` rejected legacy employee IDs (`HY123456`) when doc ID was `UDF-...` | **FIXED** | `functions/index.js:2995-3028` now falls back to `where('employeeId', '==', empId)` and `where('portalId', '==', empId)`, plus validates active correction tokens for `onboarding/` paths. |
| **`CF-STORAGE-04`** | Client SDK called `deleteObject` / `listAll` directly on locked-down `storage.rules` (`allow read, write: if false;`) | **FIXED (see Task 5 for 2 edge cases)** | Added `deleteStoragePath` (`functions/index.js:2044`) and `getStorageFolderSizeServer` (`functions/index.js:2125`) and wired `src/services/storageService.ts` to call them. |
| **`SETUP-GOOGLE-01`** | `completeEmployeeSetup` crashed with `auth/wrong-password` for Google-linked employees | **FIXED** | `src/services/employeeService.ts:2897-2936` checks `isGoogleLinked` and skips password re-auth/update when the employee authenticated via Google (`google.com`). |
| **`CF-CLAIMS-03`** | `setAdminClaims` & `refreshAdminClaims` ignored the legacy `staff` collection | **PARTIALLY FIXED (see Task 4)** | `refreshAdminClaims` (`functions/index.js:3256-3267`) now checks `staff` and email fallback, **but `setAdminClaims` (`line 3188`) was missed** and still only checks `staff_accounts/{uid}` and `users/{uid}` by doc ID! |
| **`RULES-ANON-02`** | `firestore.rules` blocked admin email fallback and legacy collection queries | **PARTIALLY FIXED (see Task 3)** | Added email-based `get` fallback (`firestore.rules:161-179`), **but `allow list` on lines 164, 171, 178 omitted `request.auth.token.email == resource.data.email`**. |
| **`INDEX-MISSING-01`** | Missing composite index on `notifications` (`recipientId` + `timestamp DESC`) | **FIXED** | Added to `firestore.indexes.json:103-116`. |
| **`RECYCLE-BUG-01`** | `recycleBinService.ts` passed undefined `performer` variable to `logAuditAction` | **FIXED** | `src/services/recycleBinService.ts:227` now passes `restoredBy`. |
| **`BULK-DEL-01`** | `bulkDeleteSubmissions` passed string `'Admin'` instead of `{ id, name }` object | **FIXED** | `src/services/employeeService.ts:2763-2777` now accepts `deletedBy?: { id: string; name: string }` and normalizes string callers. |
| **`AUTH-GOOGLE-01`** | `signInWithGoogle` rejected employees whose Google email differed from `companyEmail` | **FIXED** | `src/services/authService.ts:819-838` queries `googleEmail`, `personalEmail`, `email`, and `companyEmail`. |
| **`SEC-MODAL-GOOGLE-01`** | `EmployeeSecurityModal.tsx` forced current password input for Google-only users | **FIXED** | `components/employee/EmployeeSecurityModal.tsx:31-33, 56-68` detects `google.com` provider and uses `reauthenticateWithPopup` when no password provider is linked. |
| **`AVATAR-UPLOAD-01`** | Profile photo uploaded to `employees/{uid}/...` failed when doc ID != `uid` | **FIXED** | `components/employee/EmployeeProfilePage.tsx:74-86` resolves `storageOwnerId = employee.id || auth.currentUser?.uid || employee.employeeId`. |
| **`DOC-ID-02`** | `saveDocumentRecord` wrote deterministic IDs (`${empId}_${docType}`) that collided on multi-uploads | **FIXED** | `src/services/documentService.ts:24-35` appends `_${Date.now()}` for `CERTIFICATE` and `OTHER` document types. |
| **`SITE-DEL-CHECK-01`** | `deleteSite` deleted active sites without checking assigned employees or submissions | **FIXED** | `src/services/siteService.ts:84-103` blocks site deletion if active `employees` or `onboarding_submissions` reference the site name or ID. |
| **`PORTAL-GUARDS-01`** | `EmployeePortal.tsx` allowed tab navigation via URL state before `isSetupComplete` | **FIXED** | `components/employee/EmployeePortal.tsx:169-174` forces the setup modal whenever `!currentUser.isSetupComplete`. |
| **`NOTIF-BUG-01`** | Notification bell failed to mark notifications as read when `recipientId` used legacy ID | **FIXED** | `src/services/notificationService.ts:104-135` queries across `[userId, ...additionalIds]`. |
| **`WORKFLOW-SUP-01`** | Supervisor approval workflows broke when supervisor was matched by `portalId` vs `id` | **FIXED** | `src/services/requestService.ts:62-97` checks `supervisorIds = [supervisorId, supervisorPortalId, supervisorEmployeeId]`. |
| **`GRIEVANCE-SCOPE-01`** | Site admins could view grievances from other sites | **FIXED** | `components/AdminGrievanceManagementPage.tsx:73-84` filters grievances by `allowedSites` and `assignedSiteIds`. |
| **`WIZARD-FIELDS-01`** | Custom dynamic fields in `WizardStep` were not validated for required status | **FIXED** | `components/WizardStep.tsx:115-148` validates all visible required dynamic fields before advancing steps. |
| **`GAMIFICATION-POINTS-01`** | Awarding points did not atomically log `gamification_logs` | **FIXED** | `src/services/gamificationService.ts:88-124` writes both the point update and `gamification_logs` entry inside a batch/transaction. |
| **`GAS-MISSING-01`** | Missing `verify_code` action in `GoogleAppsScript_Code.js` | **FIXED** | Added `verify_code` handler in `GoogleAppsScript_Code.js:118-145`. |
| **`BULK-IMP-01`** | Bulk employee CSV import created duplicate records when `employeeId` already existed | **FIXED** | `src/services/employeeService.ts:3410-3445` deduplicates against existing `employeeId` and `email` records. |
| **`QUIZ-POINTS-01`** | Training quiz could award gamification points multiple times on retakes | **FIXED** | `src/services/trainingService.ts:212-238` checks `!alreadyCompleted` before awarding completion points. |
| **`CLAIM-LEGACY-ID-01`** | Legacy account claim did not copy `portalId` / `legacyId` consistently | **FIXED** | `src/services/employeeService.ts:4480-4525` preserves `portalId`, `employeeId`, and migrates linked sub-records. |
| **`ENUM-MISMATCH-01`** | `Permission` enum in `types.ts` was missing granular permissions checked in `firestore.rules` | **FIXED** | Added all missing `Permission` enum members in `types.ts:185-235` and `roleService.ts`. |
| **`COLLECTION-MISMATCH-01`** | Legacy collection fallback inconsistencies between `staff_accounts`, `users`, and `staff` | **FIXED (Client-side)** | Standardized across `authService.ts` and `recycleBinService.ts` (see Tasks 4 & 6 for remaining server/purge gaps). |
| **`CORRECTION-FLOW-01`** | Plaintext DOB/Phone leak in `correction_requests` + `getApplicantName` corrupting `applicantName` on guest correction submit | **UNPATCHED (see Task 1 & CLOUD-1)** | Patch instructions provided in Task 1 & Cloud-Level Migration in `CLOUD-1`. |
| **`GFORM-URL-01`** | `syncSubmissionToGoogleForm` runs at `50ms` before `syncDriveFolder` (`200ms`), sending raw Firebase Storage `?alt=media` URLs (HTTP 403) to Google Sheets | **UNPATCHED (see Task 8 & CLOUD-2)** | Patch instructions provided in Task 8 & Cloud-Level Migration in `CLOUD-2`. |
