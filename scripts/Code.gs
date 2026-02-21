// =====================
// Code.gs — COMPLETE VERSION WITH ALL IMPROVEMENTS
// =====================
const SECRET          = "k9F@3xQp7L_92aZ!rT";
const DRIVE_FOLDER_ID = "1XY9Lo69RwEsWwmYPIXTpxWSvWlH3cFVT";


// =====================
// ROUTING
// =====================
function doGet(e) {
  const hasParams = e && e.parameter && Object.keys(e.parameter).length > 0;

  // No params → serve admin panel with injected scriptUrl
  if (!hasParams) {
    const template = HtmlService.createTemplateFromFile('admin-panel');
    template.scriptUrl = ScriptApp.getService().getUrl();
    return template.evaluate()
      .setTitle('Admin Panel – Attendance System')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  const action  = e.parameter.action;
  const secret  = e.parameter.secret;
  const crEmail = e.parameter.crEmail;

  // ✅ Route 1: CR login — called by PWA via ?crEmail=...
  if (crEmail && !action) {
    return getCRAssignmentResponse(crEmail);
  }

  // Route 2: Action-based API calls (require secret + action)
  if (action) {
    if (secret !== SECRET) {
      return jsonResponse({ ok: false, error: 'unauthorized' });
    }

    if (action === 'debugFolder')       return debugFolder();
    if (action === 'listRosters')       return listRosters();
    if (action === 'getCRAssignment')   return getCRAssignmentResponse(e.parameter.email);
    if (action === 'assignCR')          return assignCR(e.parameter.email, e.parameter.courseId, e.parameter.section);
    if (action === 'listCRs')           return listCRs();
    if (action === 'getLatestRoster')   return getLatestRoster(e.parameter.courseId, e.parameter.section, e.parameter.crEmail);
    if (action === 'listAttendance')    return listAttendance();
    if (action === 'unlockAttendance')  return unlockAttendance(e.parameter.courseId, e.parameter.section, e.parameter.date);
    if (action === 'addStudent')        return addStudent(e.parameter.courseId, e.parameter.section, e.parameter.regNo, e.parameter.name);

    return jsonResponse({ ok: false, error: 'unknown_action: ' + action });
  }

  return jsonResponse({ ok: false, error: 'invalid_request' });
}


// =====================
// POST — Upload roster OR submit attendance
// =====================
function doPost(e) {
  try {
    const secret = (e.parameter && e.parameter.secret) ? String(e.parameter.secret) : "";
    if (secret !== SECRET) return jsonResponse({ ok: false, error: "unauthorized" });

    const raw = (e.postData && e.postData.contents) ? e.postData.contents : "";
    if (!raw) return jsonResponse({ ok: false, error: "empty_body" });

    let payload;
    try { payload = JSON.parse(raw); }
    catch (parseErr) { return jsonResponse({ ok: false, error: "invalid_json", message: parseErr.message }); }

    // ---- ROSTER UPLOAD ----
    if (payload.type === "roster") {
      return handleRosterUpload_(payload);
    }

    // ---- ATTENDANCE SUBMISSION ----
    if (payload.type === "attendance") {
      return handleAttendanceSubmission_(payload);
    }

    return jsonResponse({ ok: false, error: "invalid_type: must be 'roster' or 'attendance'" });

  } catch (err) {
    return jsonResponse({ ok: false, error: err.message, stack: err.stack });
  }
}


// =====================
// POST HANDLERS
// =====================

function handleRosterUpload_(payload) {
  if (!payload.courseId || !payload.roster || !Array.isArray(payload.roster))
    return jsonResponse({ ok: false, error: "missing_fields" });

  const folder   = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const datePart = (payload.extractedAt || new Date().toISOString()).slice(0, 10);
  const section  = payload.section || "NA";
  const filename = `roster_course_${payload.courseId}_section_${section}_${datePart}.json`;

  const file = upsertJsonFile_(folder, filename, JSON.stringify(payload, null, 2));

  PropertiesService.getScriptProperties()
    .setProperty(`latest_${payload.courseId}_${section}`, file.getId());

  return jsonResponse({
    ok:            true,
    fileId:        file.getId(),
    filename:      filename,
    fileUrl:       file.getUrl(),
    studentsCount: payload.totalStudents || payload.roster.length
  });
}


function handleAttendanceSubmission_(payload) {
  if (!payload.courseId && !payload.courseValue)
    return jsonResponse({ ok: false, error: "missing courseId" });
  if (!payload.date)
    return jsonResponse({ ok: false, error: "missing date" });
  if (!payload.students || !Array.isArray(payload.students))
    return jsonResponse({ ok: false, error: "missing students array" });

  const courseId = payload.courseId || payload.courseValue;
  const section  = payload.section || "NA";
  const folder   = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const filename = `attendance_${courseId}_${section}_${payload.date}.json`;

  // Add metadata
  payload.courseId  = courseId;
  payload.section   = section;
  payload.savedAt   = new Date().toISOString();

  const file = upsertJsonFile_(folder, filename, JSON.stringify(payload, null, 2));

  // Send HTML email
  try {
    const facultyEmail = payload.facultyEmail || '';
    const crEmail      = payload.crEmail || '';
    const subject      = `📋 Attendance: ${payload.course || courseId} – Section ${section} – ${payload.date}`;
    const htmlBody     = buildAttendanceEmailHtml_(payload);

    if (facultyEmail) {
      GmailApp.sendEmail(facultyEmail, subject, '', {
        htmlBody: htmlBody,
        name: 'CR Attendance System'
      });
    }
    if (crEmail && crEmail !== facultyEmail) {
      GmailApp.sendEmail(crEmail, `[Confirmation] ${subject}`, '', {
        htmlBody: htmlBody,
        name: 'CR Attendance System'
      });
    }
  } catch (emailErr) {
    Logger.log('Email send failed: ' + emailErr.message);
    // Don't fail the whole submission just because email failed
  }

  return jsonResponse({
    ok:       true,
    fileId:   file.getId(),
    filename: filename,
    fileUrl:  file.getUrl(),
    studentCount: payload.students.length
  });
}


// =====================
// HTML EMAIL TEMPLATE
// =====================
function buildAttendanceEmailHtml_(payload) {
  const students = payload.students || [];
  const present  = students.filter(s => s.present === true || s.present === 'P');
  const absent   = students.filter(s => s.present === false || s.present === 'A');
  const course   = payload.course || payload.courseId || 'Unknown';
  const section  = payload.section || 'NA';
  const classType = { '1': 'Class', '2': 'Lab', '4': 'Exam' }[String(payload.classType)] || 'Class';

  let rows = '';
  students.forEach((s, i) => {
    const isPresent = s.present === true || s.present === 'P';
    const statusColor = isPresent ? '#22c25f' : '#BD3850';
    const statusText  = isPresent ? '✅ Present' : '❌ Absent';
    const rowBg = i % 2 === 0 ? '#ffffff' : '#f7fafc';
    rows += `<tr style="background:${rowBg}">
      <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;text-align:center;color:#718096">${i + 1}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-size:13px">${s.reg || s.regNo || '-'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-weight:600">${s.name || 'Unknown'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;color:${statusColor};font-weight:700">${statusText}</td>
    </tr>`;
  });

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f5f7">
  <div style="max-width:640px;margin:0 auto;padding:20px">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#363763,#1e1f4a);border-radius:16px 16px 0 0;padding:24px;color:white">
      <h1 style="margin:0 0 4px;font-size:22px">📋 Attendance Report</h1>
      <p style="margin:0;opacity:0.85;font-size:14px">Submitted by CR: ${payload.crEmail || 'N/A'}</p>
    </div>

    <!-- Summary Card -->
    <div style="background:white;padding:20px 24px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:6px 0;color:#718096;width:100px">Course</td>
          <td style="padding:6px 0;font-weight:700">${course}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#718096">Section</td>
          <td style="padding:6px 0;font-weight:700">${section}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#718096">Date</td>
          <td style="padding:6px 0;font-weight:700">${payload.date || 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#718096">Time</td>
          <td style="padding:6px 0;font-weight:700">${payload.startTime || ''} – ${payload.endTime || ''}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#718096">Type</td>
          <td style="padding:6px 0;font-weight:700">${classType}${payload.isOnline ? ' (Online)' : ''}</td>
        </tr>
      </table>

      <!-- Stats -->
      <div style="display:flex;gap:12px;margin-top:16px">
        <div style="flex:1;background:rgba(34,194,95,0.1);border:1px solid rgba(34,194,95,0.3);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:24px;font-weight:800;color:#22c25f">${present.length}</div>
          <div style="font-size:12px;color:#2f855a;font-weight:600">Present</div>
        </div>
        <div style="flex:1;background:rgba(189,56,80,0.1);border:1px solid rgba(189,56,80,0.3);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:24px;font-weight:800;color:#BD3850">${absent.length}</div>
          <div style="font-size:12px;color:#c53030;font-weight:600">Absent</div>
        </div>
        <div style="flex:1;background:rgba(66,153,225,0.1);border:1px solid rgba(66,153,225,0.3);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:24px;font-weight:800;color:#3182ce">${students.length}</div>
          <div style="font-size:12px;color:#2c5282;font-weight:600">Total</div>
        </div>
      </div>
    </div>

    ${payload.lectureNotes ? `
    <!-- Lecture Notes -->
    <div style="background:#f7fafc;padding:16px 24px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
      <div style="font-weight:700;color:#2d3748;margin-bottom:6px">📝 Lecture Notes</div>
      <div style="color:#4a5568;font-size:14px;line-height:1.6">${payload.lectureNotes}</div>
    </div>
    ` : '' }

    <!-- Student Table -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:0 0 16px 16px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#363763;color:white">
            <th style="padding:12px 14px;text-align:center;font-size:13px;width:40px">Sr</th>
            <th style="padding:12px 14px;text-align:left;font-size:13px">Reg No</th>
            <th style="padding:12px 14px;text-align:left;font-size:13px">Name</th>
            <th style="padding:12px 14px;text-align:left;font-size:13px;width:100px">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:16px;color:#a0aec0;font-size:12px">
      CR Attendance System • ${new Date().toISOString().split('T')[0]}
    </div>

  </div>
</body>
</html>`;
}


// =====================
// UNLOCK ATTENDANCE
// =====================
function unlockAttendance(courseId, section, date) {
  try {
    if (!courseId || !date)
      return jsonResponse({ ok: false, error: 'courseId and date are required' });

    section = section || 'NA';
    const folder   = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const filename = `attendance_${courseId}_${section}_${date}.json`;
    const files    = folder.getFilesByName(filename);

    if (!files.hasNext()) {
      return jsonResponse({ ok: false, error: `Attendance file not found: ${filename}` });
    }

    const file    = files.next();
    const content = JSON.parse(file.getBlob().getDataAsString());
    content.unlocked   = true;
    content.unlockedAt = new Date().toISOString();
    file.setContent(JSON.stringify(content, null, 2));

    return jsonResponse({
      ok:       true,
      filename: filename,
      message:  `Attendance unlocked for course ${courseId}, section ${section}, date ${date}`
    });

  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}


// =====================
// ADD STUDENT TO ROSTER
// =====================
function addStudent(courseId, section, regNo, name) {
  try {
    if (!courseId || !regNo || !name)
      return jsonResponse({ ok: false, error: 'courseId, regNo, and name are required' });

    section = section || 'NA';
    const best = findLatestRosterFile_(courseId, section);

    if (!best) {
      return jsonResponse({ ok: false, error: `No roster found for course ${courseId} section ${section}` });
    }

    const content = JSON.parse(best.file.getBlob().getDataAsString());
    const roster  = content.roster || [];

    // Check for duplicate
    const exists = roster.some(s =>
      (s.regNo || s.reg || '').toUpperCase() === regNo.toUpperCase()
    );
    if (exists) {
      return jsonResponse({ ok: false, error: `Student ${regNo} already exists in roster` });
    }

    roster.push({
      sr:    roster.length + 1,
      regNo: regNo.toUpperCase(),
      name:  name.toUpperCase()
    });

    content.roster        = roster;
    content.totalStudents = roster.length;
    content.lastModified  = new Date().toISOString();

    best.file.setContent(JSON.stringify(content, null, 2));

    return jsonResponse({
      ok:            true,
      filename:      best.name,
      addedStudent:  { regNo: regNo.toUpperCase(), name: name.toUpperCase() },
      totalStudents: roster.length
    });

  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}


// =====================
// LIST ATTENDANCE
// =====================
function listAttendance() {
  try {
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const files  = folder.getFiles();
    const list   = [];

    while (files.hasNext()) {
      const file     = files.next();
      const filename = file.getName();

      if (!filename.startsWith('attendance_') || !filename.toLowerCase().endsWith('.json'))
        continue;

      try {
        const content = JSON.parse(file.getBlob().getDataAsString());
        const students = content.students || [];
        const present  = students.filter(s => s.present === true || s.present === 'P').length;
        const absent   = students.filter(s => s.present === false || s.present === 'A').length;

        list.push({
          filename,
          courseId:   content.courseId || content.courseValue || 'UNKNOWN',
          course:    content.course || '',
          section:   content.section || 'NA',
          date:      content.date || '',
          crEmail:   content.crEmail || '',
          present,
          absent,
          total:     students.length,
          unlocked:  !!content.unlocked,
          submittedAt: content.submittedAt || content.savedAt || file.getDateCreated().toISOString(),
          fileUrl:   file.getUrl(),
          fileId:    file.getId()
        });
      } catch (parseErr) {
        Logger.log('Error parsing attendance: ' + filename + ' | ' + parseErr);
      }
    }

    // Sort by date descending
    list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    return jsonResponse({ ok: true, attendance: list, count: list.length });

  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}


// =====================
// CR MANAGEMENT
// =====================
function getCRAssignmentResponse(email) {
  try {
    const prop = PropertiesService.getScriptProperties().getProperty(`cr_${email}`);
    
    if (!prop) {
      return jsonResponse({ 
        ok: false, 
        error: `CR not found: ${email}. Please ask admin to assign you first.` 
      });
    }

    const assignment = JSON.parse(prop);
    
    return jsonResponse({ 
      ok: true, 
      email: email,
      courseId: assignment.courseId,
      section: assignment.section,
      assignedAt: assignment.assignedAt
    });

  } catch (err) {
    Logger.log('getCRAssignmentResponse error:', err);
    return jsonResponse({ ok: false, error: err.message });
  }
}


function assignCR(email, courseId, section) {
  try {
    if (!email || !courseId || !section)
      return jsonResponse({ ok: false, error: "missing_parameters" });

    const assignment = { email, courseId, section, assignedAt: new Date().toISOString() };
    PropertiesService.getScriptProperties().setProperty(`cr_${email}`, JSON.stringify(assignment));

    return jsonResponse({ ok: true, assignment });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}


function listCRs() {
  try {
    const allProps = PropertiesService.getScriptProperties().getProperties();
    const crs = [];
    for (const key in allProps) {
      if (key.startsWith('cr_')) {
        try { crs.push(JSON.parse(allProps[key])); } catch (e) { /* skip corrupt */ }
      }
    }
    return jsonResponse({ ok: true, crs });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}


// =====================
// ROSTER FUNCTIONS
// =====================
function findLatestRosterFile_(courseId, section) {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const prefix = `roster_course_${courseId}_section_${section}_`;
  const it     = folder.getFiles();
  let   best   = null;

  while (it.hasNext()) {
    const f    = it.next();
    const name = f.getName();

    if (!name.startsWith(prefix)) continue;
    const dateStr = name.slice(prefix.length).replace(/\.json$/i, '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

    if (!best || dateStr > best.dateStr) best = { file: f, name, dateStr };
  }

  if (best) {
    PropertiesService.getScriptProperties()
      .setProperty(`latest_${courseId}_${section}`, best.file.getId());
  }

  return best;
}


function listRosters() {
  try {
    const folder    = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const files     = folder.getFiles();
    const latestMap = new Map();

    while (files.hasNext()) {
      const file     = files.next();
      const filename = file.getName();

      if (!filename.startsWith('roster_course_') || !filename.toLowerCase().endsWith('.json')) continue;

      try {
        const content     = JSON.parse(file.getBlob().getDataAsString());
        const courseId    = content.courseId  || 'UNKNOWN';
        const section     = content.section   || 'NA';
        const extractedAt = content.extractedAt || file.getDateCreated().toISOString();
        const key         = `${courseId}_${section}`;

        const rosterInfo = {
          filename,
          courseId,
          section,
          totalStudents: content.totalStudents || (content.roster ? content.roster.length : 0),
          date:          extractedAt.split('T')[0],
          extractedAt,
          fileUrl:       file.getUrl(),
          fileId:        file.getId(),
          lastModified:  file.getLastUpdated().toISOString()
        };

        if (!latestMap.has(key) || new Date(extractedAt) > new Date(latestMap.get(key).extractedAt)) {
          latestMap.set(key, rosterInfo);
        }
      } catch (parseError) {
        Logger.log('Error parsing: ' + filename + ' | ' + parseError);
      }
    }

    const latestRosters = Array.from(latestMap.values());
    return jsonResponse({ ok: true, rosters: latestRosters, count: latestRosters.length });

  } catch (error) {
    return jsonResponse({ ok: false, error: error.toString() });
  }
}


function getLatestRoster(courseId, section, crEmail) {
  try {
    if (!courseId || !section) {
      if (!crEmail) return jsonResponse({ ok: false, error: 'courseId+section or crEmail required' });
      const assignData = JSON.parse(getCRAssignmentResponse(crEmail).getContent());
      if (!assignData.ok) return jsonResponse({ ok: false, error: 'CR not found: ' + crEmail });
      courseId = assignData.courseId;
      section  = assignData.section;
    }

    const best = findLatestRosterFile_(courseId, section);

    if (!best) {
      return jsonResponse({ ok: false, error: `No roster found for course ${courseId} section ${section}` });
    }

    let payload;
    try { payload = JSON.parse(best.file.getBlob().getDataAsString()); }
    catch (e) { return jsonResponse({ ok: false, error: 'Failed to parse file: ' + e.message }); }

    const roster = (payload.roster || []).map(item => ({
      regNo: String(item.regNo || item.reg || ''),
      name:  String(item.name  || item.studentName || 'Unknown')
    }));

    Logger.log(`getLatestRoster → ${best.name} (${roster.length} students)`);

    return jsonResponse({
      ok:            true,
      courseId:      String(courseId),
      courseName:    payload.courseName || `Course ${courseId}`,
      section:       String(section),
      roster,
      fileName:      best.name,
      fileDate:      best.dateStr,
      totalStudents: roster.length
    });

  } catch (err) {
    return jsonResponse({ ok: false, error: err.message, stack: err.stack });
  }
}


// =====================
// DEBUG
// =====================
function debugFolder() {
  try {
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const it     = folder.getFiles();
    let   total  = 0;
    const sample = [];

    while (it.hasNext()) {
      const f = it.next();
      total++;
      if (sample.length < 20) {
        sample.push({ name: f.getName(), mimeType: f.getMimeType(), id: f.getId() });
      }
    }

    return jsonResponse({
      ok:           true,
      driveFolderId: DRIVE_FOLDER_ID,
      folderName:   folder.getName(),
      filesVisible: total,
      sample
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: e.message, stack: e.stack });
  }
}


// =====================
// HELPERS
// =====================
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function upsertJsonFile_(folder, filename, jsonText) {
  const files = folder.getFilesByName(filename);
  if (files.hasNext()) {
    const file = files.next();
    file.setContent(jsonText);
    return file;
  }
  return folder.createFile(filename, jsonText);
}
