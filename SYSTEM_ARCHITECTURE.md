# CR Attendance System — Complete Architecture & Implementation

## 📋 Table of Contents
1. [System Overview](#system-overview)
2. [Role-Based Responsibilities](#role-based-responsibilities)
3. [Architecture Diagram](#architecture-diagram)
4. [Frontend (CR PWA)](#frontend-cr-pwa)
5. [Backend (Google Apps Script)](#backend-google-apps-script)
6. [Data Contracts](#data-contracts)
7. [Deployment Guide](#deployment-guide)
8. [Security & Auditability](#security--auditability)

---

## System Overview

**The CR Attendance System** is a secure, offline-first Progressive Web App (PWA) that allows Class Representatives to mark attendance independently while maintaining complete faculty authority over roster management, submissions, and portal integration.

### Key Principles
- ✅ **Offline-First**: Works on students' phones without internet
- ✅ **Faculty-Controlled**: CR cannot access portal or change section/roster
- ✅ **Auditable**: All actions logged with timestamps
- ✅ **Simple Deployment**: Minimal infrastructure, GitHub Pages + Google Apps Script
- ✅ **User-Friendly**: Single-click install on Android, PWA on iOS

---

## Role-Based Responsibilities

### 👨‍🏫 Faculty (Muhammad Jawad Rafeeq)

**Authority & Control**
- Own the official roster and section data
- Extract roster from faculty portal (manual export or script automation)
- Push roster to cloud (Google Drive / Apps Script)
- Review attendance submitted by CR
- Perform final submission to faculty portal (no auto-submission)
- Override or reject attendance if needed

**Tools**
- Faculty Portal (read/extract roster)
- Admin Interface (push roster, review submissions)
- Email notifications (attendance ready for submission)

### 👥 Class Representative (CR) / Student Lead

**Limited Scope**
- Mark Present/Absent for each student
- Edit date, time, class type, online flag
- Write lecture notes (optional, max 2999 chars)
- Submit attendance (becomes locked, cannot edit)

**Restrictions**
- Cannot change section
- Cannot edit roster (add/remove/rename students)
- Cannot access faculty portal
- Cannot resubmit or edit after lock
- Cannot view past attendance records

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      Faculty Portal (Third-party)               │
│                    (COMSATS Web Application)                     │
│                     [Manual Extract Roster]                      │
└────────────────────────────┬────────────────────────────────────┘
                              │ (Manual copy-paste or scheduled script)
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Admin Interface                               │
│              (Google Apps Script Web App)                        │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Roster Push Screen                                      │   │
│  │  - Paste student list from portal                       │   │
│  │  - Select course, section                              │   │
│  │  - Generate & save roster JSON                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Roster API Endpoint                                     │   │
│  │  GET /getRoster?courseId=30000&section=A               │   │
│  │  Returns latest roster JSON                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Attendance Collection & Email                           │   │
│  │  - Receive attendance JSON (POST)                       │   │
│  │  - Store in Google Drive                               │   │
│  │  - Email to faculty                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
└──────────┬───────────────────────────────────┬──────────────────┘
           │                                   │
      [GET Roster]                      [POST Attendance]
           │                                   ↑
           ↓                                   │
┌─────────────────────────────────────────────────────────────────┐
│              Cloud Storage (Google Drive + APIs)                │
│                                                                   │
│  - roster_{courseId}_{section}.json (latest version)            │
│  - attendance_{date}_{section}.json (submissions)               │
│  - audit_log.txt (all submissions + timestamps)                 │
└─────────────────────────────────────────────────────────────────┘
           ↑
           │ (Sync on app load)
           │
┌─────────────────────────────────────────────────────────────────┐
│                    CR PWA (Student Phone)                        │
│                  (GitHub Pages hosted HTML+JS)                  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  UI Layer                                                │   │
│  │  - Attendance marking interface                         │   │
│  │  - Search, mark present/absent                         │   │
│  │  - Edit date/time/notes                                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  App Logic (app.js)                                      │   │
│  │  - Form state management                               │   │
│  │  - Auto-save draft                                     │   │
│  │  - Lock mechanism                                      │   │
│  │  - Validation                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Offline Storage                                         │   │
│  │  - IndexedDB: Queued submissions                        │   │
│  │  - localStorage: Draft state + lock flag               │   │
│  │  - Service Worker: Asset caching                        │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Frontend (CR PWA)

### File Structure
```
cr-app/
├── index.html          # Main PWA page
├── app.js              # Application logic
├── sw.js               # Service Worker (offline caching)
├── manifest.json       # PWA manifest (installable)
└── README.md           # User guide
```

### Key Features

#### 1. Offline Support
- **Service Worker**: Caches all app assets on first load
- **IndexedDB**: Stores pending submissions (survives crashes)
- **localStorage**: Saves draft state + lock flag
- **Network Detection**: Shows online/offline status in real-time

#### 2. Roster Sync
```javascript
// On app load
GET https://apps.google.com/macros/.../usercontent?action=getRoster
```
- Fetches latest roster from Admin Interface
- Falls back to cached roster if offline
- Shows sync status to CR

#### 3. Attendance Marking
- **Student Grid**: Searchable list with P/A toggle buttons
- **Quick Actions**: Mark All Present/Absent, Reset
- **Real-time Counter**: Updates present/absent counts
- **Auto-save**: Every change saved to localStorage

#### 4. Submit & Lock
```javascript
// Confirmation dialog shows:
- Present count
- Absent count  
- Unmarked count
- Warning: Cannot edit after submit
```

- Generates attendance JSON
- Stores in IndexedDB + localStorage flag
- POSTs to Admin Interface (with offline queue)
- Disables all editing

### Data Persistence

**localStorage Keys**
```javascript
roster_cache                    // Cached roster JSON
attendance_draft               // Current form state
attendance_locked              // Boolean: is submitted
```

**IndexedDB Structure**
```javascript
DB: CRAttendanceDB
Store: submissions
  {
    id: "30000-A-2026-02-06",
    course: "CSC462 – AI",
    courseValue: 30000,
    section: "A",
    date: "2026-02-06",
    startTime: "09:00",
    endTime: "10:20",
    classType: "1",
    isOnlineLectureAttendance: false,
    lectureNotes: "Intro to Agents",
    students: [
      { reg: "CIIT/FA22-BCS-008/VHR", name: "AQSA HANIF", present: true },
      { reg: "CIIT/FA22-BCS-078/VHR", name: "SALMAN", present: true }
    ],
    __source: "CR_APP",
    submittedAt: "2026-02-06T10:22:45Z"
  }
```

### Installation & Access

**Android**
1. Open Chrome → `https://your-domain.com/cr-app/`
2. Tap "Install" or "Add to Home Screen"
3. App installs as standalone app
4. Works offline without internet

**iOS (PWA)**
1. Open Safari → `https://your-domain.com/cr-app/`
2. Tap Share → "Add to Home Screen"
3. Limited offline support (Safari caching)

---

## Backend (Google Apps Script)

### Components

#### 1. Roster Push Interface
```
/admin/index.html

Inputs:
- Course ID (e.g., 30000)
- Course Name (e.g., "CSC462 – Artificial Intelligence")
- Section (e.g., "A")
- Student List (copy-paste from portal export)

Action:
- Parse student list
- Generate roster JSON
- Save to Google Drive
- Generate shareable API endpoint
```

#### 2. Roster API Endpoint
```javascript
// Google Apps Script Web App
function doGet(e) {
  const action = e.parameter.action;
  
  if (action === 'getRoster') {
    const courseId = e.parameter.courseId;   // e.g., "30000"
    const section = e.parameter.section;      // e.g., "A"
    
    const file = DriveApp.getFilesByName(`roster_${courseId}_${section}.json`).next();
    const roster = JSON.parse(file.getBlob().getDataAsString());
    
    return ContentService
      .createTextOutput(JSON.stringify(roster))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

#### 3. Attendance Collection
```javascript
function doPost(e) {
  const action = e.parameter.action;
  
  if (action === 'submitAttendance') {
    const payload = JSON.parse(e.postData.contents);
    
    // Store JSON
    const fileName = `attendance_${payload.date}_${payload.section}.json`;
    DriveApp.createFile(fileName, JSON.stringify(payload, null, 2), MimeType.PLAIN_TEXT);
    
    // Send email to faculty
    GmailApp.sendEmail('muhammadJawad@comsats.edu.pk', 
      `Attendance Submitted: ${payload.course} - Section ${payload.section}`,
      `Attendance for ${payload.date} is ready for review.\n\nStudents Marked: ${payload.students.length}`,
      { attachments: [DriveApp.getFilesByName(fileName).next()] }
    );
    
    return ContentService.createTextOutput(JSON.stringify({ success: true }));
  }
}
```

---

## Data Contracts

### 1. Roster JSON (Admin → CR App)
```json
{
  "courseId": 30000,
  "course": "CSC462 – Artificial Intelligence",
  "section": "A",
  "students": [
    {
      "reg": "CIIT/FA22-BCS-008/VHR",
      "displayReg": "FA22-BCS-008",
      "name": "AQSA HANIF"
    },
    {
      "reg": "CIIT/FA22-BCS-078/VHR",
      "displayReg": "FA22-BCS-078",
      "name": "MUHAMMAD SALMAN"
    }
  ],
  "pushedAt": "2026-02-06T08:55:00Z"
}
```

### 2. Attendance JSON (CR App → Admin)
```json
{
  "course": "CSC462 – Artificial Intelligence",
  "courseValue": 30000,
  "section": "A",
  "date": "2026-02-06",
  "startTime": "09:00",
  "endTime": "10:20",
  "classType": "1",
  "isOnlineLectureAttendance": false,
  "lectureNotes": "Introduction to Intelligent Agents and search algorithms",
  "students": [
    {
      "reg": "CIIT/FA22-BCS-008/VHR",
      "name": "AQSA HANIF",
      "present": true
    },
    {
      "reg": "CIIT/FA22-BCS-078/VHR",
      "name": "MUHAMMAD SALMAN",
      "present": true
    },
    {
      "reg": "CIIT/SP23-BCS-006/VHR",
      "name": "ABEERA EJAZ",
      "present": false
    }
  ],
  "__source": "CR_APP",
  "submittedAt": "2026-02-06T10:22:45Z"
}
```

---

## Deployment Guide

### Step 1: Deploy CR PWA (Frontend)

**Option A: GitHub Pages** (Recommended)
```bash
# Push cr-app/ folder to GitHub
git add cr-app/
git commit -m "Deploy CR PWA"
git push

# Enable GitHub Pages in repo settings:
# Settings → Pages → Source: main branch /cr-app folder
# Your app will be at: https://jawwadjlf.github.io/OnlineAttendanceSystem/cr-app/
```

**Option B: Netlify**
```bash
netlify deploy --dir=cr-app
```

### Step 2: Create Google Apps Script

1. Go to [script.google.com](https://script.google.com)
2. Create new project
3. Copy backend code:
   - `Code.gs` - Main backend logic
   - `Admin.html` - Roster push interface
4. Deploy as Web App:
   - Execute as: Your email
   - Who has access: Anyone
   - Copy deployment URL

### Step 3: Update Configuration

**In `cr-app/app.js`**, update endpoints:
```javascript
Roster_URL: 'https://script.google.com/macros/d/YOUR_DEPLOYMENT_ID/usercontent?action=getRoster',
```

**In CR app, users must know:**
- Course ID (e.g., 30000)
- Section (e.g., A)

### Step 4: Test Workflow

1. **As Faculty**: 
   - Push test roster via Admin Interface
   - Verify roster JSON created in Google Drive

2. **As CR**:
   - Open PWA in browser/mobile
   - Verify roster loads
   - Mark attendance
   - Submit & Lock
   - Verify JSON in Google Drive + email received

---

## Security & Auditability

### Security Measures

✅ **No Portal Credentials in App**
- CR never logs into faculty portal
- No passwords or tokens stored locally

✅ **Immutable Roster**
- Section & student list read-only in CR app
- Can only be changed by faculty push

✅ **Lock Mechanism**
- Once submitted, attendance becomes read-only
- Stored in localStorage flag + IndexedDB
- Cannot resubmit or edit

✅ **Faculty Authority**
- All final decisions made by faculty
- Can reject or override attendance
- Email notifications for review

### Auditability

**Timestamp Logging**
```json
{
  "submittedAt": "2026-02-06T10:22:45Z",
  "__source": "CR_APP"
}
```

**Email Trail**
- Attendance submission emails to faculty
- Include date, time, student count, lecturer notes
- Searchable archive in Gmail

**Drive Storage**
- All attendance JSONs stored in Google Drive
- Folder structure: `/Attendance/{CourseId}/{Section}/{Date}/`
- Shareable, searchable, backed up

---

## FAQ & Troubleshooting

### Q: What if CR loses internet during marking?
**A**: App works completely offline. All data saved locally (localStorage + IndexedDB). When online again, auto-syncs to cloud.

### Q: What if CR force-closes the app?
**A**: Draft is auto-saved every 2 seconds. Reopen app and all data is restored.

### Q: Can CR edit after submitting?
**A**: No. Submit & Lock disables all fields. Flag stored in localStorage prevents reopening.

### Q: How do I pull attendance into faculty portal?
**A**: Faculty manually imports JSON files from Google Drive into portal (or we can automate this with scheduled script).

### Q: Can multiple CRs use same app?
**A**: Currently designed for single CR. For multi-CR, add authentication step at app load.

---

## Future Enhancements

- 🔐 CR authentication (optional, for multi-CR setup)
- 📊 Admin analytics dashboard
- 🔄 Automatic portal sync (script to import JSON → portal API)
- 📱 Biometric authentication for security
- 🌙 Dark mode UI
- 📧 In-app message from faculty

---

**Last Updated**: February 6, 2026
**Author**: Muhammad Jawad Rafeeq
**Status**: ✅ Ready for Deployment
