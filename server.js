const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const url = require('node:url');

const PORT = 3000;
const DB_PATH = path.join(__dirname, 'db.json');
const FRONTEND_DIR = __dirname;

// Helper to read DB
async function readDB() {
  try {
    const data = await fs.readFile(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading db.json:', err);
    return null;
  }
}

// Helper to write DB
async function writeDB(data) {
  try {
    await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing db.json:', err);
  }
}

// Helper to parse JSON body
function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', err => reject(err));
  });
}

// Helper for MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- REST API ENDPOINTS ---

  // GET /api/patient
  if (pathname === '/api/patient' && method === 'GET') {
    const db = await readDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.patient));
    return;
  }

  // GET /api/medications
  if (pathname === '/api/medications' && method === 'GET') {
    const db = await readDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.medications));
    return;
  }

  // POST /api/medications (Add Medication)
  if (pathname === '/api/medications' && method === 'POST') {
    try {
      const body = await getRequestBody(req);
      const db = await readDB();
      const newMed = {
        id: 'med-' + Date.now(),
        name: body.name || 'New Medication',
        dose: body.dose || '1 tablet',
        frequency: body.frequency || 'Once daily',
        scheduledTime: body.time || '08:00',
        scheduledTimeFormatted: body.timeFormatted || '8:00 AM',
        instructions: body.instructions || 'Take with water',
        status: 'due_soon',
        statusMessage: `Scheduled for ${body.timeFormatted || '8:00 AM'}`,
        lastTakenTimestamp: null,
        shareWithCaregiver: body.shareWithCaregiver !== false,
        color: 'orange'
      };

      db.medications.push(newMed);
      
      // Notify Grace on home screen if added remotely
      if (body.addedBy === 'Peter') {
        db.notifications.unshift({
          id: 'notif-' + Date.now(),
          title: 'New Medication Added',
          message: `Peter added ${newMed.name} (${newMed.dose}) at ${newMed.scheduledTimeFormatted} to your schedule.`,
          timestamp: new Date().toISOString(),
          read: false
        });
      }

      await writeDB(db);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, medication: newMed }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/logs/take (Confirm intake - Anti Double Dosing Lock)
  if (pathname === '/api/logs/take' && method === 'POST') {
    try {
      const body = await getRequestBody(req);
      const { medicationId } = body;
      const db = await readDB();

      const med = db.medications.find(m => m.id === medicationId);
      if (!med) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Medication not found' }));
        return;
      }

      const now = new Date();
      // Check 1-hour constraint (60 mins = 3600000 ms)
      if (med.lastTakenTimestamp) {
        const lastTaken = new Date(med.lastTakenTimestamp);
        const diffMs = now - lastTaken;
        if (diffMs < 3600000) {
          const remainingMins = Math.ceil((3600000 - diffMs) / 60000);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Double-dosing lock active!',
            blocked: true,
            message: `Dose already confirmed. System prevents double-dosing for ${remainingMins} more minutes.`
          }));
          return;
        }
      }

      // Record dose taken
      med.status = 'taken';
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      med.statusMessage = `Taken at ${timeStr} (Taken on time)`;
      med.lastTakenTimestamp = now.toISOString();
      med.color = 'green';

      // Update adherence metrics
      db.adherence.onTimeDoses += 1;
      db.adherence.overallPercentage = Math.round((db.adherence.onTimeDoses / db.adherence.totalDoses) * 100);

      await writeDB(db);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'Well done, Grace! Dose successfully confirmed.',
        medication: med,
        audioFeedback: 'Well done, Grace!'
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/logs/snooze (Snooze 10 min)
  if (pathname === '/api/logs/snooze' && method === 'POST') {
    try {
      const body = await getRequestBody(req);
      const { medicationId } = body;
      const db = await readDB();

      const med = db.medications.find(m => m.id === medicationId);
      if (med) {
        med.status = 'due_soon';
        med.statusMessage = 'Snoozed for 10 minutes';
        med.color = 'orange';
        await writeDB(db);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Reminder snoozed for 10 minutes.' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/caregiver/alerts
  if (pathname === '/api/caregiver/alerts' && method === 'GET') {
    const db = await readDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      alerts: db.alerts,
      missedBanner: db.medications.find(m => m.status === 'overdue')
    }));
    return;
  }

  // POST /api/caregiver/send-reminder
  if (pathname === '/api/caregiver/send-reminder' && method === 'POST') {
    try {
      const body = await getRequestBody(req);
      const db = await readDB();

      db.notifications.unshift({
        id: 'notif-' + Date.now(),
        title: 'Caregiver Reminder',
        message: `Peter sent a nudge: "Hi Grace, please remember to take your ${body.medicationName || 'medication'}!"`,
        timestamp: new Date().toISOString(),
        read: false
      });

      await writeDB(db);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Remote reminder nudge sent to Grace.' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/reports/adherence
  if (pathname === '/api/reports/adherence' && method === 'GET') {
    const db = await readDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.adherence));
    return;
  }

  // GET /api/reports/export (CSV / PDF report generator)
  if (pathname === '/api/reports/export' && method === 'GET') {
    const db = await readDB();
    const format = parsedUrl.query.format || 'csv';

    if (format === 'csv') {
      let csv = 'Patient Name,Age,Location,Medication,Dose,Scheduled Time,Status,Last Taken\n';
      db.medications.forEach(m => {
        csv += `"${db.patient.name}",${db.patient.age},"${db.patient.location}","${m.name}","${m.dose}","${m.scheduledTimeFormatted}","${m.status}","${m.statusMessage}"\n`;
      });
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="MediAssist_Adherence_Report.csv"'
      });
      res.end(csv);
      return;
    } else {
      // Printable HTML/PDF view
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>MediAssist Clinical Adherence Report - Grace Muthoni</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; color: #111; }
            h1 { color: #0284c7; margin-bottom: 4px; }
            .meta { font-size: 16px; color: #475569; margin-bottom: 24px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #cbd5e1; padding: 12px; text-align: left; }
            th { background: #f1f5f9; font-size: 14px; text-transform: uppercase; }
            .badge { padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; display: inline-block; }
            .badge-green { background: #dcfce7; color: #166534; }
            .badge-orange { background: #fef3c7; color: #92400e; }
            .badge-red { background: #fee2e2; color: #991b1b; }
            .ring-box { display: flex; align-items: center; gap: 24px; background: #f8fafc; padding: 20px; border-radius: 12px; margin-bottom: 24px; border: 1px solid #e2e8f0; }
            .ring-val { font-size: 48px; font-weight: 800; color: #16a34a; }
            @media print { button { display: none; } }
          </style>
        </head>
        <body>
          <button onclick="window.print()" style="float: right; padding: 10px 20px; background: #0284c7; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold;">Print / Save as PDF</button>
          <h1>MediAssist - Clinical Adherence Report</h1>
          <div class="meta">
            <strong>Patient:</strong> ${db.patient.name} (${db.patient.age} yrs) &bull; 
            <strong>Clinician:</strong> ${db.patient.clinician} &bull; 
            <strong>Caregiver:</strong> ${db.patient.caregiver}<br>
            <strong>Generated:</strong> ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>

          <div class="ring-box">
            <div class="ring-val">${db.adherence.overallPercentage}%</div>
            <div>
              <h3 style="margin: 0 0 6px 0;">Weekly Adherence Status</h3>
              <p style="margin: 0; color: #64748b;">${db.adherence.onTimeDoses} of ${db.adherence.totalDoses} doses taken on time. ${db.adherence.missedDoses} missed dose, ${db.adherence.lateDoses} late confirmation.</p>
            </div>
          </div>

          <h3>Medication Intake Logs</h3>
          <table>
            <thead>
              <tr>
                <th>Medication</th>
                <th>Dose</th>
                <th>Scheduled Time</th>
                <th>Current Status</th>
                <th>Status Detail</th>
              </tr>
            </thead>
            <tbody>
              ${db.medications.map(m => `
                <tr>
                  <td><strong>${m.name}</strong></td>
                  <td>${m.dose}</td>
                  <td>${m.scheduledTimeFormatted}</td>
                  <td>
                    <span class="badge badge-${m.color}">${m.status.toUpperCase()}</span>
                  </td>
                  <td>${m.statusMessage}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div style="margin-top: 40px; border-top: 1px solid #cbd5e1; padding-top: 20px; font-size: 13px; color: #64748b;">
            Confidential Medical Report &bull; Verified via MediAssist Digital Health Platform (Kenya)
          </div>
        </body>
        </html>
      `;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
  }

  // --- STATIC FILE SERVING FOR FRONTEND ---
  let filePath = path.join(FRONTEND_DIR, pathname === '/' ? 'index.html' : pathname);
  const extname = path.extname(filePath);
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      try {
        const indexContent = await fs.readFile(path.join(FRONTEND_DIR, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(indexContent, 'utf-8');
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      }
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Server Error: ${error.code}`);
    }
  }
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` MediAssist Server is running at http://localhost:${PORT}`);
  console.log(` Accessible, High-Contrast HCI Architecture Ready`);
  console.log(`====================================================`);
});
