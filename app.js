// ==========================================================================
// MEDIASSIST - FRONTEND APPLICATION LOGIC (HCI & ACCESSIBILITY)
// Real-time API Sync, Speech & Sound Engine, Persona Router, Haptics
// ==========================================================================

const API_BASE = 'http://localhost:3000/api';

// State Management
let currentRole = 'patient'; // 'patient' | 'caregiver' | 'clinician'
let currentFilter = 'all'; // 'all' | 'due_soon' | 'overdue' | 'taken'
let medications = [];
let activeAlertMedication = null;

// DOM Elements
const rolePatientBtn = document.getElementById('role-patient-btn');
const roleCaregiverBtn = document.getElementById('role-caregiver-btn');
const roleClinicianBtn = document.getElementById('role-clinician-btn');

const viewPatient = document.getElementById('view-patient');
const viewCaregiver = document.getElementById('view-caregiver');
const viewClinician = document.getElementById('view-clinician');

const scheduleList = document.getElementById('patient-schedule-list');
const countTaken = document.getElementById('count-taken');
const countDue = document.getElementById('count-due');
const countMissed = document.getElementById('count-missed');

const filterBtnTaken = document.getElementById('filter-btn-taken');
const filterBtnDue = document.getElementById('filter-btn-due');
const filterBtnMissed = document.getElementById('filter-btn-missed');

const chipAll = document.getElementById('chip-all');
const chipDue = document.getElementById('chip-due');
const chipMissed = document.getElementById('chip-missed');
const chipTaken = document.getElementById('chip-taken');

const scheduleSectionTitle = document.getElementById('schedule-section-title');
const activeFilterBadge = document.getElementById('active-filter-badge');

const modalReminder = document.getElementById('modal-reminder');
const alertMedName = document.getElementById('alert-med-name');
const alertMedInstr = document.getElementById('alert-med-instr');
const alertMedTime = document.getElementById('alert-med-time');
const btnConfirmIntake = document.getElementById('btn-confirm-intake');
const btnSnoozeIntake = document.getElementById('btn-snooze-intake');

const modalAddMed = document.getElementById('modal-add-med');
const openAddMedBtn = document.getElementById('open-add-med-btn');
const closeAddModalBtn = document.getElementById('close-add-modal');
const addMedForm = document.getElementById('add-med-form');
const caregiverAddMedBtn = document.getElementById('caregiver-add-med-btn');

const caregiverStatusList = document.getElementById('caregiver-status-list');
const smsAlertLog = document.getElementById('sms-alert-log');
const nudgeGraceBtn = document.getElementById('nudge-grace-btn');

const simTriggerAlarm = document.getElementById('sim-trigger-alarm');
const simTriggerMissed = document.getElementById('sim-trigger-missed');
const simTestVoice = document.getElementById('sim-test-voice');

const patientNotifBanner = document.getElementById('patient-notif-banner');
const closeNotifBtn = document.getElementById('close-notif-btn');

// --- SOUND & SPEECH SYNTHESIS ENGINE ---
function speakText(text) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
  }
}

function playAlarmChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    console.warn('Audio Context sound play error:', e);
  }
}

function triggerHaptic() {
  if ('vibrate' in navigator) {
    navigator.vibrate([100, 50, 100]);
  }
}

// --- PERSONA ROUTER ---
function setRole(role) {
  currentRole = role;

  [rolePatientBtn, roleCaregiverBtn, roleClinicianBtn].forEach(btn => btn.classList.remove('active'));
  if (role === 'patient') rolePatientBtn.classList.add('active');
  if (role === 'caregiver') roleCaregiverBtn.classList.add('active');
  if (role === 'clinician') roleClinicianBtn.classList.add('active');

  viewPatient.classList.add('hidden-view');
  viewCaregiver.classList.add('hidden-view');
  viewClinician.classList.add('hidden-view');

  viewPatient.classList.remove('active-view');
  viewCaregiver.classList.remove('active-view');
  viewClinician.classList.remove('active-view');

  if (role === 'patient') {
    viewPatient.classList.remove('hidden-view');
    viewPatient.classList.add('active-view');
  } else if (role === 'caregiver') {
    viewCaregiver.classList.remove('hidden-view');
    viewCaregiver.classList.add('active-view');
    renderCaregiverDashboard();
  } else if (role === 'clinician') {
    viewClinician.classList.remove('hidden-view');
    viewClinician.classList.add('active-view');
  }
}

// --- FILTER CONTROLLER ---
function setFilter(filter) {
  currentFilter = filter;

  // Update active styling on metric cards & chips
  [filterBtnTaken, filterBtnDue, filterBtnMissed].forEach(b => b.classList.remove('active-filter'));
  [chipAll, chipDue, chipMissed, chipTaken].forEach(c => c.classList.remove('active-chip'));

  if (filter === 'taken') {
    filterBtnTaken.classList.add('active-filter');
    chipTaken.classList.add('active-chip');
    scheduleSectionTitle.textContent = "🟢 Taken Medications";
    activeFilterBadge.textContent = "Filtered: Taken Only";
  } else if (filter === 'due_soon') {
    filterBtnDue.classList.add('active-filter');
    chipDue.classList.add('active-chip');
    scheduleSectionTitle.textContent = "🟡 Due Soon Medications";
    activeFilterBadge.textContent = "Filtered: Due Soon";
  } else if (filter === 'overdue') {
    filterBtnMissed.classList.add('active-filter');
    chipMissed.classList.add('active-chip');
    scheduleSectionTitle.textContent = "🔴 Missed & Overdue";
    activeFilterBadge.textContent = "Filtered: Missed";
  } else {
    chipAll.classList.add('active-chip');
    scheduleSectionTitle.textContent = "Today's Schedule";
    activeFilterBadge.textContent = "All 3 Categories";
  }

  renderPatientSchedule();
}

// --- API FETCH & DATA SYNC ---
async function loadMedications() {
  try {
    const res = await fetch(`${API_BASE}/medications`);
    medications = await res.json();
    renderPatientSchedule();
  } catch (err) {
    console.error('Failed to load medications:', err);
  }
}

function createMedicationCardHTML(med) {
  const card = document.createElement('div');
  card.className = `med-card card-${med.status}`;
  card.setAttribute('data-id', med.id);
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'button');

  const dotClass = med.color === 'green' ? 'dot-green' : (med.color === 'orange' ? 'dot-orange' : 'dot-red');
  const actionText = med.status === 'taken' ? '✓ Taken' : (med.status === 'due_soon' ? 'Take Pill ›' : 'Overdue ›');

  card.innerHTML = `
    <div class="status-dot ${dotClass}"></div>
    <div class="med-info">
      <div class="med-name-title">${med.name} ${med.dose}</div>
      <div class="med-sub-detail">${med.scheduledTimeFormatted} &bull; ${med.statusMessage}</div>
    </div>
    <span class="tap-hint">${actionText}</span>
  `;

  card.addEventListener('click', () => {
    if (med.status === 'taken') {
      speakText(`${med.name} ${med.dose} was taken on time.`);
      alert(`✅ ${med.name} ${med.dose}\n\nStatus: ${med.statusMessage}\nNote: 1-hour anti-double-dosing lock active for safety.`);
    } else {
      openReminderOverlay(med);
    }
  });

  return card;
}

function renderPatientSchedule() {
  scheduleList.innerHTML = '';

  let takenCount = 0;
  let dueCount = 0;
  let missedCount = 0;

  medications.forEach(med => {
    if (med.status === 'taken') takenCount++;
    if (med.status === 'due_soon') dueCount++;
    if (med.status === 'overdue') missedCount++;
  });

  countTaken.textContent = takenCount;
  countDue.textContent = dueCount;
  countMissed.textContent = missedCount;

  // Group medications by status
  const dueSoonMeds = medications.filter(m => m.status === 'due_soon');
  const missedMeds = medications.filter(m => m.status === 'overdue');
  const takenMeds = medications.filter(m => m.status === 'taken');

  // Helper to render category section
  function renderCategorySection(title, iconClass, medList, container) {
    if (medList.length === 0) return;

    const groupDiv = document.createElement('div');
    groupDiv.className = 'category-group';

    const headerDiv = document.createElement('div');
    headerDiv.className = `category-header ${iconClass}`;
    headerDiv.innerHTML = `
      <span>${title}</span>
      <span class="cat-count-badge">${medList.length} ${medList.length === 1 ? 'medication' : 'medications'}</span>
    `;

    groupDiv.appendChild(headerDiv);

    medList.forEach(med => {
      const cardEl = createMedicationCardHTML(med);
      groupDiv.appendChild(cardEl);
    });

    container.appendChild(groupDiv);
  }

  // Render according to active filter
  if (currentFilter === 'due_soon') {
    renderCategorySection('🟡 DUE SOON', 'cat-hdr-due', dueSoonMeds, scheduleList);
  } else if (currentFilter === 'overdue') {
    renderCategorySection('🔴 MISSED & OVERDUE', 'cat-hdr-missed', missedMeds, scheduleList);
  } else if (currentFilter === 'taken') {
    renderCategorySection('🟢 TAKEN TODAY', 'cat-hdr-taken', takenMeds, scheduleList);
  } else {
    // Show All categorized groups cleanly separated
    renderCategorySection('🟡 DUE SOON', 'cat-hdr-due', dueSoonMeds, scheduleList);
    renderCategorySection('🔴 MISSED & OVERDUE', 'cat-hdr-missed', missedMeds, scheduleList);
    renderCategorySection('🟢 TAKEN TODAY', 'cat-hdr-taken', takenMeds, scheduleList);
  }
}

function renderCaregiverDashboard() {
  caregiverStatusList.innerHTML = '';
  medications.forEach(med => {
    const item = document.createElement('div');
    item.className = 'med-card';
    const dotClass = med.color === 'green' ? 'dot-green' : (med.color === 'orange' ? 'dot-orange' : 'dot-red');
    item.innerHTML = `
      <div class="status-dot ${dotClass}"></div>
      <div class="med-info">
        <div class="med-name-title">${med.name} ${med.dose}</div>
        <div class="med-sub-detail">${med.statusMessage}</div>
      </div>
    `;
    caregiverStatusList.appendChild(item);
  });

  fetch(`${API_BASE}/caregiver/alerts`)
    .then(res => res.json())
    .then(data => {
      smsAlertLog.innerHTML = '';
      if (data.alerts && data.alerts.length > 0) {
        data.alerts.forEach(al => {
          const logItem = document.createElement('div');
          logItem.className = 'sms-log-item';
          logItem.innerHTML = `
            <strong>🚨 Automated SMS Sent:</strong> ${al.message}<br>
            <small style="color: #64748b;">To: ${al.recipient} &bull; Channel: ${al.channel}</small>
          `;
          smsAlertLog.appendChild(logItem);
        });
      } else {
        smsAlertLog.innerHTML = '<p style="color: #64748b; font-size: 14px;">No emergency alerts logged today.</p>';
      }
    })
    .catch(err => console.error(err));
}

// --- REMINDER OVERLAY (FIGMA S2) ---
function openReminderOverlay(med) {
  activeAlertMedication = med;
  alertMedName.textContent = `${med.name} ${med.dose}`;
  alertMedInstr.textContent = med.instructions || 'Take with a glass of water';
  alertMedTime.textContent = `Scheduled for ${med.scheduledTimeFormatted}`;
  modalReminder.classList.remove('hidden');

  playAlarmChime();
  speakText(`Reminder for Grace: Time to take ${med.name} ${med.dose}. ${med.instructions}`);
}

function closeReminderOverlay() {
  modalReminder.classList.add('hidden');
  activeAlertMedication = null;
}

async function confirmDoseIntake() {
  if (!activeAlertMedication) return;

  try {
    const res = await fetch(`${API_BASE}/logs/take`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medicationId: activeAlertMedication.id })
    });

    const result = await res.json();

    if (!res.ok && result.blocked) {
      alert(`⚠️ ${result.message}`);
      return;
    }

    triggerHaptic();
    speakText("Well done, Grace!");
    closeReminderOverlay();
    await loadMedications();
  } catch (err) {
    console.error('Error confirming intake:', err);
  }
}

async function snoozeDoseIntake() {
  if (!activeAlertMedication) return;

  try {
    await fetch(`${API_BASE}/logs/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medicationId: activeAlertMedication.id })
    });

    speakText("Reminder snoozed for 10 minutes.");
    closeReminderOverlay();
    await loadMedications();
  } catch (err) {
    console.error('Error snoozing:', err);
  }
}

// --- ADD MEDICATION FORM (FIGMA S3) ---
function openAddMedModal() { modalAddMed.classList.remove('hidden'); }
function closeAddMedModal() { modalAddMed.classList.add('hidden'); }

addMedForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('form-med-name').value;
  const dose = document.getElementById('form-med-dose').value;
  const frequency = document.getElementById('form-med-freq').value;
  const time = document.getElementById('form-med-time').value;
  const shareWithCaregiver = document.getElementById('form-share-toggle').checked;

  const [h, m] = time.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  const timeFormatted = `${hour12}:${m} ${ampm}`;

  const payload = {
    name,
    dose,
    frequency,
    time,
    timeFormatted,
    shareWithCaregiver,
    addedBy: currentRole === 'caregiver' ? 'Peter' : 'Grace'
  };

  try {
    const res = await fetch(`${API_BASE}/medications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      closeAddMedModal();
      addMedForm.reset();
      await loadMedications();

      if (currentRole === 'caregiver') {
        alert(`Success! ${name} has been added remotely. Grace's app has been updated.`);
        patientNotifBanner.classList.remove('hidden');
      } else {
        speakText(`Added ${name} to your daily schedule.`);
      }
    }
  } catch (err) {
    console.error('Error adding medication:', err);
  }
});

// Caregiver Nudge
nudgeGraceBtn.addEventListener('click', async () => {
  try {
    await fetch(`${API_BASE}/caregiver/send-reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medicationName: 'Ibuprofen 200mg' })
    });
    alert('🔔 Remote reminder notification sent to Grace!');
    patientNotifBanner.classList.remove('hidden');
  } catch (err) {
    console.error(err);
  }
});

// Event Listeners
rolePatientBtn.addEventListener('click', () => setRole('patient'));
roleCaregiverBtn.addEventListener('click', () => setRole('caregiver'));
roleClinicianBtn.addEventListener('click', () => setRole('clinician'));

// Clickable Metric Filter Cards & Chips
filterBtnTaken.addEventListener('click', () => setFilter('taken'));
filterBtnDue.addEventListener('click', () => setFilter('due_soon'));
filterBtnMissed.addEventListener('click', () => setFilter('overdue'));

chipAll.addEventListener('click', () => setFilter('all'));
chipDue.addEventListener('click', () => setFilter('due_soon'));
chipMissed.addEventListener('click', () => setFilter('overdue'));
chipTaken.addEventListener('click', () => setFilter('taken'));

btnConfirmIntake.addEventListener('click', confirmDoseIntake);
btnSnoozeIntake.addEventListener('click', snoozeDoseIntake);

openAddMedBtn.addEventListener('click', openAddMedModal);
caregiverAddMedBtn.addEventListener('click', openAddMedModal);
closeAddModalBtn.addEventListener('click', closeAddMedModal);

closeNotifBtn.addEventListener('click', () => patientNotifBanner.classList.add('hidden'));

document.getElementById('nav-reports-btn').addEventListener('click', () => setRole('clinician'));

simTriggerAlarm.addEventListener('click', () => {
  const amlodipine = medications.find(m => m.name.includes('Amlodipine')) || medications[0];
  if (amlodipine) openReminderOverlay(amlodipine);
});

simTriggerMissed.addEventListener('click', () => {
  setRole('caregiver');
  const alertBanner = document.getElementById('missed-alert-banner');
  alertBanner.scrollIntoView({ behavior: 'smooth' });
  speakText("Caregiver Alert: Grace's Ibuprofen dose is overdue by 34 minutes.");
});

simTestVoice.addEventListener('click', () => {
  speakText("Well done, Grace!");
});

window.addEventListener('DOMContentLoaded', () => {
  loadMedications();
});
