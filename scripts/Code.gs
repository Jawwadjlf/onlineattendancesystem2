// =============================================
// CONFIG
// =============================================
const SECRET = 'k9F@3xQp7L_92aZ!rT';

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================
// doGet — handles all GET actions
// =============================================
function doGet(e) {
  const action = e.parameter.action;
  const secret = e.parameter.secret;
  
  // Validate secret for protected actions
  const protectedActions = ['listRosters', 'listCRs', 'assignCR', 'unlockAttendance', 'addStudent', 'getCRAssignment', 'getLatestRoster'];
  if (protectedActions.includes(action) && secret !== SECRET) {
    return jsonResponse({ ok: false, error: 'Invalid secret' });
  }

  // --- getRoster (simple, no secret needed) ---
  if (action === 'getRoster') {
    const courseId = e.parameter.courseId;
    const section = e.parameter.section;
    
    if (!courseId || !section) {
      return jsonResponse({ error: "Missing courseId or section" });
    }

    try {
      const files = DriveApp.getFilesByName(`roster_${courseId}_${section}.json`);
      if (files.hasNext()) {
        const file = files.next();
        const roster = JSON.parse(file.getBlob().getDataAsString());
        return jsonResponse(roster);
      } else {
        return jsonResponse({ error: "Roster not found" });
      }
    } catch (error) {
      return jsonResponse({ error: error.toString() });
    }
  }

  // --- getLatestRoster (for CR app) ---
  if (action === 'getLatestRoster') {
    const courseId = e.parameter.courseId;
    const section = e.parameter.section;
    
    if (!courseId || !section) {
      return jsonResponse({ ok: false, error: 'Missing courseId or section' });
    }

    try {
      // Search for roster files matching the pattern
      const prefix = `roster_course_${courseId}_section_${section}_`;
      const allFiles = DriveApp.getFiles();
      let latestFile = null;
      let latestDate = '';

      while (allFiles.hasNext()) {
        const f = allFiles.next();
        const name = f.getName();
        if (name.startsWith(prefix) && name.endsWith('.json')) {
          const dateStr = name.replace(prefix, '').replace('.json', '');
          if (dateStr > latestDate) {
            latestDate = dateStr;
            latestFile = f;
          }
        }
      }

      // Fallback to simpler filename format
      if (!latestFile) {
        const simpleFiles = DriveApp.getFilesByName(`roster_${courseId}_${section}.json`);
        if (simpleFiles.hasNext()) {
          latestFile = simpleFiles.next();
        }
      }

      if (latestFile) {
        const data = JSON.parse(latestFile.getBlob().getDataAsString());
        return jsonResponse({
          ok: true,
          courseId: courseId,
          courseName: data.course || data.courseName || `Course ${courseId}`,
          section: section,
          roster: data.roster || data.students || [],
          fileName: latestFile.getName(),
          fileDate: latestDate || null
        });
      } else {
        return jsonResponse({ ok: false, error: 'No roster found for this course/section' });
      }
    } catch (error) {
      return jsonResponse({ ok: false, error: error.toString() });
    }
  }

  // --- getCRAssignment ---
  if (action === 'getCRAssignment') {
    const email = e.parameter.email;
    if (!email) return jsonResponse({ ok: false, error: 'Missing email' });

    try {
      const files = DriveApp.getFilesByName('cr_assignments.json');
      if (files.hasNext()) {
        const data = JSON.parse(files.next().getBlob().getDataAsString());
        const assignments = data.assignments || [];
        const match = assignments.find(a => a.email.toLowerCase() === email.toLowerCase());
        if (match) {
          return jsonResponse({ ok: true, assignment: match });
        } else {
          return jsonResponse({ ok: false, error: 'No assignment found for this email' });
        }
      } else {
        return jsonResponse({ ok: false, error: 'No CR assignments file found' });
      }
    } catch (error) {
      return jsonResponse({ ok: false, error: error.toString() });
    }
  }

  // --- listRosters ---
  if (action === 'listRosters') {
    try {
      const allFiles = DriveApp.getFiles();
      const rosters = [];
      while (allFiles.hasNext()) {
        const f = allFiles.next();
        const name = f.getName();
        if (name.startsWith('roster_') && name.endsWith('.json')) {
          try {
            const content = JSON.parse(f.getBlob().getDataAsString());
            rosters.push({
              filename: name,
              courseId: content.courseId || '',
              section: content.section || '',
              totalStudents: (content.roster || content.students || []).length,
              lastModified: f.getLastUpdated().toISOString(),
              fileUrl: f.getUrl()
            });
          } catch (parseErr) {
            // Skip malformed files
          }
        }
      }
      return jsonResponse({ ok: true, rosters: rosters });
    } catch (error) {
      return jsonResponse({ ok: false, error: error.toString() });
    }
  }

  // --- listCRs ---
  if (action === 'listCRs') {
    try {
      const files = DriveApp.getFilesByName('cr_assignments.json');
      if (files.hasNext()) {
        const data = JSON.parse(files.next().getBlob().getDataAsString());
        return jsonResponse({ ok: true, crs: data.assignments || [] });
      }
      return jsonResponse({ ok: true, crs: [] });
    } catch (error) {
      return jsonResponse({ ok: false, error: error.toString() });
    }
  }

  // --- assignCR ---
  if (action === 'assignCR') {
    const email = e.parameter.email;
    const courseId = e.parameter.courseId;
    const section = e.parameter.section;

    if (!email || !courseId || !section) {
      return jsonResponse({ ok: false, error: 'Missing email, courseId, or section' });
    }

    try {
      let data = { assignments: [] };
      const files = DriveApp.getFilesByName('cr_assignments.json');
      let file = null;

      if (files.hasNext()) {
        file = files.next();
        data = JSON.parse(file.getBlob().getDataAsString());
      }

      // Remove existing assignment for this email (if any)
      data.assignments = (data.assignments || []).filter(a => a.email.toLowerCase() !== email.toLowerCase());

      // Add new assignment
      data.assignments.push({
        email: email,
        courseId: courseId,
        section: section,
        assignedAt: new Date().toISOString()
      });

      if (file) {
        file.setContent(JSON.stringify(data, null, 2));
      } else {
        DriveApp.createFile('cr_assignments.json', JSON.stringify(data, null, 2), MimeType.PLAIN_TEXT);
      }

      return jsonResponse({ ok: true });
    } catch (error) {
      return jsonResponse({ ok: false, error: error.toString() });
    }
  }

  // --- unlockAttendance ---
  if (action === 'unlockAttendance') {
    const courseId = e.parameter.courseId;
    const section = e.parameter.section;
    const date = e.parameter.date;

    if (!courseId || !section || !date) {
      return jsonResponse({ ok: false, error: 'Missing courseId, section, or date' });
    }

    try {
      const fileName = `attendance_${date}_${section}.json`;
      const files = DriveApp.getFilesByName(fileName);

      if (files.hasNext()) {
        const file = files.next();
        const data = JSON.parse(file.getBlob().getDataAsString());
        data.locked = false;
        data.unlockedAt = new Date().toISOString();
        file.setContent(JSON.stringify(data, null, 2));
        return jsonResponse({ ok: true, message: `Unlocked ${fileName}` });
      } else {
        return jsonResponse({ ok: false, error: `No attendance file found: ${fileName}` });
      }
    } catch (error) {
      return jsonResponse({ ok: false, error: error.toString() });
    }
  }

  // --- addStudent ---
  if (action === 'addStudent') {
    const courseId = e.parameter.courseId;
    const section = e.parameter.section;
    const regNo = e.parameter.regNo;
    const name = e.parameter.name;

    if (!courseId || !section || !regNo || !name) {
      return jsonResponse({ ok: false, error: 'Missing courseId, section, regNo, or name' });
    }

    try {
      const fileName = `roster_${courseId}_${section}.json`;
      const files = DriveApp.getFilesByName(fileName);

      if (files.hasNext()) {
        const file = files.next();
        const data = JSON.parse(file.getBlob().getDataAsString());

        // Determine which array holds students
        const studentList = data.roster || data.students || [];

        // Check for duplicate
        const exists = studentList.some(s => (s.regNo || s.reg) === regNo);
        if (exists) {
          return jsonResponse({ ok: false, error: `Student ${regNo} already exists in roster` });
        }

        studentList.push({
          regNo: regNo,
          name: name,
          sr: studentList.length + 1
        });

        // Update the correct field
        if (data.roster) {
          data.roster = studentList;
        } else {
          data.students = studentList;
        }

        data.totalStudents = studentList.length;
        file.setContent(JSON.stringify(data, null, 2));

        return jsonResponse({ ok: true, message: `Added ${name} (${regNo}) to ${fileName}`, totalStudents: studentList.length });
      } else {
        return jsonResponse({ ok: false, error: `Roster file not found: ${fileName}` });
      }
    } catch (error) {
      return jsonResponse({ ok: false, error: error.toString() });
    }
  }

  // Serve Admin Interface if no action
  return HtmlService.createHtmlOutputFromFile('Admin')
    .setTitle('CUOnline Admin');
}


function saveRoster(data) {
  try {
     const fileName = `roster_${data.courseId}_${data.section}.json`;
     // Check if file exists and update or create new
     const files = DriveApp.getFilesByName(fileName);
     if (files.hasNext()) {
       const file = files.next();
       file.setContent(JSON.stringify(data, null, 2));
     } else {
       DriveApp.createFile(fileName, JSON.stringify(data, null, 2), MimeType.PLAIN_TEXT);
     }
     
     return { success: true, fileName: fileName };
  } catch (e) {
    throw new Error(e.toString());
  }
}


function doPost(e) {
  const action = e.parameter.action;
  
  if (action === 'submitAttendance') {
    try {
      const payload = JSON.parse(e.postData.contents);
      
      // Store JSON in Drive
      const fileName = `attendance_${payload.date}_${payload.section}.json`;
      const file = DriveApp.createFile(fileName, JSON.stringify(payload, null, 2), MimeType.PLAIN_TEXT);
      
      // Use faculty email from payload, fall back to default
      const facultyEmail = payload.facultyEmail || 'muhammadJawad@comsats.edu.pk';
      const crEmail = payload.crEmail || '';
      
      const subject = `Attendance Submitted: ${payload.course} - Section ${payload.section} - ${payload.date}`;
      const body = `Attendance for ${payload.date} has been submitted by CR: ${crEmail}\n\nCourse: ${payload.course}\nSection: ${payload.section}\nDate: ${payload.date}\nStudents: ${payload.students ? payload.students.length : 'N/A'}\n\nAttachment contains the full attendance JSON.`;
      
      // Send to faculty
      GmailApp.sendEmail(facultyEmail, subject, body, { attachments: [file] });
      
      // Also send confirmation to the CR if email provided
      if (crEmail && crEmail !== facultyEmail) {
        GmailApp.sendEmail(crEmail, `[Confirmation] ${subject}`, `Your attendance submission was successful.\n\n${body}`);
      }
      
      return ContentService.createTextOutput(JSON.stringify({ success: true, fileName: fileName }))
        .setMimeType(ContentService.MimeType.JSON);
        
    } catch (error) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({ error: "Invalid action" }))
    .setMimeType(ContentService.MimeType.JSON);
}
