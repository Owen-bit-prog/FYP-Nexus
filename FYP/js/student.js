/* ============================================================
   student.js — FYP Nexus Student Dashboard Controller v2
   Thesis-informed improvements:
   - Proposal submission + status tracking (FR 2)
   - Problem-tracking alert banners (Problem Statement)
   - Objectives checklist mapped to milestones (Obj 1–6)
   - Document-loss prevention messaging (Significance 2)
   - Structured feedback with revision alerts (Significance 3)
   - Role-based access enforcement (FR 3, NFR 1)
   - Centralized record display (Significance 4)
   ============================================================ */

'use strict';

// ── State ────────────────────────────────────────────────────
const S = {
  user:          null,
  project:       null,
  milestones:    [],
  files:         [],
  meetings:      [],
  chatPartnerId: null,
  chatProjectId: null,
  lastMsgId:     0,
  pollTimer:     null,
  notifTimer:    null,
  callStream:    null,
  callTimer:     null,
  callSeconds:   0,
  micOn:         true,
  camOn:         true,
  currentPage:   'overview',
};

// Thesis-defined objectives mapped to functional requirements
const PROJECT_OBJECTIVES = [
  { id: 1, label: 'Project proposal submitted and approved',       check: (p, ms) => ms.some(m => m.title.toLowerCase().includes('proposal') && m.status === 'completed') },
  { id: 2, label: 'Literature review completed',                   check: (p, ms) => ms.some(m => m.title.toLowerCase().includes('literature') && m.status === 'completed') },
  { id: 3, label: 'System design document submitted',              check: (p, ms, f) => f.some(x => x.submission_type === 'chapter' && x.review_status === 'approved') },
  { id: 4, label: 'Project files securely stored in repository',   check: (p, ms, f) => f.length > 0 },
  { id: 5, label: 'Supervisor feedback received and addressed',    check: (p, ms, f) => f.some(x => x.review_status === 'approved') },
  { id: 6, label: 'Final report submitted for evaluation',         check: (p, ms) => ms.some(m => m.title.toLowerCase().includes('final') && m.status === 'completed') },
];

// ── Bootstrap ────────────────────────────────────────────────
(async function init() {
  try {
    const res = await api('php/auth.php', { action: 'check' }, 'GET');
    if (!res.success) { window.location.href = 'index.html'; return; }
    if (res.user.role !== 'student') { window.location.href = 'index.html'; return; }
    S.user = res.user;
    applyTheme();
    applyUser();
    await loadOverview();
    startNotifPoll();
    setupDropZone();
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
function toFormData(obj) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) fd.append(k, v);
  return fd;
}

// ── Navigation ───────────────────────────────────────────────
const PAGE_LABELS = {
  overview:'Overview', group:'My Group', project:'My Project', proposal:'Proposal',
  milestones:'Milestones', submissions:'Submissions', feedback:'Feedback',
  messages:'Messages', meetings:'Meetings', profile:'Profile',
};

async function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  document.getElementById('breadcrumb-label').textContent = PAGE_LABELS[page] || page;
  S.currentPage = page;
  if (page !== 'messages') stopMsgPoll();

  switch (page) {
    case 'overview':    await loadOverview();    break;
    case 'group':       await loadGroup();       break;
    case 'project':     await loadProject();     break;
    case 'proposal':    await loadProposal();    break;
    case 'milestones':  await loadMilestones();  break;
    case 'submissions': await loadSubmissions(); break;
    case 'feedback':    await loadFeedback();    break;
    case 'messages':    await loadMessages();    break;
    case 'meetings':    await loadMeetings();    break;
    case 'profile':     loadProfile();           break;
  }
}

// ── Apply User ───────────────────────────────────────────────
function applyTheme(theme = localStorage.getItem('fyp-theme') || 'dark') {
  document.body.classList.toggle('light-theme', theme === 'light');
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    const icon = btn.querySelector('i');
    if (icon) icon.className = theme === 'light' ? 'fas fa-sun' : 'fas fa-moon';
    btn.setAttribute('title', theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
  }
}

function toggleTheme() {
  const next = document.body.classList.contains('light-theme') ? 'dark' : 'light';
  localStorage.setItem('fyp-theme', next);
  applyTheme(next);
}

function applyUser() {
  const initials = (S.user.full_name || 'S').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('topbar-name').textContent   = S.user.full_name;
  document.getElementById('topbar-avatar').textContent = initials;
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('greeting').textContent = `${greet}, ${S.user.full_name.split(' ')[0]} 👋`;
}

// ══════════════════════════════════════════════════════════════
// OVERVIEW
// ══════════════════════════════════════════════════════════════
async function loadOverview() {
  const [projRes, notifRes, mtRes] = await Promise.all([
    api('php/projects.php', { action: 'get_my_projects' }, 'GET'),
    api('php/notifications.php', { action: 'get' }, 'GET'),
    api('php/meetings.php', { action: 'get_meetings' }, 'GET'),
  ]);

  S.project  = projRes.projects?.[0] || null;
  S.meetings = mtRes.meetings || [];

  // Progress stat
  const pct = S.project?.progress || 0;
  setEl('stat-progress', pct + '%');
  document.getElementById('stat-progress-bar').style.width = pct + '%';

  // Milestones stat
  let msRes = { milestones: [] };
  let filesRes = { files: [] };
  if (S.project) {
    [msRes, filesRes] = await Promise.all([
      api(`php/projects.php?action=get_milestones&project_id=${S.project.id}`),
      api(`php/files.php?action=get_files&project_id=${S.project.id}`),
    ]);
    S.milestones = msRes.milestones || [];
    S.files      = filesRes.files   || [];
  }

  const done    = S.milestones.filter(m => m.status === 'completed').length;
  const pending = S.files.filter(f => f.review_status === 'pending').length;
  const upcoming = S.meetings.filter(m => new Date(m.scheduled_at) > new Date() && m.status === 'scheduled');

  setEl('stat-milestones',     done);
  setEl('stat-milestones-sub', `of ${S.milestones.length} total`);
  setEl('stat-files',          S.files.length);
  setEl('stat-files-sub',      `${pending} pending review`);
  setEl('stat-meetings',       upcoming.length);
  setEl('stat-meetings-sub',   upcoming.length === 1 ? 'meeting' : 'meetings');

  renderOverviewProject(S.project);
  renderOverviewProposalStatus();

  // Activity
  if (S.project) {
    const actRes = await api('php/projects.php', { action: 'get_activity', project_id: S.project.id, limit: 8 }, 'GET');
    renderActivityFeed(actRes.activity || []);
  } else {
    document.getElementById('activity-feed').innerHTML = emptyState('📋', 'No activity yet', 'Create your project to get started.');
  }

  renderOverviewMilestones(S.milestones);
  updateNotifBadge(notifRes.unread || 0);
  checkProblemAlerts();
}

async function loadGroup() {
  const res = await api('php/projects.php', { action: 'get_group_dashboard' }, 'GET');
  const group = res.group || null;
  const emptyEl = document.getElementById('group-empty-state');
  const dashEl = document.getElementById('group-dashboard');

  if (!group) {
    emptyEl.style.display = '';
    dashEl.style.display = 'none';
    emptyEl.innerHTML = emptyState('👥', 'No project group assigned', 'You have not yet been assigned to a project group. Please wait for your department administrator.');
    return;
  }

  emptyEl.style.display = 'none';
  dashEl.style.display = '';

  document.getElementById('group-overview').innerHTML = `
    <div class="proj-overview-title">${esc(group.group_name || 'Project Group')}</div>
    <div class="proj-overview-desc">${esc(group.project_description || 'Shared workspace for your assigned group project.')}</div>
    <div class="proj-overview-meta">
      <span><i class="fas fa-fingerprint"></i> <strong>${esc(group.group_code)}</strong></span>
      <span><i class="fas fa-folder"></i> <strong>${esc(group.project_title || '—')}</strong></span>
      <span><i class="fas fa-calendar"></i> <strong>${esc(group.date_created || '—')}</strong></span>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
      <span class="badge badge-teal">${esc(group.group_status || 'Pending')}</span>
      <span class="badge badge-blue">${esc(group.group_leader ? 'Group Leader' : 'Group Member')}</span>
    </div>`;

  document.getElementById('group-members').innerHTML = `
    ${group.members.map(member => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-weight:700;">${esc(member.name || '—')}</div>
          <div style="font-size:12px;color:var(--txt2);">${esc(member.index_number || '—')}</div>
        </div>
        <span class="badge ${member.is_group_leader ? 'badge-green' : 'badge-gray'}">${member.is_group_leader ? 'Group Leader' : 'Member'}</span>
      </div>`).join('')}`;

  document.getElementById('group-workspace').innerHTML = `
    <div class="proj-meta-grid">
      <div class="proj-meta-item"><span class="proj-meta-label">Project Title</span><span class="proj-meta-val">${esc(group.workspace.project_title || '—')}</span></div>
      <div class="proj-meta-item"><span class="proj-meta-label">Project Status</span><span class="proj-meta-val">${esc(group.workspace.project_status || '—')}</span></div>
      <div class="proj-meta-item"><span class="proj-meta-label">Progress</span><span class="proj-meta-val">${group.workspace.project_progress ?? 0}%</span></div>
      <div class="proj-meta-item"><span class="proj-meta-label">Proposal Submission</span><span class="proj-meta-val">${esc(group.workspace.proposal_submission || 'Not submitted')}</span></div>
      <div class="proj-meta-item"><span class="proj-meta-label">Chapter Submissions</span><span class="proj-meta-val">${group.workspace.chapter_submissions ?? 0}</span></div>
      <div class="proj-meta-item"><span class="proj-meta-label">Final Report</span><span class="proj-meta-val">${esc(group.workspace.final_report || 'Not submitted')}</span></div>
    </div>`;

  document.getElementById('group-supervisor').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
      <div class="avatar avatar-teal" style="width:44px;height:44px;">${esc((group.supervisor.name || 'S').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase())}</div>
      <div>
        <div style="font-weight:700;">${esc(group.supervisor.name || '—')}</div>
        <div style="font-size:12px;color:var(--txt2);">${esc(group.supervisor.department || '—')}</div>
      </div>
    </div>
    <div class="proj-meta-grid">
      <div class="proj-meta-item"><span class="proj-meta-label">Staff ID</span><span class="proj-meta-val">${esc(group.supervisor.staff_id || '—')}</span></div>
      <div class="proj-meta-item"><span class="proj-meta-label">Email</span><span class="proj-meta-val">${esc(group.supervisor.email || '—')}</span></div>
    </div>`;

  document.getElementById('group-feedback').innerHTML = group.feedback.length ? group.feedback.map(item => `
    <div style="padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="font-weight:700;margin-bottom:4px;">${esc(item.title || 'Feedback')}</div>
      <div style="font-size:12px;color:var(--txt2);margin-bottom:6px;">${esc(item.feedback || 'No written feedback provided.')}</div>
      <div style="font-size:11px;color:var(--txt3);">${esc(item.reviewed_at || '—')}</div>
    </div>`).join('') : emptyState('💬', 'No supervisor feedback yet', 'Feedback from your supervisor will appear here.');

  document.getElementById('group-updates').innerHTML = `
    <div style="margin-bottom:12px;">
      <div style="font-weight:700;margin-bottom:8px;">Upcoming Meetings</div>
      ${group.meetings.length ? group.meetings.map(meeting => `
        <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;color:var(--txt2);">
          <div style="font-weight:700;color:var(--txt);">${esc(meeting.title || 'Meeting')}</div>
          <div>${esc(meeting.scheduled_at || '—')}</div>
          <div>${esc(meeting.meeting_type || '—')} · ${esc(meeting.notes || 'No notes provided')}</div>
        </div>`).join('') : '<div style="font-size:12px;color:var(--txt3);">No meetings scheduled yet.</div>'}
    </div>
    <div>
      <div style="font-weight:700;margin-bottom:8px;">Notifications</div>
      ${group.notifications.length ? group.notifications.map(note => `
        <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;color:var(--txt2);">
          <div style="font-weight:700;color:var(--txt);">${esc(note.title || 'Update')}</div>
          <div>${esc(note.body || 'No details available')}</div>
        </div>`).join('') : '<div style="font-size:12px;color:var(--txt3);">No notifications yet.</div>'}
    </div>`;
}

function renderOverviewProject(project) {
  const body = document.getElementById('overview-project-body');
  if (!project) {
    body.innerHTML = `
      <div class="empty-state" style="padding:24px 0;">
        <div class="empty-icon" style="font-size:36px;">📂</div>
        <h4>No Project Yet</h4>
        <p>Create your FYP project to begin tracking progress.</p>
        <button class="btn btn-amber btn-sm" style="margin-top:14px;" onclick="navigate('project')">
          <i class="fas fa-plus"></i> Create Project
        </button>
      </div>`;
    return;
  }
  const daysLeft = project.deadline ? daysUntil(project.deadline) : null;
  body.innerHTML = `
    <div class="proj-overview-title">${esc(project.title)}</div>
    <div class="proj-overview-desc">${esc(project.description || 'No description provided.')}</div>
    <div class="proj-overview-meta">
      <span><i class="fas fa-tag"></i> <strong>${esc(project.category || 'Uncategorised')}</strong></span>
      ${project.supervisor_name ? `<span><i class="fas fa-user-tie"></i> <strong>${esc(project.supervisor_name)}</strong></span>` : ''}
      ${daysLeft !== null ? `<span><i class="fas fa-calendar"></i> <strong ${daysLeft <= 14 ? 'style="color:var(--red)"' : ''}>${fmtDate(project.deadline)}${daysLeft <= 14 ? ` (${daysLeft}d left)` : ''}</strong></span>` : ''}
    </div>
    <div class="progress-wrap">
      <div class="progress-label"><span>Progress</span><span>${project.progress}%</span></div>
      <div class="progress-bar"><div class="progress-fill" style="width:${project.progress}%"></div></div>
    </div>
    <div style="margin-top:12px;">
      <span class="badge ${statusBadgeClass(project.status)}">${fmtStatus(project.status)}</span>
    </div>`;
}

function renderOverviewProposalStatus() {
  const el = document.getElementById('overview-proposal-body');
  // Check if proposal was submitted (files with sub_type = 'report' or proposal-title check)
  const proposalFile = S.files.find(f =>
    f.submission_type === 'report' ||
    (f.title || '').toLowerCase().includes('proposal')
  );
  if (!proposalFile) {
    el.innerHTML = `
      <div class="empty-state" style="padding:18px 0;">
        <div class="empty-icon" style="font-size:28px;">📄</div>
        <h4 style="font-size:14px;">No Proposal Submitted</h4>
        <p>Submit your project proposal for supervisor approval.</p>
        <button class="btn btn-amber btn-sm" style="margin-top:12px;" onclick="navigate('proposal')">
          <i class="fas fa-paper-plane"></i> Submit Now
        </button>
      </div>`;
    document.getElementById('badge-proposal').style.display = '';
    return;
  }
  document.getElementById('badge-proposal').style.display = 'none';
  const icon = { pending:'⏳', approved:'✅', revision:'🔄', rejected:'❌' }[proposalFile.review_status] || '📄';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;">
      <div style="font-size:32px;">${icon}</div>
      <div>
        <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${esc(proposalFile.title || 'Project Proposal')}</div>
        <span class="badge ${reviewBadgeClass(proposalFile.review_status)}">${fmtReviewStatus(proposalFile.review_status)}</span>
        <div style="font-size:11px;color:var(--txt3);margin-top:6px;">Submitted ${timeAgo(proposalFile.created_at)}</div>
      </div>
    </div>`;
}

function renderOverviewMilestones(milestones) {
  const el = document.getElementById('overview-milestones');
  const upcoming = milestones.filter(m => m.status !== 'completed').slice(0, 3);
  if (!upcoming.length) {
    el.innerHTML = `<div class="empty-state" style="padding:24px 0;"><div class="empty-icon" style="font-size:28px;">🏁</div><h4>All milestones complete!</h4></div>`;
    return;
  }
  el.innerHTML = upcoming.map(m => renderMilestoneItem(m, false)).join('');
}

function checkProblemAlerts() {
  const alertEl   = document.getElementById('problem-alert');
  const titleEl   = document.getElementById('problem-alert-title');
  const bodyEl    = document.getElementById('problem-alert-body');

  // Problem 1: overdue milestones
  const overdue = S.milestones.filter(m => m.status !== 'completed' && m.due_date && new Date(m.due_date) < new Date());
  if (overdue.length) {
    titleEl.textContent = `${overdue.length} Overdue Milestone${overdue.length > 1 ? 's' : ''}`;
    bodyEl.textContent  = `You have overdue milestones: ${overdue.map(m => m.title).join(', ')}. Update their status or speak to your supervisor.`;
    alertEl.style.display = '';
    return;
  }
  // Problem 2: needs-revision files
  const revisions = S.files.filter(f => f.review_status === 'revision');
  if (revisions.length) {
    titleEl.textContent = 'Revision Required';
    bodyEl.textContent  = `${revisions.length} submission${revisions.length > 1 ? 's require' : ' requires'} revision. Review supervisor feedback and resubmit.`;
    alertEl.style.display = '';
    return;
  }
  alertEl.style.display = 'none';
}

function dismissAlert() {
  document.getElementById('problem-alert').style.display = 'none';
}

// ══════════════════════════════════════════════════════════════
// PROJECT
// ══════════════════════════════════════════════════════════════
async function loadProject() {
  const res = await api('php/projects.php', { action: 'get_my_projects' }, 'GET');
  S.project = res.projects?.[0] || null;

  const noState  = document.getElementById('no-project-state');
  const details  = document.getElementById('project-details');
  const btnEdit  = document.getElementById('btn-edit-project');
  const btnCreate= document.getElementById('btn-create-project');

  if (!S.project) {
    noState.style.display = ''; details.style.display = 'none';
    btnEdit.style.display = 'none'; btnCreate.style.display = '';
    return;
  }

  noState.style.display = 'none'; details.style.display = '';
  btnEdit.style.display = ''; btnCreate.style.display = 'none';

  setEl('proj-title',      S.project.title);
  setEl('proj-description',S.project.description || 'No description provided.');
  setEl('proj-category',   S.project.category || '—');
  setEl('proj-start',      S.project.start_date  ? fmtDate(S.project.start_date)  : '—');
  setEl('proj-deadline',   S.project.deadline     ? fmtDate(S.project.deadline)    : '—');
  setEl('proj-tags',       S.project.tags         || '—');
  setEl('proj-progress-label', S.project.progress + '%');
  document.getElementById('proj-progress-bar').style.width = S.project.progress + '%';

  const badge = document.getElementById('proj-status-badge');
  badge.className   = 'badge ' + statusBadgeClass(S.project.status);
  badge.textContent = fmtStatus(S.project.status);

  // Supervisor
  if (S.project.supervisor_name) {
    const initials = S.project.supervisor_name.split(' ').map(w => w[0]).join('').slice(0,2);
    document.getElementById('sup-avatar').textContent = initials;
    setEl('sup-name',  S.project.supervisor_name);
    setEl('sup-dept',  S.project.supervisor_dept  || '—');
    setEl('sup-email', S.project.supervisor_email || '—');
  } else {
    document.getElementById('supervisor-card-body').innerHTML = `
      <div class="empty-state" style="padding:18px 0;">
        <div class="empty-icon" style="font-size:28px;">👨‍🏫</div>
        <h4>No Supervisor Assigned</h4>
        <p>Edit your project to assign a supervisor by email.</p>
      </div>`;
  }

  // Objectives checklist — ties FR list from thesis
  if (!S.milestones.length) {
    const msRes = await api('php/projects.php', { action: 'get_milestones', project_id: S.project.id }, 'GET');
    S.milestones = msRes.milestones || [];
  }
  if (!S.files.length) {
    const fRes = await api('php/files.php', { action: 'get_files', project_id: S.project.id }, 'GET');
    S.files = fRes.files || [];
  }
  renderObjectivesChecklist();
}

function renderObjectivesChecklist() {
  const el = document.getElementById('objectives-checklist');
  let doneCount = 0;
  el.innerHTML = PROJECT_OBJECTIVES.map(obj => {
    const done = obj.check(S.project, S.milestones, S.files);
    if (done) doneCount++;
    return `
      <div class="objective-item">
        <div class="objective-check ${done ? 'done' : 'pending'}">
          ${done ? '<i class="fas fa-check"></i>' : '<i class="fas fa-minus"></i>'}
        </div>
        <span class="objective-label ${done ? 'done' : ''}">${obj.id}. ${obj.label}</span>
        ${done ? '<span class="badge badge-green" style="font-size:10px;margin-left:auto;">Done</span>' : ''}
      </div>`;
  }).join('');
  setEl('objectives-progress-label', `${doneCount} / ${PROJECT_OBJECTIVES.length} complete`);
}

function openCreateProject() { openModal('modal-create-project'); }
function openEditProject() {
  if (!S.project) return;
  document.getElementById('ep-title').value    = S.project.title       || '';
  document.getElementById('ep-desc').value     = S.project.description || '';
  document.getElementById('ep-deadline').value = S.project.deadline    || '';
  document.getElementById('ep-tags').value     = S.project.tags        || '';
  const sel = document.getElementById('ep-category');
  for (const opt of sel.options) if (opt.value === S.project.category) { opt.selected = true; break; }
  openModal('modal-edit-project');
}
async function createProject() {
  const title = val('cp-title');
  if (!title) { showToast('Project title is required.', 'err'); return; }
  const res = await api('php/projects.php', {
    action: 'create', title,
    description:       val('cp-desc'),
    category:          val('cp-category'),
    deadline:          val('cp-deadline'),
    supervisor_email:  val('cp-supervisor'),
    tags:              val('cp-tags'),
  });
  if (res.success) { closeModal('modal-create-project'); showToast('Project created!', 'ok'); await loadProject(); }
  else showToast(res.message, 'err');
}
async function saveEditProject() {
  if (!S.project) return;
  const res = await api('php/projects.php', {
    action: 'update', id: S.project.id,
    title:       val('ep-title'),
    description: val('ep-desc'),
    category:    val('ep-category'),
    deadline:    val('ep-deadline'),
    tags:        val('ep-tags'),
  });
  if (res.success) { closeModal('modal-edit-project'); showToast('Project updated!', 'ok'); await loadProject(); }
  else showToast(res.message, 'err');
}

// ══════════════════════════════════════════════════════════════
// PROPOSAL  (FR 2: students submit proposals; Supervisor reviews)
// ══════════════════════════════════════════════════════════════
async function loadProposal() {
  if (!S.project) {
    const p = await api('php/projects.php', { action: 'get_my_projects' }, 'GET');
    S.project = p.projects?.[0] || null;
  }

  const panelEl  = document.getElementById('proposal-panel');
  const histEl   = document.getElementById('proposal-history');
  const btnEl    = document.getElementById('btn-submit-proposal');

  if (!S.project) {
    panelEl.innerHTML = `
      <div class="proposal-card">
        <div class="proposal-icon none">📂</div>
        <div class="proposal-info">
          <h4>No Project Found</h4>
          <p>You need to create a project before you can submit a proposal.</p>
          <div class="proposal-meta"><span>Go to <strong>My Project</strong> to get started.</span></div>
        </div>
        <button class="btn btn-amber btn-sm" onclick="navigate('project')">Create Project</button>
      </div>`;
    histEl.innerHTML = emptyState('📋', 'No proposals submitted', '');
    return;
  }

  const filesRes = await api('php/files.php', { action: 'get_files', project_id: S.project.id }, 'GET');
  const allFiles = filesRes.files || [];
  S.files        = allFiles;

  const proposals = allFiles.filter(f =>
    f.submission_type === 'report' || (f.title || '').toLowerCase().includes('proposal')
  );
  const latest = proposals[0] || null;

  if (!latest) {
    panelEl.innerHTML = `
      <div class="proposal-card">
        <div class="proposal-icon none">📄</div>
        <div class="proposal-info">
          <h4>No Proposal Submitted Yet</h4>
          <p>Your project proposal must be submitted and approved by your supervisor before you can begin the full supervision process.</p>
          <div class="proposal-meta"><span>Click <strong>Submit Proposal</strong> to begin.</span></div>
        </div>
      </div>`;
    btnEl.style.display = '';
    document.getElementById('badge-proposal').style.display = '';
  } else {
    const statusMap = { pending:'Awaiting Review', approved:'Approved', revision:'Revision Required', rejected:'Rejected' };
    const iconMap   = { pending:'⏳', approved:'✅', revision:'🔄', rejected:'❌' };
    const colorMap  = { pending:'pending', approved:'approved', revision:'revision', rejected:'rejected' };

    panelEl.innerHTML = `
      <div class="proposal-card">
        <div class="proposal-icon ${colorMap[latest.review_status]}">${iconMap[latest.review_status]}</div>
        <div class="proposal-info">
          <h4>${esc(latest.title || 'Project Proposal')}</h4>
          <p>${latest.review_status === 'approved'
            ? 'Your proposal has been approved. You may proceed with full project development.'
            : latest.review_status === 'revision'
            ? 'Your supervisor has requested revisions. Review the feedback and resubmit.'
            : latest.review_status === 'rejected'
            ? 'Your proposal was rejected. Review feedback and contact your supervisor.'
            : 'Your proposal is awaiting review by your supervisor.'
          }</p>
          ${latest.feedback ? `<div style="margin-top:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--txt2);">💬 ${esc(latest.feedback)}</div>` : ''}
          <div class="proposal-meta">
            <span><i class="fas fa-clock"></i> Submitted ${timeAgo(latest.created_at)}</span>
            ${latest.grade ? `<span><i class="fas fa-star"></i> Grade: ${esc(latest.grade)}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <span class="badge ${reviewBadgeClass(latest.review_status)}">${statusMap[latest.review_status]}</span>
          <a href="php/files.php?action=download&id=${latest.id}" class="btn btn-ghost btn-sm" download>
            <i class="fas fa-download"></i> Download
          </a>
        </div>
      </div>`;

    btnEl.innerHTML  = latest.review_status === 'revision'
      ? '<i class="fas fa-rotate"></i> Resubmit Proposal'
      : '<i class="fas fa-plus"></i> Submit New Version';
    document.getElementById('badge-proposal').style.display = latest.review_status === 'revision' ? '' : 'none';
  }

  // History
  if (!proposals.length) {
    histEl.innerHTML = emptyState('📋', 'No submissions yet', '');
  } else {
    histEl.innerHTML = proposals.map(f => `
      <div class="file-item">
        <div class="file-ext ${fileExtClass(f.original_name)}">${fileExt(f.original_name)}</div>
        <div class="file-info">
          <div class="file-name">${esc(f.title || f.original_name)}</div>
          <div class="file-meta"><span>${f.size_fmt}</span> · <span>${timeAgo(f.created_at)}</span></div>
        </div>
        <div class="file-actions" style="display:flex;align-items:center;gap:8px;">
          <span class="badge ${reviewBadgeClass(f.review_status)}">${fmtReviewStatus(f.review_status)}</span>
          <a href="php/files.php?action=download&id=${f.id}" class="btn btn-ghost btn-sm" download>
            <i class="fas fa-download"></i>
          </a>
        </div>
      </div>`).join('');
  }
}

function openProposalModal() {
  if (!S.project) { showToast('Please create a project first.', 'err'); return; }
  document.getElementById('prop-title').value       = S.project.title || '';
  document.getElementById('prop-problem').value     = '';
  document.getElementById('prop-objectives').value  = '';
  document.getElementById('prop-method').value      = '';
  document.getElementById('prop-notes').value       = '';
  document.getElementById('proposal-file-label').textContent = 'Click to attach PDF or DOCX';
  document.getElementById('proposal-file-input').value = '';
  openModal('modal-proposal');
}

function previewProposalFile(input) {
  const f = input.files[0];
  if (f) document.getElementById('proposal-file-label').textContent = f.name;
}

async function submitProposal() {
  const fileInput = document.getElementById('proposal-file-input');
  const title     = val('prop-title');
  if (!title)             { showToast('Proposal title is required.', 'err'); return; }
  if (!fileInput.files[0]){ showToast('Please attach your proposal document.', 'err'); return; }

  const problem    = val('prop-problem');
  const objectives = val('prop-objectives');
  const method     = val('prop-method');
  const notes      = [problem && `Problem: ${problem}`, objectives && `Objectives: ${objectives}`, method && `Methodology: ${method}`, val('prop-notes')].filter(Boolean).join('\n\n');

  const fd = new FormData();
  fd.append('action',      'upload');
  fd.append('project_id',  S.project.id);
  fd.append('title',       title);
  fd.append('sub_type',    'report');
  fd.append('notes',       notes);
  fd.append('file',        fileInput.files[0]);

  const btn = document.querySelector('#modal-proposal .btn-amber');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting…';

  const res = await api('php/files.php', fd);
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit for Review';

  if (res.success) {
    closeModal('modal-proposal');
    showToast('Proposal submitted for supervisor review!', 'ok');
    await loadProposal();
  } else showToast(res.message, 'err');
}

// ══════════════════════════════════════════════════════════════
// MILESTONES
// ══════════════════════════════════════════════════════════════
async function loadMilestones() {
  if (!S.project) {
    const p = await api('php/projects.php', { action: 'get_my_projects' }, 'GET');
    S.project = p.projects?.[0] || null;
  }
  if (!S.project) {
    document.getElementById('milestones-timeline').innerHTML = emptyState('📋', 'No project found', 'Create a project first.');
    return;
  }
  const res    = await api('php/projects.php', { action: 'get_milestones', project_id: S.project.id }, 'GET');
  S.milestones = res.milestones || [];
  renderMilestonesTimeline();
  updateMilestoneSummary();
}

function renderMilestonesTimeline() {
  const el = document.getElementById('milestones-timeline');
  if (!S.milestones.length) {
    el.innerHTML = emptyState('🗓️', 'No Milestones Yet', 'Add milestones to track each stage of your project.');
    return;
  }
  el.innerHTML = S.milestones.map(m => renderMilestoneItem(m, true)).join('');
}

function renderMilestoneItem(m, showActions = true) {
  const overdue  = m.status !== 'completed' && m.due_date && new Date(m.due_date) < new Date();
  const dotClass = overdue ? 'over' : statusDotClass(m.status);
  const daysLeft = m.due_date ? daysUntil(m.due_date) : null;

  const actionBtns = showActions ? `
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
      ${m.status !== 'in_progress' && m.status !== 'completed' ? `<button class="ms-action-btn pend" onclick="setMilestoneStatus(${m.id},'in_progress')">▶ Start</button>` : ''}
      ${m.status !== 'completed' ? `<button class="ms-action-btn done" onclick="setMilestoneStatus(${m.id},'completed')">✓ Mark Done</button>` : `<button class="ms-action-btn pend" onclick="setMilestoneStatus(${m.id},'in_progress')">↺ Reopen</button>`}
    </div>` : '';

  return `
    <div class="timeline-item ${dotClass}">
      <div class="timeline-dot"></div>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
        <div style="flex:1;">
          <div class="timeline-title">${esc(m.title)}</div>
          ${m.description ? `<div style="font-size:12px;color:var(--txt2);margin-top:3px;">${esc(m.description)}</div>` : ''}
          <div class="timeline-meta">
            <span class="badge ${statusBadgeClass(m.status)}">${fmtStatus(m.status)}</span>
            ${m.due_date ? `<span><i class="fas fa-calendar" style="opacity:.5;"></i> ${fmtDate(m.due_date)}
              ${daysLeft !== null && daysLeft < 0 ? '<span style="color:var(--red);font-weight:700;"> (overdue)</span>' : daysLeft !== null && daysLeft <= 7 ? `<span style="color:var(--amber);"> (${daysLeft}d left)</span>` : ''}</span>` : ''}
          </div>
          ${actionBtns}
        </div>
      </div>
    </div>`;
}

async function setMilestoneStatus(id, status) {
  const res = await api('php/projects.php', { action: 'update_milestone', id, status });
  if (res.success) { showToast('Milestone updated!', 'ok'); await loadMilestones(); }
  else showToast(res.message, 'err');
}

function updateMilestoneSummary() {
  const counts = { completed:0, in_progress:0, pending:0, overdue:0 };
  let done = 0;
  for (const m of S.milestones) {
    const over = m.status !== 'completed' && m.due_date && new Date(m.due_date) < new Date();
    if (over) counts.overdue++;
    else { counts[m.status] = (counts[m.status]||0) + 1; }
    if (m.status === 'completed') done++;
  }
  setEl('ms-done-count', counts.completed);
  setEl('ms-prog-count', counts.in_progress);
  setEl('ms-pend-count', counts.pending);
  setEl('ms-over-count', counts.overdue);
  const pct = S.milestones.length ? Math.round((done / S.milestones.length) * 100) : 0;
  setEl('ms-overall-pct', pct + '%');
  document.getElementById('ms-overall-bar').style.width = pct + '%';
}

function openAddMilestone() {
  if (!S.project) { showToast('Create a project first.', 'err'); return; }
  document.getElementById('ms-title').value = '';
  document.getElementById('ms-desc').value  = '';
  document.getElementById('ms-due').value   = '';
  openModal('modal-add-milestone');
}
async function addMilestone() {
  const title = val('ms-title');
  if (!title) { showToast('Milestone title is required.', 'err'); return; }
  const res = await api('php/projects.php', {
    action: 'add_milestone', project_id: S.project.id,
    title, description: val('ms-desc'), due_date: val('ms-due'),
  });
  if (res.success) { closeModal('modal-add-milestone'); showToast('Milestone added!', 'ok'); await loadMilestones(); }
  else showToast(res.message, 'err');
}

// ══════════════════════════════════════════════════════════════
// SUBMISSIONS  (FR 4: upload/download; Significance 2: no loss)
// ══════════════════════════════════════════════════════════════
async function loadSubmissions() {
  if (!S.project) {
    const p = await api('php/projects.php', { action: 'get_my_projects' }, 'GET');
    S.project = p.projects?.[0] || null;
  }
  if (!S.project) {
    document.getElementById('files-list').innerHTML = emptyState('📁', 'No project yet', 'Create a project before uploading files.');
    return;
  }
  if (!S.milestones.length) {
    const msRes = await api('php/projects.php', { action: 'get_milestones', project_id: S.project.id }, 'GET');
    S.milestones = msRes.milestones || [];
  }
  const msSel = document.getElementById('up-milestone');
  msSel.innerHTML = '<option value="">None</option>' +
    S.milestones.map(m => `<option value="${m.id}">${esc(m.title)}</option>`).join('');

  const res = await api('php/files.php', { action: 'get_files', project_id: S.project.id }, 'GET');
  S.files = res.files || [];
  renderFilesList(S.files);
}

function renderFilesList(files) {
  const el = document.getElementById('files-list');
  if (!files.length) {
    el.innerHTML = emptyState('📤', 'No submissions yet', 'Upload your first file to get feedback from your supervisor.');
    return;
  }
  el.innerHTML = files.map(f => `
    <div class="file-item">
      <div class="file-ext ${fileExtClass(f.original_name)}">${fileExt(f.original_name)}</div>
      <div class="file-info">
        <div class="file-name">${esc(f.title || f.original_name)}</div>
        <div class="file-meta">
          <span>${esc(f.submission_type)}</span> · <span>${f.size_fmt}</span> · <span>${timeAgo(f.created_at)}</span>
          ${f.milestone_id ? `· <span><i class="fas fa-list-check" style="opacity:.5;"></i> Linked milestone</span>` : ''}
        </div>
      </div>
      <div style="flex-shrink:0;display:flex;align-items:center;gap:8px;">
        <span class="badge ${reviewBadgeClass(f.review_status)}">${fmtReviewStatus(f.review_status)}</span>
        <a href="php/files.php?action=download&id=${f.id}" class="btn btn-ghost btn-sm" download title="Download">
          <i class="fas fa-download"></i>
        </a>
        <button class="btn btn-sm" style="background:rgba(224,82,82,0.15);color:var(--red);border:none;" onclick="deleteFile(${f.id})" title="Delete">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>`).join('');
}

function filterFiles() {
  const filter = val('files-filter');
  renderFilesList(filter ? S.files.filter(f => f.review_status === filter) : S.files);
}

function openUploadModal() {
  if (!S.project) { showToast('Create a project first.', 'err'); return; }
  document.getElementById('up-title').value      = '';
  document.getElementById('up-notes').value      = '';
  document.getElementById('up-type').value       = 'chapter';
  document.getElementById('upload-file-label').textContent = 'Click to select file';
  document.getElementById('modal-file-input').value = '';
  openModal('modal-upload');
}
function previewUpload(input) {
  const f = input.files[0];
  if (f) document.getElementById('upload-file-label').textContent = `${f.name} (${(f.size/1024/1024).toFixed(2)} MB)`;
}
function handleDroppedFiles(files) {
  if (!S.project) { showToast('Create a project first.', 'err'); return; }
  openUploadModal();
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  const inp = document.getElementById('modal-file-input');
  inp.files = dt.files;
  previewUpload(inp);
}
async function uploadFile() {
  const fileInput = document.getElementById('modal-file-input');
  if (!fileInput.files[0]) { showToast('Please select a file.', 'err'); return; }
  const fd = new FormData();
  fd.append('action', 'upload'); fd.append('project_id', S.project.id);
  fd.append('title', val('up-title')); fd.append('notes', val('up-notes'));
  fd.append('sub_type', val('up-type')); fd.append('milestone_id', val('up-milestone'));
  fd.append('file', fileInput.files[0]);
  const btn = document.querySelector('#modal-upload .btn-amber');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading…';
  const res = await api('php/files.php', fd);
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Submit';
  if (res.success) { closeModal('modal-upload'); showToast('File submitted for review!', 'ok'); await loadSubmissions(); }
  else showToast(res.message, 'err');
}
async function deleteFile(id) {
  if (!confirm('Delete this submission? This cannot be undone.')) return;
  const res = await api('php/files.php', { action: 'delete', id });
  if (res.success) { showToast('File deleted.', 'ok'); await loadSubmissions(); }
  else showToast(res.message, 'err');
}
function setupDropZone() {
  const dz = document.getElementById('drop-zone');
  if (!dz) return;
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); handleDroppedFiles(e.dataTransfer.files); });
}

// ══════════════════════════════════════════════════════════════
// FEEDBACK  (FR 3: supervisor reviews; Significance 3)
// ══════════════════════════════════════════════════════════════
async function loadFeedback() {
  if (!S.project) {
    const p = await api('php/projects.php', { action: 'get_my_projects' }, 'GET');
    S.project = p.projects?.[0] || null;
  }
  if (!S.project) {
    document.getElementById('feedback-list').innerHTML = emptyState('💬', 'No project yet', 'Create your project to see supervisor feedback.');
    return;
  }
  const res = await api('php/files.php', { action: 'get_files', project_id: S.project.id }, 'GET');
  S.files   = res.files || [];

  const counts = { approved:0, revision:0, pending:0 };
  for (const f of S.files) {
    if (f.review_status === 'rejected') continue;
    counts[f.review_status] = (counts[f.review_status]||0) + 1;
  }

  setEl('fb-approved', counts.approved);
  setEl('fb-revision', counts.revision);
  setEl('fb-pending',  counts.pending);

  // Nav badge for revision
  const badge = document.getElementById('badge-feedback');
  if (counts.revision > 0) { badge.textContent = counts.revision; badge.style.display = ''; }
  else badge.style.display = 'none';

  // Revision alert
  const revAlert = document.getElementById('revision-alert');
  if (counts.revision > 0) {
    document.getElementById('revision-alert-body').textContent = `${counts.revision} submission${counts.revision>1?'s require':' requires'} revision. Review the feedback below and resubmit.`;
    revAlert.style.display = '';
  } else revAlert.style.display = 'none';

  const reviewed = S.files.filter(f => f.review_status !== 'pending' && f.review_status !== 'rejected');
  const el = document.getElementById('feedback-list');
  if (!reviewed.length) {
    el.innerHTML = emptyState('📋', 'No feedback yet', 'Your supervisor has not reviewed any submissions yet.');
    return;
  }
  el.innerHTML = reviewed.map(f => `
    <div class="feedback-card" onclick="showFeedbackDetail(${f.id})">
      <div class="feedback-card-top">
        <div class="feedback-card-title">${esc(f.title || f.original_name)}</div>
        <span class="badge ${reviewBadgeClass(f.review_status)}">${fmtReviewStatus(f.review_status)}</span>
      </div>
      <div class="feedback-card-meta">
        <span><i class="fas fa-user-tie" style="opacity:.5;"></i> ${esc(f.reviewer_name || 'Supervisor')}</span>
        <span><i class="fas fa-clock" style="opacity:.5;"></i> ${timeAgo(f.reviewed_at)}</span>
        ${f.grade ? `<span><i class="fas fa-star" style="color:var(--amber);opacity:.8;"></i> ${esc(f.grade)}</span>` : ''}
      </div>
      <div class="feedback-card-preview">${esc(f.feedback || 'No written feedback provided.')}</div>
    </div>`).join('');
}

function showFeedbackDetail(fileId) {
  const f = S.files.find(x => x.id === fileId);
  if (!f) return;
  document.getElementById('feedback-detail-body').innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
        <div style="font-family:var(--ff-display);font-size:17px;font-weight:700;">${esc(f.title || f.original_name)}</div>
        <span class="badge ${reviewBadgeClass(f.review_status)}">${fmtReviewStatus(f.review_status)}</span>
      </div>
      ${f.grade ? `<div style="margin-bottom:10px;"><span class="badge badge-amber"><i class="fas fa-star"></i> Grade: ${esc(f.grade)}</span></div>` : ''}
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;font-size:13px;color:var(--txt2);line-height:1.65;">
        ${esc(f.feedback || 'No written feedback provided.')}
      </div>
      <div style="margin-top:12px;font-size:11px;color:var(--txt3);">
        Reviewed by <strong>${esc(f.reviewer_name || 'Supervisor')}</strong> · ${timeAgo(f.reviewed_at)}
      </div>
    </div>
    <a href="php/files.php?action=download&id=${f.id}" class="btn btn-ghost btn-full btn-sm" download>
      <i class="fas fa-download"></i> Download File
    </a>`;
  openModal('modal-feedback-detail');
}

// ══════════════════════════════════════════════════════════════
// MESSAGES  (FR 5: communication between student & supervisor)
// ══════════════════════════════════════════════════════════════
async function loadMessages() {
  const res = await api('php/messages.php', { action: 'get_contacts' }, 'GET');
  const contacts = res.contacts || [];
  renderContacts(contacts);
  if (contacts.length && !S.chatPartnerId) openChat(contacts[0].id, contacts[0]);
  const unreadRes = await api('php/messages.php', { action: 'unread_count' }, 'GET');
  const badge = document.getElementById('badge-messages');
  if ((unreadRes.count||0) > 0) { badge.textContent = unreadRes.count; badge.style.display = ''; }
  else badge.style.display = 'none';
}

function renderContacts(contacts) {
  const el = document.getElementById('chat-contacts');
  if (!contacts.length) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--txt3);font-size:13px;">Assign a supervisor to your project to start messaging.</div>`;
    return;
  }
  el.innerHTML = contacts.map(c => {
    const initials = c.full_name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    return `
      <div class="chat-contact ${c.id==S.chatPartnerId?'active':''}" onclick='openChat(${c.id}, ${JSON.stringify(c).replace(/"/g,"&quot;")})'>
        <div class="avatar avatar-teal" style="width:36px;height:36px;font-size:13px;flex-shrink:0;">${initials}</div>
        <div class="contact-body">
          <div class="contact-name">${esc(c.full_name)}</div>
          <div class="contact-last">${esc(c.last_message||'No messages yet')}</div>
        </div>
        <div class="contact-right">
          ${c.last_at ? `<span class="contact-time">${timeAgo(c.last_at)}</span>` : ''}
          ${c.unread_count>0 ? `<span class="contact-unread">${c.unread_count}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function openChat(partnerId, contact) {
  S.chatPartnerId = partnerId;
  S.lastMsgId     = 0;
  stopMsgPoll();
  const initials = contact.full_name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('chat-partner-avatar').textContent = initials;
  document.getElementById('chat-partner-name').textContent   = contact.full_name;
  document.getElementById('chat-partner-status').textContent = contact.is_online ? '🟢 Online' : '⚫ Offline';
  document.getElementById('btn-video-call').style.display    = '';
  document.getElementById('chat-input-row').style.display    = '';
  if (S.project && S.project.supervisor_id == partnerId) S.chatProjectId = S.project.id;
  await fetchMessages(partnerId);
  S.pollTimer = setInterval(() => fetchMessages(partnerId, true), 3000);
}

async function fetchMessages(partnerId, poll = false) {
  const data = { action: 'get_thread', user_id: partnerId };
  if (S.chatProjectId) data.project_id = S.chatProjectId;
  if (poll && S.lastMsgId) data.since = S.lastMsgId;
  const res  = await api('php/messages.php', data, 'GET');
  const msgs = res.messages || [];
  if (msgs.length) {
    S.lastMsgId = msgs[msgs.length-1].id;
    poll ? appendMessages(msgs) : renderMessages(msgs);
  } else if (!poll) {
    document.getElementById('chat-messages').innerHTML = `<div class="empty-state" style="margin:auto;"><div class="empty-icon">💬</div><h4>Start the conversation</h4><p>Send a message to your supervisor.</p></div>`;
  }
}

function renderMessages(msgs)  { const el = document.getElementById('chat-messages'); el.innerHTML = msgs.map(msgBubble).join(''); el.scrollTop = el.scrollHeight; }
function appendMessages(msgs)  { const el = document.getElementById('chat-messages'); msgs.forEach(m => el.insertAdjacentHTML('beforeend', msgBubble(m))); el.scrollTop = el.scrollHeight; }
function msgBubble(m) {
  const mine     = m.sender_id == S.user.id;
  const initials = (m.sender_name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  return `
    <div class="msg ${mine?'mine':'theirs'}">
      ${!mine ? `<div class="avatar avatar-teal" style="width:28px;height:28px;font-size:10px;flex-shrink:0;">${initials}</div>` : ''}
      <div>
        <div class="msg-bubble">${esc(m.body)}</div>
        <div class="msg-time">${fmtTime(m.created_at)}</div>
      </div>
    </div>`;
}
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const body  = input.value.trim();
  if (!body || !S.chatPartnerId) return;
  input.value = '';
  const res = await api('php/messages.php', { action:'send', receiver_id:S.chatPartnerId, body, project_id:S.chatProjectId||'' });
  if (res.success) { appendMessages([res.message]); S.lastMsgId = res.message.id; }
  else showToast(res.message, 'err');
}
function chatKeydown(e) { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); sendMessage(); } }
function stopMsgPoll()  { if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer=null; } }

// ══════════════════════════════════════════════════════════════
// MEETINGS  (FR 6: schedule and conduct meetings/video calls)
// ══════════════════════════════════════════════════════════════
async function loadMeetings() {
  const res  = await api('php/meetings.php', { action: 'get_meetings' }, 'GET');
  S.meetings = res.meetings || [];
  const now      = new Date();
  const upcoming = S.meetings.filter(m => new Date(m.scheduled_at) >= now && m.status==='scheduled');
  const past     = S.meetings.filter(m => new Date(m.scheduled_at) <  now || m.status!=='scheduled');

  setEl('upcoming-count', upcoming.length);

  // Badge
  const badge = document.getElementById('badge-meetings');
  if (upcoming.length) { badge.textContent = upcoming.length; badge.style.display=''; }
  else badge.style.display='none';

  const render = (m, isPast) => {
    const typeIcon = {video:'📹',in_person:'🤝',phone:'📞'}[m.meeting_type]||'📅';
    const partner  = m.organizer_id==S.user.id ? m.participant_name : m.organizer_name;
    return `
      <div class="meeting-card">
        <div class="meeting-type-icon ${m.meeting_type}">${typeIcon}</div>
        <div class="meeting-info">
          <div class="meeting-title">${esc(m.title)}</div>
          <div class="meeting-meta">
            <span><i class="fas fa-user-tie" style="opacity:.5;"></i> ${esc(partner||'—')}</span>
            <span><i class="fas fa-calendar" style="opacity:.5;"></i> ${fmtDateTime(m.scheduled_at)}</span>
            <span><i class="fas fa-clock" style="opacity:.5;"></i> ${m.duration_mins} min</span>
            ${m.project_title?`<span><i class="fas fa-folder" style="opacity:.5;"></i> ${esc(m.project_title)}</span>`:''}
          </div>
          ${m.agenda?`<div style="font-size:11px;color:var(--txt3);margin-top:4px;">${esc(m.agenda)}</div>`:''}
        </div>
        <div class="meeting-actions">
          ${m.meeting_type==='video'&&!isPast?`<button class="btn btn-blue btn-sm" onclick="startVideoCall()"><i class="fas fa-video"></i> Join</button>`:''}
          ${!isPast&&m.organizer_id==S.user.id?`<button class="btn btn-sm" style="background:rgba(224,82,82,.15);color:var(--red);border:none;" onclick="cancelMeeting(${m.id})" title="Cancel"><i class="fas fa-times"></i></button>`:''}
        </div>
      </div>`;
  };

  document.getElementById('upcoming-meetings').innerHTML = upcoming.length ? upcoming.map(m=>render(m,false)).join('') : emptyState('📅','No upcoming meetings','Schedule one with your supervisor.');
  document.getElementById('past-meetings').innerHTML     = past.length     ? past.map(m=>render(m,true)).join('')    : emptyState('📋','No past meetings','');
}

function openScheduleMeeting() {
  if (!S.project?.supervisor_id) { showToast('You need a supervisor assigned before scheduling meetings.','err'); return; }
  document.getElementById('mt-title').value=''; document.getElementById('mt-agenda').value='';
  document.getElementById('mt-type').value='video'; document.getElementById('mt-datetime').value='';
  openModal('modal-meeting');
}
async function scheduleMeeting() {
  const title=val('mt-title'), scheduledAt=val('mt-datetime');
  if (!title||!scheduledAt) { showToast('Title and date/time are required.','err'); return; }
  const res = await api('php/meetings.php', {
    action:'schedule', participant_id:S.project.supervisor_id, project_id:S.project.id,
    title, agenda:val('mt-agenda'), meeting_type:val('mt-type'),
    scheduled_at:scheduledAt.replace('T',' ')+':00', duration_mins:val('mt-duration'),
  });
  if (res.success) { closeModal('modal-meeting'); showToast('Meeting scheduled!','ok'); await loadMeetings(); }
  else showToast(res.message,'err');
}
async function cancelMeeting(id) {
  if (!confirm('Cancel this meeting?')) return;
  const res = await api('php/meetings.php', { action:'delete', id });
  if (res.success) { showToast('Meeting cancelled.','ok'); await loadMeetings(); }
  else showToast(res.message,'err');
}

// ══════════════════════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════════════════════
function loadProfile() {
  const u = S.user;
  document.getElementById('pf-name').value  = u.full_name  || '';
  document.getElementById('pf-email').value = u.email      || '';
  document.getElementById('pf-phone').value = u.phone      || '';
  document.getElementById('pf-bio').value   = u.bio        || '';
  const sel = document.getElementById('pf-dept');
  for (const opt of sel.options) if (opt.value===u.department) { opt.selected=true; break; }
  const initials = u.full_name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('profile-avatar-display').textContent = initials;
  document.getElementById('profile-name-display').textContent   = u.full_name;
  document.getElementById('profile-id-display').textContent     = u.student_id||'No Student ID';
  setEl('info-student-id', u.student_id  || '—');
  setEl('info-email',      u.email       || '—');
  setEl('info-dept',       u.department  || '—');
  setEl('info-since',      u.created_at  ? fmtDate(u.created_at.split(' ')[0]) : '—');
}
async function saveProfile(e) {
  e.preventDefault();
  const res = await api('php/auth.php', { action:'update_profile', full_name:val('pf-name'), phone:val('pf-phone'), bio:val('pf-bio'), department:val('pf-dept') });
  if (res.success) { S.user={...S.user,...res.user}; applyUser(); loadProfile(); showToast('Profile saved!','ok'); }
  else showToast(res.message,'err');
}
async function uploadAvatar(input) {
  if (!input.files[0]) return;
  const fd = new FormData(); fd.append('action','update_profile'); fd.append('full_name',S.user.full_name); fd.append('avatar',input.files[0]);
  const res = await api('php/auth.php', fd);
  if (res.success) { S.user={...S.user,...res.user}; showToast('Avatar updated!','ok'); }
  else showToast(res.message,'err');
}
function changePassword(e) {
  e.preventDefault();
  const cur=document.getElementById('pw-current').value, nw=document.getElementById('pw-new').value, cf=document.getElementById('pw-confirm').value;
  if (!cur||!nw)   { showToast('Please fill in all password fields.','err'); return; }
  if (nw.length<8) { showToast('New password must be at least 8 characters.','err'); return; }
  if (nw!==cf)     { showToast('Passwords do not match.','err'); return; }
  showToast('Password change requires a server-side endpoint.','info');
}

// ══════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════════════════════
function startNotifPoll() { fetchNotifs(); S.notifTimer = setInterval(fetchNotifs, 15000); }
async function fetchNotifs() {
  const res = await api('php/notifications.php', { action: 'get' }, 'GET');
  updateNotifBadge(res.unread||0);
  renderNotifList(res.notifications||[]);
}
function updateNotifBadge(count) {
  const badge=document.getElementById('notif-count');
  if (count>0) { badge.textContent=count>9?'9+':count; badge.style.display=''; }
  else badge.style.display='none';
}
function renderNotifList(notifs) {
  const el=document.getElementById('notif-list');
  if (!notifs.length) { el.innerHTML=`<div style="padding:24px;text-align:center;color:var(--txt3);font-size:13px;">No notifications</div>`; return; }
  const icon={submission:'📁',feedback:'💬',meeting:'📅',message:'✉️',milestone:'🏁',project:'📂'};
  el.innerHTML=notifs.slice(0,12).map(n=>`
    <div class="notif-item ${n.is_read?'':'unread'}" onclick="markRead(${n.id})">
      <span class="notif-dot" style="background:${n.is_read?'var(--txt3)':'var(--amber)'};"></span>
      <div class="notif-body">
        <div class="notif-title">${icon[n.type]||'🔔'} ${esc(n.title)}</div>
        <div class="notif-text">${esc(n.body||'')}</div>
        <div class="notif-time">${timeAgo(n.created_at)}</div>
      </div>
    </div>`).join('');
}
async function markRead(id)  { await api('php/notifications.php',{action:'mark_read',id}); fetchNotifs(); }
async function markAllRead() { await api('php/notifications.php',{action:'mark_read'}); fetchNotifs(); document.getElementById('notif-dropdown').classList.remove('open'); }
function toggleNotif()       { document.getElementById('notif-dropdown').classList.toggle('open'); }
document.addEventListener('click', e => {
  const btn=document.getElementById('notif-btn'), drop=document.getElementById('notif-dropdown');
  if (!btn?.contains(e.target)&&!drop?.contains(e.target)) drop?.classList.remove('open');
});

// ══════════════════════════════════════════════════════════════
// ACTIVITY FEED
// ══════════════════════════════════════════════════════════════
function renderActivityFeed(activity) {
  const el=document.getElementById('activity-feed');
  setEl('activity-count', activity.length);
  if (!activity.length) { el.innerHTML=`<div class="activity-item" style="justify-content:center;color:var(--txt3);">No activity yet</div>`; return; }
  const icons={file_uploaded:'📤',feedback_given:'💬',milestone_updated:'✅',project_created:'📂',meeting_scheduled:'📅',message_sent:'✉️'};
  el.innerHTML=activity.map(a=>`
    <div class="activity-item">
      <div class="activity-dot"></div>
      <div class="activity-text"><strong>${icons[a.action]||'•'} ${a.action.replace(/_/g,' ')}</strong>${a.detail?` — ${esc(a.detail)}`:''}</div>
      <span class="activity-time">${timeAgo(a.created_at)}</span>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════════
// VIDEO CALL  (FR 6: video conferencing)
// ══════════════════════════════════════════════════════════════
async function startVideoCall() {
  const overlay=document.getElementById('video-overlay');
  overlay.style.display='flex';
  const partnerName=document.getElementById('chat-partner-name')?.textContent||'Supervisor';
  document.getElementById('vc-title').textContent    = `Call with ${partnerName}`;
  document.getElementById('vc-remote-name').textContent = partnerName;
  document.getElementById('vc-local-name').textContent  = S.user.full_name;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({video:true,audio:true});
    S.callStream = stream;
    const lv = document.getElementById('local-video');
    lv.srcObject=stream; lv.style.display='block';
    document.getElementById('vc-local-placeholder').style.display='none';
    document.getElementById('vc-status-txt').textContent='Connected';
  } catch(e) { document.getElementById('vc-status-txt').textContent='Camera unavailable'; }
  S.callSeconds=0;
  S.callTimer=setInterval(()=>{
    S.callSeconds++;
    const m=String(Math.floor(S.callSeconds/60)).padStart(2,'0'), s=String(S.callSeconds%60).padStart(2,'0');
    document.getElementById('vc-timer').textContent=`${m}:${s}`;
  },1000);
}
function endCall() {
  if (S.callStream) { S.callStream.getTracks().forEach(t=>t.stop()); S.callStream=null; }
  if (S.callTimer)  { clearInterval(S.callTimer); S.callTimer=null; }
  document.getElementById('video-overlay').style.display='none';
  document.getElementById('vc-timer').textContent='00:00';
  document.getElementById('local-video').style.display='none';
  document.getElementById('vc-local-placeholder').style.display='';
}
function toggleMic() {
  S.micOn=!S.micOn;
  if (S.callStream) S.callStream.getAudioTracks().forEach(t=>t.enabled=S.micOn);
  const btn=document.getElementById('btn-mic');
  btn.className=`vc-btn ${S.micOn?'vc-btn-on':'vc-btn-off'}`;
  btn.innerHTML=`<i class="fas fa-microphone${S.micOn?'':'-slash'}"></i>`;
}
function toggleCam() {
  S.camOn=!S.camOn;
  if (S.callStream) S.callStream.getVideoTracks().forEach(t=>t.enabled=S.camOn);
  const btn=document.getElementById('btn-cam');
  btn.className=`vc-btn ${S.camOn?'vc-btn-on':'vc-btn-off'}`;
  btn.innerHTML=`<i class="fas fa-video${S.camOn?'':'-slash'}"></i>`;
}
async function toggleScreen() {
  try {
    const stream=await navigator.mediaDevices.getDisplayMedia({video:true});
    const rv=document.getElementById('remote-video');
    rv.srcObject=stream; rv.style.display='block';
    document.getElementById('vc-remote-placeholder').style.display='none';
    stream.getVideoTracks()[0].onended=()=>{ rv.style.display='none'; document.getElementById('vc-remote-placeholder').style.display=''; };
    showToast('Screen sharing started.','ok');
  } catch(e) { showToast('Screen sharing cancelled.','info'); }
}

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════
async function doLogout() { await api('php/auth.php',{action:'logout'}); window.location.href='index.html'; }

// ══════════════════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════════════════
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', e => { if (e.target.classList.contains('modal-overlay')) document.querySelectorAll('.modal-overlay.open').forEach(m=>m.classList.remove('open')); });
document.addEventListener('keydown', e => { if (e.key==='Escape') document.querySelectorAll('.modal-overlay.open').forEach(m=>m.classList.remove('open')); });

// ══════════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════════
let toastTimer;
function showToast(msg, type='ok') {
  const t=document.getElementById('toast');
  t.textContent=msg; t.className=`show ${type}`;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.className='',3500);
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }

// ══════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════
function val(id)    { return document.getElementById(id)?.value?.trim()||''; }
function setEl(id,txt) { const el=document.getElementById(id); if(el) el.textContent=txt; }
function esc(str)   { const d=document.createElement('div'); d.textContent=str||''; return d.innerHTML; }
function fmtDate(s) { if(!s) return '—'; return new Date(s+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); }
function fmtDateTime(dt) { if(!dt) return '—'; return new Date(dt).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
function fmtTime(dt){ if(!dt) return ''; return new Date(dt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}); }
function daysUntil(s){ return Math.ceil((new Date(s+'T23:59:59')-new Date())/86400000); }
function timeAgo(dt){
  if(!dt) return '';
  const d=(Date.now()-new Date(dt))/1000;
  if(d<60) return 'just now'; if(d<3600) return Math.floor(d/60)+'m ago';
  if(d<86400) return Math.floor(d/3600)+'h ago'; if(d<604800) return Math.floor(d/86400)+'d ago';
  return fmtDate(dt.split(' ')[0]);
}
function fmtStatus(s){ return {pending:'Pending',active:'Active',under_review:'Under Review',completed:'Completed',rejected:'Rejected',in_progress:'In Progress',overdue:'Overdue'}[s]||s; }
function fmtReviewStatus(s){ return {pending:'Pending Review',approved:'Approved',revision:'Needs Revision',rejected:'Rejected'}[s]||s; }
function statusBadgeClass(s){ return {pending:'badge-gray',active:'badge-teal',under_review:'badge-blue',completed:'badge-green',rejected:'badge-red',in_progress:'badge-amber',overdue:'badge-red'}[s]||'badge-gray'; }
function reviewBadgeClass(s){ return {pending:'badge-gray',approved:'badge-green',revision:'badge-amber',rejected:'badge-red'}[s]||'badge-gray'; }
function statusDotClass(s)  { return {completed:'done',in_progress:'prog',pending:'pend',overdue:'over'}[s]||'pend'; }
function fileExt(name)      { return (name||'').split('.').pop().toUpperCase().slice(0,4)||'FILE'; }
function fileExtClass(name) { const e=(name||'').split('.').pop().toLowerCase(); return {pdf:'pdf',doc:'docx',docx:'docx',zip:'zip',rar:'zip',ppt:'pptx',pptx:'pptx'}[e]||'other'; }
function emptyState(icon,title,desc){ return `<div class="empty-state"><div class="empty-icon">${icon}</div><h4>${esc(title)}</h4>${desc?`<p>${esc(desc)}</p>`:''}</div>`; }
