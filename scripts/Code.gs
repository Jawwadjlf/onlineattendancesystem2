// =====================
// Code.gs — COMPLETE FIXED VERSION
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

    if (action === 'debugFolder')     return debugFolder();
    if (action === 'listRosters')     return listRosters();
    if (action === 'getCRAssignment') return getCRAssignmentResponse(e.parameter.email);
    if (action === 'assignCR')        return assignCR(e.parameter.email, e.parameter.courseId, e.parameter.section);
    if (action === 'listCRs')         return listCRs();
    if (action === 'getLatestRoster') return getLatestRoster(e.parameter.courseId, e.parameter.section, e.parameter.crEmail);

    return jsonResponse({ ok: false, error: 'unknown_action: ' + action });
  }

  return jsonResponse({ ok: false, error: 'invalid_request' });
}


// =====================
// POST — Upload roster
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

    if (payload.type !== "roster")                                               return jsonResponse({ ok: false, error: "invalid_type" });
    if (!payload.courseId || !payload.roster || !Array.isArray(payload.roster)) return jsonResponse({ ok: false, error: "missing_fields" });

    const folder   = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const datePart = (payload.extractedAt || new Date().toISOString()).slice(0, 10);
    const section  = payload.section || "NA";
    const filename = `roster_course_${payload.courseId}_section_${section}_${datePart}.json`;

    const file = upsertJsonFile_(folder, filename, JSON.stringify(payload, null, 2));

    // Keep ScriptProperty updated so legacy fallback still works
    PropertiesService.getScriptProperties()
      .setProperty(`latest_${payload.courseId}_${section}`, file.getId());

    return jsonResponse({
      ok:            true,
      fileId:        file.getId(),
      filename:      filename,
      fileUrl:       file.getUrl(),
      studentsCount: payload.totalStudents || payload.roster.length
    });

  } catch (err) {
    return jsonResponse({ ok: false, error: err.message, stack: err.stack });
  }
}


// =====================
// CR MANAGEMENT
// =====================
/**
 * ✅ Returns proper JSON response for CR login
 * Called by PWA via ?crEmail=... or Admin Panel via ?action=getCRAssignment&email=...
 */
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
    return jsonResponse({ 
      ok: false, 
      error: err.message 
    });
  }
}


function assignCR(email, courseId, section) {
  try {
    if (!email || !courseId || !section) return jsonResponse({ ok: false, error: "missing_parameters" });

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
