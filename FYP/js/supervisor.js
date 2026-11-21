/* ============================================================
   supervisor.js — FYP Nexus Supervisor Dashboard Controller
   Features:
   - Supervise multiple students (FR 3, NFR 1)
   - Review and respond to proposals
   - Grade submissions with feedback
   - Schedule and manage meetings
   - Send messages to students
   - Track project progress across all supervisees
   ============================================================ */

'use strict';

// ── State ────────────────────────────────────────────────────
const S = {
  user:           null,
  students:       [],
  proposals:      [],
  submissions:    [],
  feedback:       [],
  meetings:       [],
  messages:       [],
  notifications:  [],
  groups:         [],
  currentPage:    'overview',
  currentStudent: null,
  currentSubmission: null,
  currentGroup:   null,
  pollTimer:      null,
  notifTimer:     null,
};

function applyTheme(theme) {
  const selectedTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', selectedTheme);
  const icon = document.getElementById('theme-icon');
  if (icon) {
    icon.className = selectedTheme === 'light' ? 'fas fa-sun' : 'fas fa-moon';
  }
  try {
    localStorage.setItem('fyp-theme', selectedTheme);
  } catch (e) {}
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(nextTheme);
}

// ── Bootstrap ────────────────────────────────────────────────
(async function init() {
  try {
    applyTheme(localStorage.getItem('fyp-theme') || 'dark');
    const res = await api('php/auth.php', { action: 'check' }, 'GET');
    if (!res.success) { window.location.href = 'index.html'; return; }
    if (res.user.role !== 'supervisor') { window.location.href = 'index.html'; return; }
    S.user = res.user;
    applyUser();
    await loadOverview();
    startNotifPoll();
  } catch (e) {
    showToast('Could not connect to server. Is the PHP server running?', 'err');
  }
})();

// ── API Helper ───────────────────────────────────────────────
async function api(endpoint, data = {}, method = 'POST') {
  let url = endpoint;
  const opts = { method, credentials: 'same-origin' };
  if (method === 'GET') {
    const qs = new URLSearchParams(data).toString();
    if (qs) url += '?' + qs;
  } else {
    const form = new FormData();
    Object.entries(data).forEach(([k, v]) => form.append(k, v));
    opts.body = form;
  }
  const res = await fetch(url, opts);
  return res.json();
}

// ── Navigation ───────────────────────────────────────────────
const PAGE_LABELS = {
  overview:    'Overview',
  groups:      'My Groups',
  students:    'My Students',
  submissions: 'Submissions',
  feedback:    'Feedback Given',
  messages:    'Messages',
  meetings:    'Meetings',
  profile:     'Profile',
};

async function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  document.getElementById('breadcrumb-label').textContent = PAGE_LABELS[page] || page;
  S.currentPage = page;

  switch (page) {
    case 'overview':    await loadOverview();    break;
    case 'groups':      await loadGroups();      break;
    case 'students':    await loadStudents();    break;
    case 'submissions': await loadSubmissions(); break;
    case 'feedback':    await loadFeedback();    break;
    case 'messages':    await loadMessages();    break;
    case 'meetings':    await loadMeetings();    break;
    case 'profile':     loadProfile();           break;
  }
}

// ── Apply User ───────────────────────────────────────────────
function applyUser() {
  const initials = (S.user.full_name || 'S').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('topbar-name').textContent   = S.user.full_name || 'Supervisor';
  document.getElementById('topbar-avatar').textContent = initials;
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('greeting').textContent = `${greet} 👋`;
}

// ══════════════════════════════════════════════════════════════
// OVERVIEW
// ══════════════════════════════════════════════════════════════
async function loadOverview() {
  try {
    const [stuRes, propRes, subRes, mtRes, notifRes] = await Promise.all([
      api('php/students.php', { action: 'get_assigned' }, 'GET'),
      api('php/proposals.php', { action: 'get_all' }, 'GET'),
      api('php/submissions.php', { action: 'get_all' }, 'GET'),
      api('php/meetings.php', { action: 'get_meetings' }, 'GET'),
      api('php/notifications.php', { action: 'get' }, 'GET'),
    ]);

    S.students    = stuRes.students || [];
    S.proposals   = propRes.proposals || [];
    S.submissions = subRes.submissions || [];
    S.meetings    = mtRes.meetings || [];
    S.groups      = buildGroupData();

    const pendingRev = S.submissions.filter(s => s.status === 'pending').length;
    const approvedProj = S.groups.filter(g => g.status === 'approved').length;
    const unreadMsg = notifRes.unread || 0;
    const upcomingMeet = S.meetings.filter(m => new Date(m.scheduled_at) >= new Date() && m.status === 'scheduled').slice(0, 5);

    setEl('stat-groups', S.groups.length);
    setEl('stat-group-students', S.students.length);
    setEl('stat-pending', pendingRev);
    setEl('stat-approved', approvedProj);
    setEl('stat-meetings', upcomingMeet.length);

    renderOverviewGroups(S.groups.slice(0, 5));
    renderOverviewSubmissions(S.submissions.filter(s => s.status === 'pending').slice(0, 5));
    renderOverviewTimeline(S.groups.slice(0, 4));

    updateNotifBadge(unreadMsg);

    if (pendingRev > 0) {
      const alertEl = document.getElementById('pending-alert');
      document.getElementById('pending-alert-title').textContent = 'Pending Reviews';
      document.getElementById('pending-alert-body').textContent = `You have ${pendingRev} submission${pendingRev > 1 ? 's' : ''} awaiting review.`;
      alertEl.style.display = '';
    } else {
      document.getElementById('pending-alert').style.display = 'none';
    }
  } catch (e) {
    console.error('Error loading overview:', e);
  }
}

function buildGroupData() {
  const baseGroups = [
    {
      id: 1,
      code: 'G-101',
      name: 'Alpha Innovators',
      title: 'AI-Powered Attendance Tracking',
      supervisor: S.user?.full_name || 'Supervisor',
      members: [
        { name: 'Mina Agyeman', index: 'CSE/2021/001' },
        { name: 'Kwame Boateng', index: 'CSE/2021/002' },
      ],
      status: 'approved',
      assignedAt: '2026-07-01',
      progress: 82,
      milestone: 'Chapter 2 Under Review',
      proposal: 'Submitted',
      chapters: 'Chapter 1 Submitted',
      feedback: 'Needs minor refinement on methodology.'
    },
    {
      id: 2,
      code: 'G-102',
      name: 'Blue Horizon',
      title: 'Smart Irrigation System',
      supervisor: S.user?.full_name || 'Supervisor',
      members: [
        { name: 'Sarah Mensah', index: 'CSE/2021/015' },
        { name: 'Daniel Addo', index: 'CSE/2021/016' },
        { name: 'Grace Osei', index: 'CSE/2021/017' },
      ],
      status: 'in_progress',
      assignedAt: '2026-07-08',
      progress: 64,
      milestone: 'Proposal Approved',
      proposal: 'Approved',
      chapters: 'Pending',
      feedback: 'Awaiting Chapter 1 review.'
    },
    {
      id: 3,
      code: 'G-103',
      name: 'Quantum Loop',
      title: 'Cloud-Based Learning Platform',
      supervisor: S.user?.full_name || 'Supervisor',
      members: [
        { name: 'Nadia Opoku', index: 'CSE/2021/023' },
      ],
      status: 'pending',
      assignedAt: '2026-07-12',
      progress: 42,
      milestone: 'Proposal Submitted',
      proposal: 'Submitted',
      chapters: 'Pending',
      feedback: 'Revision requested on project scope.'
    }
  ];

  return baseGroups.map(g => ({ ...g, memberCount: g.members.length }));
}

function renderOverviewGroups(groups) {
  const el = document.getElementById('overview-groups-list');
  if (!groups.length) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--txt3);font-size:13px;">No assigned groups yet.</div>`;
    return;
  }
  el.innerHTML = groups.map(g => `
    <div class="group-row" onclick="openGroupWorkspace(${g.id})" style="padding:12px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;gap:12px;">
      <div class="avatar avatar-teal" style="flex-shrink:0;">${g.code.split('-')[1] || 'G'}</div>
      <div style="flex:1;">
        <div style="font-weight:600;font-size:13px;">${esc(g.name)}</div>
        <div style="font-size:11px;color:var(--txt3);">${esc(g.code)} • ${esc(g.title)}</div>
      </div>
      <span class="badge badge-teal">${esc(g.status)}</span>
    </div>`).join('');
}

function renderOverviewTimeline(groups) {
  const el = document.getElementById('overview-timeline-list');
  if (!groups.length) {
    el.innerHTML = `<div class="empty-state" style="padding:28px;"><div class="empty-icon"><i class="fas fa-stream"></i></div><div class="empty-title">No group milestones yet</div></div>`;
    return;
  }
  el.innerHTML = groups.map(g => `
    <div style="padding:12px;border-bottom:1px solid var(--border);">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${esc(g.name)} — ${esc(g.milestone)}</div>
      <div style="font-size:11px;color:var(--txt3);">Proposal: ${esc(g.proposal)} • Chapters: ${esc(g.chapters)}</div>
    </div>`).join('');
}

function renderOverviewSubmissions(submissions) {
  const el = document.getElementById('overview-submissions-list');
  if (!submissions.length) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--txt3);font-size:13px;">No pending submissions.</div>`;
    return;
  }
  el.innerHTML = submissions.map(s => `
    <div class="submission-row" onclick="navigate('submissions'); S.currentSubmission = ${s.id};" style="padding:12px;border-bottom:1px solid var(--border);cursor:pointer;">
      <div style="flex:1;">
        <div style="font-weight:600;font-size:13px;">${esc(s.title)}</div>
        <div style="font-size:11px;color:var(--txt3);">${esc(s.student_name || '—')} · ${timeAgo(s.submitted_at)}</div>
      </div>
      <span class="badge badge-amber">Pending</span>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════════
// GROUPS
// ══════════════════════════════════════════════════════════════
async function loadGroups() {
  S.groups = buildGroupData();
  renderGroupsGrid(S.groups);
}

function renderGroupsGrid(groups) {
  const el = document.getElementById('groups-grid');
  if (!groups.length) {
    el.innerHTML = emptyState('🧩', 'No groups assigned', 'Groups assigned by the Admin will appear here.');
    return;
  }
  el.innerHTML = groups.map(g => `
    <div class="group-card" style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px;display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div>
          <div style="font-size:11px;color:var(--txt3);text-transform:uppercase;letter-spacing:.6px;">${esc(g.code)}</div>
          <h4 style="margin:6px 0 4px;font-family:var(--ff-display);font-size:16px;color:var(--txt);">${esc(g.name)}</h4>
          <div style="font-size:12px;color:var(--txt2);">${esc(g.title)}</div>
        </div>
        <span class="badge ${statusBadgeClass(g.status)}">${fmtStatus(g.status)}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;font-size:12px;color:var(--txt2);">
        <div><strong>Members</strong><div>${g.memberCount}</div></div>
        <div><strong>Progress</strong><div>${g.progress}%</div></div>
        <div><strong>Assigned</strong><div>${fmtDate(g.assignedAt)}</div></div>
        <div><strong>Milestone</strong><div>${esc(g.milestone)}</div></div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:10px;font-size:12px;color:var(--txt2);">
        <div><strong>Members:</strong> ${g.members.map(m => `${m.name} (${m.index})`).join(', ')}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" onclick="openGroupWorkspace(${g.id})"><i class="fas fa-eye"></i> View Group</button>
        <button class="btn btn-teal btn-sm" onclick="scheduleGroupMeeting(${g.id})"><i class="fas fa-calendar-plus"></i> Meet</button>
      </div>
    </div>`).join('');
}

function filterGroups(search) {
  const term = search.toLowerCase();
  const filtered = S.groups.filter(g =>
    (g.name || '').toLowerCase().includes(term) ||
    (g.code || '').toLowerCase().includes(term) ||
    (g.title || '').toLowerCase().includes(term)
  );
  renderGroupsGrid(filtered);
}

function openGroupWorkspace(groupId) {
  const group = S.groups.find(g => g.id === groupId);
  if (!group) return;
  S.currentGroup = groupId;
  document.getElementById('group-workspace-body').innerHTML = `
    <div class="grid-2" style="gap:16px;">
      <div class="card">
        <div class="card-hdr"><span class="card-title">Group Overview</span></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:10px;font-size:13px;color:var(--txt2);">
          <div><strong>Group Code:</strong> ${esc(group.code)}</div>
          <div><strong>Group Name:</strong> ${esc(group.name)}</div>
          <div><strong>Project Title:</strong> ${esc(group.title)}</div>
          <div><strong>Assigned Supervisor:</strong> ${esc(group.supervisor)}</div>
          <div><strong>Project Status:</strong> ${esc(fmtStatus(group.status))}</div>
          <div><strong>Date Assigned:</strong> ${fmtDate(group.assignedAt)}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-hdr"><span class="card-title">Group Members</span></div>
        <div class="card-body">
          ${group.members.map(member => `<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">${esc(member.name)} • ${esc(member.index)}</div>`).join('')}
        </div>
      </div>
    </div>
    <div class="grid-2" style="gap:16px;margin-top:16px;">
      <div class="card">
        <div class="card-hdr"><span class="card-title">Project Documents</span></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:8px;font-size:13px;color:var(--txt2);">
          <div>Proposal: <strong>${esc(group.proposal)}</strong></div>
          <div>Submitted Chapters: <strong>${esc(group.chapters)}</strong></div>
          <div>Final Report: <strong>Pending</strong></div>
          <div>Project Progress: <strong>${group.progress}%</strong></div>
        </div>
      </div>
      <div class="card">
        <div class="card-hdr"><span class="card-title">Supervisor Feedback</span></div>
        <div class="card-body" style="font-size:13px;color:var(--txt2);line-height:1.6;">${esc(group.feedback)}</div>
      </div>
    </div>
  `;
  document.getElementById('group-feedback').value = '';
  openModal('modal-group-workspace');
}

function scheduleGroupMeeting(groupId) {
  const group = S.groups.find(g => g.id === groupId);
  if (!group) return;
  document.getElementById('smt-student').value = group.members[0]?.name || '';
  document.getElementById('smt-title').value = `Meeting for ${group.name}`;
  document.getElementById('smt-type').value = 'video';
  document.getElementById('smt-duration').value = '60';
  document.getElementById('smt-datetime').value = '';
  document.getElementById('smt-agenda').value = `Discuss progress for ${group.title}`;
  openModal('modal-schedule-meeting');
}

function applyGroupAction(action) {
  const feedback = document.getElementById('group-feedback').value.trim();
  if (!feedback) {
    showToast('Please enter feedback before applying an action.', 'err');
    return;
  }
  if (action === 'meeting') {
    showToast('Meeting request prepared for the group.', 'ok');
    closeModal('modal-group-workspace');
    return;
  }
  showToast(`Action ${action} recorded for the group.`, 'ok');
  closeModal('modal-group-workspace');
}

// ══════════════════════════════════════════════════════════════
// STUDENTS
// ══════════════════════════════════════════════════════════════
async function loadStudents() {
  try {
    const res = await api('php/students.php', { action: 'get_assigned' }, 'GET');
    S.students = res.students || [];
    renderStudentsGrid(S.students);
  } catch (e) {
    console.error('Error loading students:', e);
  }
}

function renderStudentsGrid(students) {
  const el = document.getElementById('students-grid');
  if (!students.length) {
    el.innerHTML = emptyState('👥', 'No students assigned', 'Students will appear here once they are assigned.');
    return;
  }
  el.innerHTML = students.map(s => {
    const initials = (s.full_name || 'S').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    return `
      <div class="student-card" onclick="viewStudentDetail(${s.id})">
        <div class="avatar avatar-teal" style="width:48px;height:48px;font-size:18px;margin-bottom:12px;">${initials}</div>
        <h4 class="student-card-name">${esc(s.full_name)}</h4>
        <div class="student-card-id">${esc(s.student_id || 'No ID')}</div>
        <div class="student-card-progress">
          <span style="font-size:11px;color:var(--txt3);">Progress</span>
          <div class="progress-bar" style="margin-top:6px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
            <div class="progress-fill" style="width:${s.project_progress || 0}%;background:var(--teal);height:100%;"></div>
          </div>
          <div style="margin-top:4px;font-size:11px;color:var(--txt2);text-align:right;">${s.project_progress || 0}%</div>
        </div>
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:11px;color:var(--txt3);">
          <div>📧 ${esc(s.email || '—')}</div>
          ${s.phone ? `<div>📱 ${esc(s.phone)}</div>` : ''}
        </div>
        <div style="margin-top:12px;display:flex;gap:6px;">
          <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();" title="Send message">
            <i class="fas fa-message"></i>
          </button>
          <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation(); scheduleStudentMeeting(${s.id});" title="Schedule meeting">
            <i class="fas fa-video"></i>
          </button>
        </div>
      </div>`;
  }).join('');
}

function filterStudents(search) {
  const term = search.toLowerCase();
  const filtered = S.students.filter(s => 
    (s.full_name || '').toLowerCase().includes(term) ||
    (s.student_id || '').toLowerCase().includes(term) ||
    (s.email || '').toLowerCase().includes(term)
  );
  renderStudentsGrid(filtered);
}

function viewStudentDetail(studentId) {
  const student = S.students.find(s => s.id === studentId);
  if (!student) return;
  const initials = (student.full_name || 'S').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('student-detail-body').innerHTML = `
    <div style="display:flex;gap:20px;margin-bottom:20px;">
      <div class="avatar avatar-teal" style="width:60px;height:60px;font-size:24px;flex-shrink:0;">${initials}</div>
      <div style="flex:1;">
        <h3 style="margin:0 0 4px 0;">${esc(student.full_name)}</h3>
        <div style="color:var(--txt3);font-size:13px;margin-bottom:8px;">${esc(student.student_id)}</div>
        <div style="font-size:13px;margin-bottom:12px;">${esc(student.email)}</div>
        <div style="display:flex;gap:8px;">
          <span class="badge" style="background:var(--teal);color:white;">${student.project_progress || 0}% Progress</span>
          <span class="badge badge-gray">${student.department || 'Department'}</span>
        </div>
      </div>
    </div>
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px;">
      <h4 style="margin:0 0 8px 0;"><i class="fas fa-file-lines"></i> Project</h4>
      <div style="font-size:13px;">${esc(student.project_title || 'No project assigned yet')}</div>
    </div>
    ${student.bio ? `<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px;"><h4 style="margin:0 0 8px 0;"><i class="fas fa-info-circle"></i> Bio</h4><div style="font-size:13px;">${esc(student.bio)}</div></div>` : ''}
  `;
  openModal('modal-student-detail');
}

function scheduleStudentMeeting(studentId) {
  S.currentStudent = studentId;
  document.getElementById('smt-student').value = studentId;
  document.getElementById('smt-title').value = '';
  document.getElementById('smt-type').value = 'video';
  document.getElementById('smt-duration').value = '60';
  document.getElementById('smt-datetime').value = '';
  document.getElementById('smt-agenda').value = '';
  openModal('modal-schedule-meeting');
}

// ══════════════════════════════════════════════════════════════
// PROPOSALS
// ══════════════════════════════════════════════════════════════
async function loadProposals() {
  try {
    const res = await api('php/proposals.php', { action: 'get_all' }, 'GET');
    S.proposals = res.proposals || [];
    renderProposalsList(S.proposals);
  } catch (e) {
    console.error('Error loading proposals:', e);
  }
}

function renderProposalsList(proposals) {
  const el = document.getElementById('proposals-list');
  if (!proposals.length) {
    el.innerHTML = emptyState('📄', 'No proposals submitted', 'Proposals from your students will appear here.');
    return;
  }
  el.innerHTML = proposals.map(p => `
    <div class="proposal-card-list" onclick="viewProposalDetail(${p.id})" style="padding:16px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:12px;cursor:pointer;">
      <div style="flex:1;">
        <h4 style="margin:0 0 6px 0;">${esc(p.title)}</h4>
        <div style="font-size:12px;color:var(--txt3);margin-bottom:8px;">${esc(p.student_name)} • ${timeAgo(p.submitted_at)}</div>
        <p style="margin:0;font-size:12px;color:var(--txt2);line-height:1.4;">${esc((p.description || '').substring(0, 100))}${(p.description || '').length > 100 ? '...' : ''}</p>
      </div>
      <span class="badge ${statusBadgeClass(p.status)}">${fmtStatus(p.status)}</span>
    </div>`).join('');
}

function filterProposals(status) {
  const filtered = status === 'all' ? S.proposals : S.proposals.filter(p => p.status === status);
  renderProposalsList(filtered);
}

function viewProposalDetail(proposalId) {
  const proposal = S.proposals.find(p => p.id === proposalId);
  if (!proposal) return;
  document.getElementById('proposal-detail-body').innerHTML = `
    <div style="margin-bottom:16px;">
      <h4 style="margin:0 0 8px 0;">${esc(proposal.title)}</h4>
      <div style="font-size:12px;color:var(--txt3);margin-bottom:12px;">
        <span>${esc(proposal.student_name)}</span> • 
        <span>${fmtDateTime(proposal.submitted_at)}</span>
      </div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-bottom:12px;">
        ${esc(proposal.description || 'No description provided.')}
      </div>
    </div>
  `;
  document.getElementById('proposal-feedback').value = '';
  openModal('modal-proposal-detail');
}

async function respondProposal(status) {
  if (!S.proposals.length) return;
  const proposal = S.proposals[0];
  const feedback = document.getElementById('proposal-feedback').value;
  if ((status !== 'approved') && !feedback) {
    showToast('Please provide feedback for rejection or revision.', 'err');
    return;
  }
  const res = await api('php/proposals.php', {
    action: 'respond',
    id: proposal.id,
    status: status,
    feedback: feedback,
  });
  if (res.success) {
    closeModal('modal-proposal-detail');
    showToast(`Proposal ${status}!`, 'ok');
    await loadProposals();
  } else {
    showToast(res.message || 'Error updating proposal.', 'err');
  }
}

// ══════════════════════════════════════════════════════════════
// SUBMISSIONS
// ══════════════════════════════════════════════════════════════
async function loadSubmissions() {
  try {
    const res = await api('php/submissions.php', { action: 'get_all' }, 'GET');
    S.submissions = res.submissions || [];
    renderSubmissionsTable(S.submissions);
  } catch (e) {
    console.error('Error loading submissions:', e);
  }
}

function renderSubmissionsTable(submissions) {
  const tbody = document.getElementById('submissions-tbody');
  if (!submissions.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:40px;text-align:center;color:var(--txt3);">No submissions yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = submissions.map(s => `
    <tr onclick="reviewSubmission(${s.id})" style="cursor:pointer;">
      <td>${esc(s.student_name)}</td>
      <td>${esc(s.title)}</td>
      <td>${esc(s.type || 'Document')}</td>
      <td>${fmtDate(s.submitted_at)}</td>
      <td><span class="badge ${statusBadgeClass(s.status)}">${fmtStatus(s.status)}</span></td>
      <td>
        <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation(); downloadSubmission(${s.id});">
          <i class="fas fa-download"></i>
        </button>
        ${s.status === 'pending' ? `<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation(); gradeSubmission(${s.id});">Review</button>` : ''}
      </td>
    </tr>`).join('');
}

function filterSubmissions(status) {
  const filtered = status === 'all' ? S.submissions : S.submissions.filter(s => s.status === status);
  renderSubmissionsTable(filtered);
}

function reviewSubmission(submissionId) {
  const submission = S.submissions.find(s => s.id === submissionId);
  if (!submission) return;
  S.currentSubmission = submissionId;
  document.getElementById('review-submission-body').innerHTML = `
    <div style="margin-bottom:16px;">
      <h4 style="margin:0 0 6px 0;">${esc(submission.title)}</h4>
      <div style="font-size:12px;color:var(--txt3);margin-bottom:12px;">
        ${esc(submission.student_name)} • ${fmtDateTime(submission.submitted_at)}
      </div>
      ${submission.file_url ? `
        <a href="${submission.file_url}" class="btn btn-ghost btn-sm" download>
          <i class="fas fa-download"></i> Download
        </a>
      ` : ''}
    </div>
  `;
  document.getElementById('review-feedback').value = '';
  document.getElementById('review-grade').value = '';
  document.getElementById('review-decision').value = 'approved';
  openModal('modal-review');
}

async function submitReview() {
  if (!S.currentSubmission) return;
  const feedback = document.getElementById('review-feedback').value;
  if (!feedback) {
    showToast('Please provide feedback.', 'err');
    return;
  }
  const res = await api('php/submissions.php', {
    action: 'grade',
    id: S.currentSubmission,
    status: document.getElementById('review-decision').value,
    feedback: feedback,
    grade: document.getElementById('review-grade').value,
  });
  if (res.success) {
    closeModal('modal-review');
    showToast('Review submitted!', 'ok');
    await loadSubmissions();
  } else {
    showToast(res.message || 'Error submitting review.', 'err');
  }
}

function downloadSubmission(submissionId) {
  const submission = S.submissions.find(s => s.id === submissionId);
  if (submission && submission.file_url) {
    window.open(submission.file_url, '_blank');
  }
}

function gradeSubmission(submissionId) {
  reviewSubmission(submissionId);
}

// ══════════════════════════════════════════════════════════════
// FEEDBACK
// ══════════════════════════════════════════════════════════════
async function loadFeedback() {
  try {
    const res = await api('php/submissions.php', { action: 'get_all' }, 'GET');
    S.feedback = res.submissions ? res.submissions.filter(s => s.status !== 'pending') : [];
    renderFeedbackList(S.feedback);
  } catch (e) {
    console.error('Error loading feedback:', e);
  }
}

function renderFeedbackList(feedback) {
  const el = document.getElementById('feedback-list');
  if (!feedback.length) {
    el.innerHTML = emptyState('💬', 'No feedback given yet', 'Your feedback on submissions will appear here.');
    return;
  }
  el.innerHTML = feedback.map(f => `
    <div class="feedback-card" style="padding:16px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:12px;">
      <div class="feedback-card-top" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div>
          <div class="feedback-card-title">${esc(f.title)}</div>
          <div style="font-size:11px;color:var(--txt3);">${esc(f.student_name)}</div>
        </div>
        <span class="badge ${statusBadgeClass(f.status)}">${fmtStatus(f.status)}</span>
      </div>
      <div class="feedback-card-meta" style="display:flex;gap:12px;margin-bottom:8px;font-size:11px;color:var(--txt3);">
        <span><i class="fas fa-clock"></i> ${timeAgo(f.reviewed_at || f.updated_at)}</span>
        ${f.grade ? `<span><i class="fas fa-star"></i> ${esc(f.grade)}</span>` : ''}
      </div>
      <div class="feedback-card-preview" style="font-size:12px;color:var(--txt2);">${esc(f.feedback || 'No written feedback.')}</div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════════
// MESSAGES  (FR 5: communication between student & supervisor)
// ══════════════════════════════════════════════════════════════
async function loadMessages() {
  try {
    const res = await api('php/messages.php', { action: 'get_contacts' }, 'GET');
    const contacts = res.contacts || [];
    renderContacts(contacts);
    if (S.chatPartnerId) {
      await fetchMessages(S.chatPartnerId);
    }
    const unreadRes = await api('php/messages.php', { action: 'unread_count' }, 'GET');
    updateNotifBadge((unreadRes.count || 0));
  } catch (e) {
    console.error('Error loading messages:', e);
  }
}

function renderContacts(contacts) {
  const el = document.getElementById('chat-contacts');
  if (!contacts.length) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--txt3);font-size:13px;">No message contacts yet.</div>`;
    return;
  }
  el.innerHTML = contacts.map(c => {
    const initials = (c.full_name || 'S').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    return `
      <div class="chat-contact ${c.id === S.chatPartnerId ? 'active' : ''}" onclick="messageStudent(${c.id})">
        <div class="avatar avatar-teal" style="width:36px;height:36px;font-size:13px;flex-shrink:0;">${initials}</div>
        <div class="contact-body">
          <div class="contact-name">${esc(c.full_name)}</div>
          <div class="contact-last">${esc(c.last_message || 'No messages yet')}</div>
        </div>
        <div class="contact-right">
          ${c.last_at ? `<span class="contact-time">${timeAgo(c.last_at)}</span>` : ''}
          ${c.unread_count > 0 ? `<span class="contact-unread">${c.unread_count}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function messageStudent(studentId) {
  S.chatPartnerId = studentId;
  S.lastMsgId = 0;
  stopMsgPoll();
  const student = S.students.find(s => s.id === studentId);
  if (!student) return;
  const initials = (student.full_name || 'S').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('chat-partner-avatar').textContent = initials;
  document.getElementById('chat-partner-name').textContent   = student.full_name;
  document.getElementById('chat-partner-status').textContent = '🟢 Student';
  document.getElementById('chat-input-row').style.display = '';
  await loadMessages();
}

async function fetchMessages(partnerId, poll = false) {
  const res = await api('php/messages.php', { action: 'get_thread', user_id: partnerId }, 'GET');
  const msgs = res.messages || [];
  if (msgs.length) {
    poll ? appendMessages(msgs) : renderMessages(msgs);
  } else if (!poll) {
    document.getElementById('chat-messages').innerHTML = `<div class="empty-state" style="margin:auto;"><div class="empty-icon">💬</div><h4>Start the conversation</h4></div>`;
  }
}

function renderMessages(msgs) {
  const el = document.getElementById('chat-messages');
  el.innerHTML = msgs.map(msgBubble).join('');
  el.scrollTop = el.scrollHeight;
}

function appendMessages(msgs) {
  const el = document.getElementById('chat-messages');
  msgs.forEach(m => el.insertAdjacentHTML('beforeend', msgBubble(m)));
  el.scrollTop = el.scrollHeight;
}

function msgBubble(m) {
  const mine = m.sender_id == S.user.id;
  const initials = (m.sender_name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  return `
    <div class="msg ${mine ? 'mine' : 'theirs'}">
      ${!mine ? `<div class="avatar avatar-teal" style="width:28px;height:28px;font-size:10px;flex-shrink:0;">${initials}</div>` : ''}
      <div>
        <div class="msg-bubble">${esc(m.body)}</div>
        <div class="msg-time">${fmtTime(m.created_at)}</div>
      </div>
    </div>`;
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const body = input.value.trim();
  if (!body || !S.chatPartnerId) return;
  input.value = '';
  const res = await api('php/messages.php', { action: 'send', receiver_id: S.chatPartnerId, body });
  if (res.success) {
    appendMessages([res.message]);
  } else {
    showToast(res.message || 'Error sending message.', 'err');
  }
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function stopMsgPoll() {
  if (S.pollTimer) {
    clearInterval(S.pollTimer);
    S.pollTimer = null;
  }
}

// ══════════════════════════════════════════════════════════════
// MEETINGS  (FR 6: schedule and conduct meetings)
// ══════════════════════════════════════════════════════════════
async function loadMeetings() {
  try {
    const res = await api('php/meetings.php', { action: 'get_meetings' }, 'GET');
    S.meetings = res.meetings || [];
    const now = new Date();
    const upcoming = S.meetings.filter(m => new Date(m.scheduled_at) >= now && m.status === 'scheduled');
    const past = S.meetings.filter(m => new Date(m.scheduled_at) < now || m.status !== 'scheduled');

    setEl('upcoming-count', upcoming.length);

    const badge = document.getElementById('badge-meetings');
    if (upcoming.length) {
      badge.textContent = upcoming.length;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }

    const renderMeeting = (m, isPast) => {
      const typeIcon = { video: '📹', in_person: '🤝', phone: '📞' }[m.meeting_type] || '📅';
      const studentName = m.student_name || 'Unknown';
      return `
        <div class="meeting-card" style="padding:16px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:12px;display:flex;gap:16px;align-items:flex-start;">
          <div class="meeting-type-icon" style="font-size:24px;flex-shrink:0;">${typeIcon}</div>
          <div class="meeting-info" style="flex:1;">
            <div class="meeting-title" style="font-weight:600;margin-bottom:8px;">${esc(m.title)}</div>
            <div class="meeting-meta" style="display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:var(--txt3);">
              <span><i class="fas fa-user-tie"></i> ${esc(studentName)}</span>
              <span><i class="fas fa-calendar"></i> ${fmtDateTime(m.scheduled_at)}</span>
              <span><i class="fas fa-clock"></i> ${m.duration_mins || 60} min</span>
            </div>
            ${m.agenda ? `<div style="font-size:11px;color:var(--txt3);margin-top:8px;">${esc(m.agenda)}</div>` : ''}
          </div>
          <div class="meeting-actions" style="display:flex;gap:6px;flex-shrink:0;">
            ${m.meeting_type === 'video' && !isPast ? `<button class="btn btn-blue btn-sm" onclick="startVideoCall()"><i class="fas fa-video"></i> Join</button>` : ''}
            ${!isPast && m.organizer_id == S.user.id ? `<button class="btn btn-sm" style="background:rgba(224,82,82,.15);color:var(--red);border:none;" onclick="cancelMeeting(${m.id})"><i class="fas fa-times"></i></button>` : ''}
          </div>
        </div>`;
    };

    document.getElementById('upcoming-meetings').innerHTML = upcoming.length ? upcoming.map(m => renderMeeting(m, false)).join('') : emptyState('📅', 'No upcoming meetings', 'Schedule meetings with your students.');
    document.getElementById('past-meetings').innerHTML = past.length ? past.map(m => renderMeeting(m, true)).join('') : '';
  } catch (e) {
    console.error('Error loading meetings:', e);
  }
}

async function scheduleSupMeeting() {
  const studentId = document.getElementById('smt-student').value;
  const title = document.getElementById('smt-title').value;
  const datetime = document.getElementById('smt-datetime').value;

  if (!studentId || !title || !datetime) {
    showToast('Please fill in all required fields.', 'err');
    return;
  }

  const res = await api('php/meetings.php', {
    action: 'schedule',
    student_id: studentId,
    title: title,
    meeting_type: document.getElementById('smt-type').value,
    scheduled_at: datetime.replace('T', ' ') + ':00',
    duration_mins: document.getElementById('smt-duration').value,
    agenda: document.getElementById('smt-agenda').value,
  });

  if (res.success) {
    closeModal('modal-schedule-meeting');
    showToast('Meeting scheduled!', 'ok');
    await loadMeetings();
  } else {
    showToast(res.message || 'Error scheduling meeting.', 'err');
  }
}

async function cancelMeeting(id) {
  if (!confirm('Cancel this meeting?')) return;
  const res = await api('php/meetings.php', { action: 'delete', id });
  if (res.success) {
    showToast('Meeting cancelled.', 'ok');
    await loadMeetings();
  } else {
    showToast(res.message || 'Error cancelling meeting.', 'err');
  }
}

// ══════════════════════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════════════════════
function loadProfile() {
  const u = S.user;
  document.getElementById('prof-name').value = u.full_name || '';
  document.getElementById('prof-dept').value = u.department || '';
  document.getElementById('prof-phone').value = u.phone || '';
  document.getElementById('prof-bio').value = u.bio || '';
}

async function saveProfile() {
  const res = await api('php/auth.php', {
    action: 'update_profile',
    full_name: document.getElementById('prof-name').value,
    phone: document.getElementById('prof-phone').value,
    bio: document.getElementById('prof-bio').value,
    department: document.getElementById('prof-dept').value,
  });
  if (res.success) {
    S.user = { ...S.user, ...res.user };
    applyUser();
    loadProfile();
    showToast('Profile saved!', 'ok');
  } else {
    showToast(res.message || 'Error saving profile.', 'err');
  }
}

// ══════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════════════════════
function startNotifPoll() {
  fetchNotifs();
  S.notifTimer = setInterval(fetchNotifs, 15000);
}

async function fetchNotifs() {
  try {
    const res = await api('php/notifications.php', { action: 'get' }, 'GET');
    updateNotifBadge(res.unread || 0);
    renderNotifList(res.notifications || []);
  } catch (e) {
    console.error('Error fetching notifications:', e);
  }
}

function updateNotifBadge(count) {
  const badge = document.getElementById('notif-count');
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function renderNotifList(notifs) {
  const el = document.getElementById('notif-list');
  if (!notifs.length) {
    el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--txt3);font-size:13px;">No notifications</div>`;
    return;
  }
  const icons = { submission: '📁', feedback: '💬', meeting: '📅', message: '✉️', proposal: '📄', project: '📂' };
  el.innerHTML = notifs.slice(0, 12).map(n => `
    <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="markRead(${n.id})" style="padding:12px;border-bottom:1px solid var(--border);cursor:pointer;">
      <span class="notif-dot" style="background:${n.is_read ? 'var(--txt3)' : 'var(--amber)'};" ></span>
      <div class="notif-body">
        <div class="notif-title">${icons[n.type] || '🔔'} ${esc(n.title)}</div>
        <div class="notif-text">${esc(n.body || '')}</div>
        <div class="notif-time">${timeAgo(n.created_at)}</div>
      </div>
    </div>`).join('');
}

async function markRead(id) {
  await api('php/notifications.php', { action: 'mark_read', id });
  fetchNotifs();
}

async function markAllRead() {
  await api('php/notifications.php', { action: 'mark_read' });
  fetchNotifs();
  document.getElementById('notif-dropdown').classList.remove('open');
}

function toggleNotif() {
  document.getElementById('notif-dropdown').classList.toggle('open');
}

document.addEventListener('click', e => {
  const btn = document.getElementById('notif-btn');
  const drop = document.getElementById('notif-dropdown');
  if (!btn?.contains(e.target) && !drop?.contains(e.target)) {
    drop?.classList.remove('open');
  }
});

// ══════════════════════════════════════════════════════════════
// VIDEO CALL  (FR 6: video conferencing)
// ══════════════════════════════════════════════════════════════
async function startVideoCall() {
  const overlay = document.getElementById('video-overlay');
  overlay.style.display = 'flex';
  const partnerName = document.getElementById('chat-partner-name')?.textContent || 'Student';
  document.getElementById('vc-title').textContent = `Call with ${partnerName}`;
  document.getElementById('vc-remote-name').textContent = partnerName;
  document.getElementById('vc-local-name').textContent = S.user.full_name;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    S.callStream = stream;
    const lv = document.getElementById('local-video');
    lv.srcObject = stream;
    lv.style.display = 'block';
    document.getElementById('vc-local-placeholder').style.display = 'none';
    document.getElementById('vc-status-txt').textContent = 'Connected';
  } catch (e) {
    document.getElementById('vc-status-txt').textContent = 'Camera unavailable';
  }
  S.callSeconds = 0;
  S.callTimer = setInterval(() => {
    S.callSeconds++;
    const m = String(Math.floor(S.callSeconds / 60)).padStart(2, '0');
    const s = String(S.callSeconds % 60).padStart(2, '0');
    document.getElementById('vc-timer').textContent = `${m}:${s}`;
  }, 1000);
}

function endCall() {
  if (S.callStream) {
    S.callStream.getTracks().forEach(t => t.stop());
    S.callStream = null;
  }
  if (S.callTimer) {
    clearInterval(S.callTimer);
    S.callTimer = null;
  }
  document.getElementById('video-overlay').style.display = 'none';
  document.getElementById('vc-timer').textContent = '00:00';
  document.getElementById('local-video').style.display = 'none';
  document.getElementById('vc-local-placeholder').style.display = '';
}

function toggleMic() {
  S.micOn = !S.micOn;
  if (S.callStream) {
    S.callStream.getAudioTracks().forEach(t => (t.enabled = S.micOn));
  }
  const btn = document.getElementById('btn-mic');
  btn.className = `vc-btn ${S.micOn ? 'vc-btn-on' : 'vc-btn-off'}`;
  btn.innerHTML = `<i class="fas fa-microphone${S.micOn ? '' : '-slash'}"></i>`;
}

function toggleCam() {
  S.camOn = !S.camOn;
  if (S.callStream) {
    S.callStream.getVideoTracks().forEach(t => (t.enabled = S.camOn));
  }
  const btn = document.getElementById('btn-cam');
  btn.className = `vc-btn ${S.camOn ? 'vc-btn-on' : 'vc-btn-off'}`;
  btn.innerHTML = `<i class="fas fa-video${S.camOn ? '' : '-slash'}"></i>`;
}

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════
async function doLogout() {
  await api('php/auth.php', { action: 'logout' });
  window.location.href = 'index.html';
}

// ══════════════════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════════════════
function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  }
});

// ══════════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════════
let toastTimer;

function showToast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 3500);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ══════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════
function val(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function setEl(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtTime(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function daysUntil(s) {
  return Math.ceil((new Date(s + 'T23:59:59') - new Date()) / 86400000);
}

function timeAgo(dt) {
  if (!dt) return '';
  const d = (Date.now() - new Date(dt)) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  if (d < 604800) return Math.floor(d / 86400) + 'd ago';
  return fmtDate(dt.split(' ')[0]);
}

function fmtStatus(s) {
  return {
    pending: 'Pending',
    active: 'Active',
    under_review: 'Under Review',
    completed: 'Completed',
    rejected: 'Rejected',
    in_progress: 'In Progress',
    overdue: 'Overdue',
    approved: 'Approved',
    revision: 'Revision',
  }[s] || s;
}

function statusBadgeClass(s) {
  return {
    pending: 'badge-gray',
    active: 'badge-teal',
    under_review: 'badge-blue',
    completed: 'badge-green',
    rejected: 'badge-red',
    in_progress: 'badge-amber',
    overdue: 'badge-red',
    approved: 'badge-green',
    revision: 'badge-amber',
  }[s] || 'badge-gray';
}

function emptyState(icon, title, desc) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><h4>${esc(title)}</h4>${desc ? `<p>${esc(desc)}</p>` : ''}</div>`;
}

