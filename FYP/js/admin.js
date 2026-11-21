/* ============================================================
   admin.js — FYP Nexus Admin Dashboard Controller
   Features:
   - Manage users (students, supervisors, admins)
   - Oversee all projects
   - Assign supervisors to projects
   - View activity logs
   - System settings and configuration
   ============================================================ */

'use strict';

// ── State ────────────────────────────────────────────────────
const S = {
  user:           null,
  users:          [],
  projects:       [],
  activities:     [],
  notifications:  [],
  currentPage:             'overview',
  currentUserId:           null,
  currentProjectId:        null,
  groups:                  [],
  unassignedStudents:      [],
  selectedGroupStudentIds: [],
  groupsPage:              1,
  groupsPerPage:           8,
  pollTimer:               null,
  notifTimer:              null,
};

// ── Bootstrap ────────────────────────────────────────────────
(async function init() {
  try {
    const res = await api('php/auth.php', { action: 'check' }, 'GET');
    if (!res.success) { window.location.href = 'index.html'; return; }
    if (res.user.role !== 'admin') { window.location.href = 'index.html'; return; }
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
  overview:     'Overview',
  analytics:    'Analytics',
  users:        'User Management',
  projects:     'All Projects',
  groups:       'Group Management',
  assignments:  'Assignments',
  activity:     'Activity Log',
  settings:     'Settings',
};

async function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  document.getElementById('breadcrumb-label').textContent = PAGE_LABELS[page] || page;
  S.currentPage = page;

  switch (page) {
    case 'overview':     await loadOverview();     break;
    case 'analytics':    await loadAnalytics();    break;
    case 'users':        await loadUsers();        break;
    case 'projects':     await loadProjects();     break;
    case 'groups':       await loadGroups();       break;
    case 'assignments':  await loadAssignments();  break;
    case 'activity':     await loadActivity();     break;
    case 'settings':     loadSettings();           break;
  }
}

// ── Apply User ───────────────────────────────────────────────
function applyUser() {
  const initials = (S.user.full_name || 'A').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('topbar-name').textContent   = S.user.full_name || 'Administrator';
  document.getElementById('topbar-avatar').textContent = initials;
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('greeting').textContent = `${greet}, Admin 👋`;
}

// ══════════════════════════════════════════════════════════════
// OVERVIEW
// ══════════════════════════════════════════════════════════════
async function loadOverview() {
  try {
    const [usersRes, projRes, notifRes] = await Promise.all([
      api('php/users.php', { action: 'get_all' }, 'GET'),
      api('php/projects.php', { action: 'get_all' }, 'GET'),
      api('php/notifications.php', { action: 'get' }, 'GET'),
    ]);

    S.users = usersRes.users || [];
    S.projects = projRes.projects || [];
    loadGroupsFromStorage();

    // Count stats
    const totalStudents = S.users.filter(u => u.role === 'student').length;
    const totalSupervisors = S.users.filter(u => u.role === 'supervisor').length;
    const totalGroups = S.groups.length;
    const unassignedStudents = S.unassignedStudents.length;
    const groupsWithoutSupervisor = S.groups.filter(g => !g.supervisor_id).length;
    const activeProjects = S.projects.filter(p => p.status === 'active').length;
    const unreadNotif = (notifRes.unread || 0);

    setEl('stat-students', totalStudents);
    setEl('stat-supervisors', totalSupervisors);
    setEl('stat-groups', totalGroups);
    setEl('stat-unassigned-students', unassignedStudents);
    setEl('stat-groups-no-supervisor', groupsWithoutSupervisor);
    setEl('stat-active-projects', activeProjects);

    // Recent users list
    const recentUsers = S.users.slice(0, 5);
    renderOverviewUsers(recentUsers);

    // Unassigned projects
    const unassigned = S.projects.filter(p => !p.supervisor_id).slice(0, 5);
    renderOverviewUnassigned(unassigned);

    // Project status distribution
    renderStatusDistribution();

    updateNotifBadge(unreadNotif);
  } catch (e) {
    console.error('Error loading overview:', e);
  }
}

function renderOverviewUsers(users) {
  const el = document.getElementById('overview-users-list');
  if (!users.length) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--txt3);font-size:13px;">No users yet.</div>`;
    return;
  }
  el.innerHTML = users.map(u => `
    <div class="user-row" style="padding:12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;cursor:pointer;" onclick="navigate('users')">
      <div class="avatar" style="background:var(--${u.role === 'student' ? 'teal' : u.role === 'supervisor' ? 'blue' : 'amber'});width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:600;flex-shrink:0;">${(u.full_name || 'U').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()}</div>
      <div style="flex:1;">
        <div style="font-weight:600;font-size:13px;">${esc(u.full_name)}</div>
        <div style="font-size:11px;color:var(--txt3);">${esc(u.role)}</div>
      </div>
      <span class="badge" style="background:${u.status === 'active' ? 'var(--green)' : 'var(--red)'};color:white;padding:4px 8px;border-radius:4px;font-size:11px;">${u.status || 'active'}</span>
    </div>`).join('');
}

function renderOverviewUnassigned(projects) {
  const el = document.getElementById('overview-unassigned-list');
  if (!projects.length) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--txt3);font-size:13px;">All projects are assigned.</div>`;
    return;
  }
  el.innerHTML = projects.map(p => `
    <div style="padding:12px;border-bottom:1px solid var(--border);cursor:pointer;" onclick="navigate('assignments')">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${esc(p.title)}</div>
      <div style="font-size:11px;color:var(--txt3);">${esc(p.student_name || 'Unknown')} • ${fmtDate(p.created_at)}</div>
    </div>`).join('');
}

function renderStatusDistribution() {
  const statusMap = {
    pending: 0,
    active: 0,
    under_review: 0,
    completed: 0,
    rejected: 0,
  };
  S.projects.forEach(p => {
    const st = p.status || 'pending';
    if (statusMap.hasOwnProperty(st)) statusMap[st]++;
  });
  
  const el = document.getElementById('status-chart-bars');
  const total = S.projects.length || 1;
  el.innerHTML = Object.entries(statusMap).map(([status, count]) => {
    const pct = Math.round((count / total) * 100);
    return `
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="min-width:100px;font-size:13px;font-weight:500;text-transform:capitalize;">${fmtStatus(status)}</div>
        <div style="flex:1;height:20px;background:var(--border);border-radius:4px;overflow:hidden;">
          <div style="height:100%;background:${getStatusColor(status)};width:${pct}%;"></div>
        </div>
        <div style="min-width:60px;text-align:right;font-size:12px;color:var(--txt3);">${count} (${pct}%)</div>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// ANALYTICS
// ══════════════════════════════════════════════════════════════
async function loadAnalytics() {
  try {
    const [usersRes, projRes, subRes] = await Promise.all([
      api('php/users.php', { action: 'get_all' }, 'GET'),
      api('php/projects.php', { action: 'get_all' }, 'GET'),
      api('php/submissions.php', { action: 'get_all' }, 'GET'),
    ]);

    const users = usersRes.users || [];
    const projects = projRes.projects || [];
    const submissions = subRes.submissions || [];

    // Submissions per day
    renderSubmissionsChart(submissions);

    // Department breakdown
    const deptMap = {};
    users.filter(u => u.role === 'student').forEach(u => {
      const d = u.department || 'Other';
      deptMap[d] = (deptMap[d] || 0) + 1;
    });
    renderDepartmentBreakdown(deptMap);

    // Supervisor workload
    const supMap = {};
    projects.forEach(p => {
      const sup = p.supervisor_name || 'Unassigned';
      supMap[sup] = (supMap[sup] || 0) + 1;
    });
    renderSupervisorWorkload(supMap);

    // Project progress
    const progressRanges = { '0-25': 0, '25-50': 0, '50-75': 0, '75-100': 0 };
    projects.forEach(p => {
      const progress = p.progress || 0;
      if (progress <= 25) progressRanges['0-25']++;
      else if (progress <= 50) progressRanges['25-50']++;
      else if (progress <= 75) progressRanges['50-75']++;
      else progressRanges['75-100']++;
    });
    renderProgressDistribution(progressRanges);
  } catch (e) {
    console.error('Error loading analytics:', e);
  }
}

function renderSubmissionsChart(submissions) {
  const el = document.getElementById('analytics-submissions');
  const dateMap = {};
  submissions.forEach(s => {
    const d = s.submitted_at ? s.submitted_at.split(' ')[0] : '';
    if (d) dateMap[d] = (dateMap[d] || 0) + 1;
  });
  const sorted = Object.entries(dateMap).sort().slice(-7);
  el.innerHTML = sorted.map(([date, count]) => `
    <div style="display:flex;align-items:center;gap:12px;padding:8px 0;">
      <div style="min-width:80px;font-size:12px;color:var(--txt3);">${fmtDate(date)}</div>
      <div style="flex:1;height:24px;background:var(--border);border-radius:4px;overflow:hidden;">
        <div style="height:100%;background:var(--teal);width:${Math.min(100, count * 20)}%;"></div>
      </div>
      <div style="min-width:30px;text-align:right;font-size:12px;font-weight:500;">${count}</div>
    </div>`).join('');
}

function renderDepartmentBreakdown(deptMap) {
  const el = document.getElementById('analytics-departments');
  const total = Object.values(deptMap).reduce((a, b) => a + b, 0) || 1;
  el.innerHTML = Object.entries(deptMap).map(([dept, count]) => {
    const pct = Math.round((count / total) * 100);
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:8px 0;">
        <div style="min-width:120px;font-size:12px;font-weight:500;">${esc(dept)}</div>
        <div style="flex:1;height:20px;background:var(--border);border-radius:4px;overflow:hidden;">
          <div style="height:100%;background:var(--blue);width:${pct}%;"></div>
        </div>
        <div style="min-width:50px;text-align:right;font-size:12px;color:var(--txt3);">${count}</div>
      </div>`;
  }).join('');
}

function renderSupervisorWorkload(supMap) {
  const el = document.getElementById('analytics-supervisors');
  const sorted = Object.entries(supMap).sort((a, b) => b[1] - a[1]);
  el.innerHTML = sorted.map(([name, count]) => `
    <div style="display:flex;align-items:center;gap:12px;padding:8px 0;">
      <div style="min-width:120px;font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;">${esc(name)}</div>
      <div style="flex:1;height:20px;background:var(--border);border-radius:4px;overflow:hidden;">
        <div style="height:100%;background:var(--amber);width:${Math.min(100, count * 10)}%;"></div>
      </div>
      <div style="min-width:50px;text-align:right;font-size:12px;color:var(--txt3);">${count} projects</div>
    </div>`).join('');
}

function renderProgressDistribution(progressRanges) {
  const el = document.getElementById('analytics-progress');
  const total = Object.values(progressRanges).reduce((a, b) => a + b, 0) || 1;
  el.innerHTML = Object.entries(progressRanges).map(([range, count]) => {
    const pct = Math.round((count / total) * 100);
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:8px 0;">
        <div style="min-width:80px;font-size:12px;font-weight:500;">${range}%</div>
        <div style="flex:1;height:20px;background:var(--border);border-radius:4px;overflow:hidden;">
          <div style="height:100%;background:${['var(--red)', 'var(--amber)', 'var(--blue)', 'var(--green)'][Object.keys(progressRanges).indexOf(range)]};width:${pct}%;"></div>
        </div>
        <div style="min-width:50px;text-align:right;font-size:12px;color:var(--txt3);">${count}</div>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════════
async function loadUsers() {
  try {
    const res = await api('php/users.php', { action: 'get_all' }, 'GET');
    S.users = res.users || [];
    renderUsersTable(S.users);
  } catch (e) {
    console.error('Error loading users:', e);
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-tbody');
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:40px;text-align:center;color:var(--txt3);">No users found.</td></tr>`;
    return;
  }
  tbody.innerHTML = users.map(u => `
    <tr onclick="viewUserDetail(${u.id})" style="cursor:pointer;">
      <td><strong>${esc(u.full_name)}</strong></td>
      <td><span class="badge" style="background:${u.role === 'student' ? 'var(--teal)' : u.role === 'supervisor' ? 'var(--blue)' : 'var(--amber)'};color:white;text-transform:capitalize;">${u.role}</span></td>
      <td>${esc(u.department || '—')}</td>
      <td>${esc(u.student_id || '—')}</td>
      <td>${fmtDate(u.created_at)}</td>
      <td><span class="badge" style="background:${u.status === 'active' ? 'var(--green)' : 'var(--red)'};color:white;text-transform:capitalize;">${u.status || 'active'}</span></td>
      <td>
        <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation(); editUser(${u.id});" title="Edit">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation(); deleteUser(${u.id});" title="Delete">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>`).join('');
}

function filterUsers(search) {
  const term = (search || document.getElementById('users-search')?.value || '').toLowerCase();
  const role = document.getElementById('users-role-filter')?.value || 'all';
  const filtered = S.users.filter(u => {
    const matchesSearch = !term || (u.full_name || '').toLowerCase().includes(term) || (u.student_id || '').toLowerCase().includes(term) || (u.email || '').toLowerCase().includes(term);
    const matchesRole = role === 'all' || u.role === role;
    return matchesSearch && matchesRole;
  });
  renderUsersTable(filtered);
}

function editUser(userId) {
  const user = S.users.find(u => u.id === userId);
  if (!user) return;
  S.currentUserId = userId;
  document.getElementById('form-user-name').value = user.full_name || '';
  document.getElementById('form-user-email').value = user.email || '';
  document.getElementById('form-user-role').value = user.role || 'student';
  document.getElementById('form-user-dept').value = user.department || '';
  document.getElementById('form-user-sid').value = user.student_id || '';
  openModal('modal-add-user');
}

function viewUserDetail(userId) {
  editUser(userId);
}

async function saveUser() {
  const name = document.getElementById('form-user-name').value.trim();
  const email = document.getElementById('form-user-email').value.trim();
  const role = document.getElementById('form-user-role').value;
  const dept = document.getElementById('form-user-dept').value.trim();
  const sid = document.getElementById('form-user-sid').value.trim();

  if (!name || !email || !role) {
    showToast('Please fill in all required fields.', 'err');
    return;
  }

  const res = await api('php/users.php', {
    action: S.currentUserId ? 'update' : 'create',
    id: S.currentUserId,
    full_name: name,
    email: email,
    role: role,
    department: dept,
    student_id: sid,
  });

  if (res.success) {
    closeModal('modal-add-user');
    showToast(`User ${S.currentUserId ? 'updated' : 'created'}!`, 'ok');
    S.currentUserId = null;
    await loadUsers();
  } else {
    showToast(res.message || 'Error saving user.', 'err');
  }
}

async function deleteUser(userId) {
  if (!confirm('Delete this user? This action cannot be undone.')) return;
  const res = await api('php/users.php', { action: 'delete', id: userId });
  if (res.success) {
    showToast('User deleted.', 'ok');
    await loadUsers();
  } else {
    showToast(res.message || 'Error deleting user.', 'err');
  }
}

// ══════════════════════════════════════════════════════════════
// PROJECTS
// ══════════════════════════════════════════════════════════════
async function loadProjects() {
  try {
    const res = await api('php/projects.php', { action: 'get_all' }, 'GET');
    S.projects = res.projects || [];
    renderProjectsTable(S.projects);
  } catch (e) {
    console.error('Error loading projects:', e);
  }
}

function renderProjectsTable(projects) {
  const tbody = document.getElementById('projects-tbody');
  if (!tbody) return;
  if (!projects.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:40px;text-align:center;color:var(--txt3);">No projects found.</td></tr>`;
    return;
  }
  tbody.innerHTML = projects.map(p => `
    <tr onclick="viewProjectDetail(${p.id})" style="cursor:pointer;">
      <td><strong>${esc(p.title)}</strong></td>
      <td>${esc(p.student_name || '—')}</td>
      <td>${esc(p.supervisor_name || 'Unassigned')}</td>
      <td><span class="badge" style="background:${getStatusColor(p.status)};color:white;text-transform:capitalize;">${fmtStatus(p.status)}</span></td>
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden;width:100px;">
            <div style="height:100%;background:var(--teal);width:${p.progress || 0}%;"></div>
          </div>
          <span style="font-size:11px;color:var(--txt3);">${p.progress || 0}%</span>
        </div>
      </td>
      <td>${fmtDate(p.deadline)}</td>
      <td>
        <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation(); editProject(${p.id});" title="Edit">
          <i class="fas fa-edit"></i>
        </button>
      </td>
    </tr>`).join('');
}

async function loadGroups() {
  try {
    const res = await api('php/users.php', { action: 'get_all' }, 'GET');
    S.users = res.users || S.users || [];
  } catch (e) {
    showToast('Group manager loaded with local data.', 'info');
  }

  loadGroupsFromStorage();
  renderUnassignedStudents();
  renderGroupsTable();
}

function loadGroupsFromStorage() {
  const raw = localStorage.getItem('fyp_groups');
  try {
    S.groups = raw ? JSON.parse(raw) : [];
  } catch (err) {
    S.groups = [];
  }
  const assignedIds = new Set(S.groups.flatMap(g => g.members || []));
  S.unassignedStudents = (S.users || []).filter(u => u.role === 'student' && !assignedIds.has(u.id));
  updateGroupCounts();
  updateGroupAccessCode();
}

function saveGroupsToStorage() {
  localStorage.setItem('fyp_groups', JSON.stringify(S.groups));
}

function updateGroupCounts() {
  setEl('unassigned-students-count', S.unassignedStudents.length);
  setEl('group-count-badge', S.groups.length);
}

function updateGroupAccessCode() {
  const codeEl = document.getElementById('group-access-code');
  const nameEl = document.getElementById('group-name-input');
  const nextCode = nextGroupCode();
  if (codeEl) codeEl.value = nextCode;
  if (nameEl && !nameEl.value.trim()) {
    const groupCount = (S.groups || []).length + 1;
    nameEl.value = `Project Group ${String(groupCount).padStart(2, '0')}`;
  }
}

function renderUnassignedStudents() {
  const wrap = document.getElementById('unassigned-students-wrap');
  if (!wrap) return;
  if (!S.unassignedStudents.length) {
    wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--txt3);">No unassigned students available.</div>`;
    return;
  }
  const search = (document.getElementById('student-search')?.value || '').toLowerCase();
  const selected = new Set(S.selectedGroupStudentIds);
  const students = S.unassignedStudents.filter(student => {
    return !search || (
      (student.full_name || '').toLowerCase().includes(search) ||
      (student.student_id || '').toLowerCase().includes(search) ||
      (student.department || '').toLowerCase().includes(search)
    );
  });
  if (!students.length) {
    wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--txt3);">No unassigned students match your search.</div>`;
    return;
  }
  wrap.innerHTML = students.map(student => `
    <div class="unassigned-proj-item ${selected.has(student.id) ? 'selected' : ''}" onclick="toggleStudentSelection(${student.id})">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <div>
          <div class="unassigned-proj-title">${esc(student.full_name)} (${esc(student.student_id || '—')})</div>
          <div class="unassigned-proj-student">${esc(student.department || 'Student')}</div>
        </div>
        <span class="badge" style="background:${selected.has(student.id) ? 'var(--blue)' : 'var(--bg3)'};color:${selected.has(student.id) ? 'white' : 'var(--txt3)'};">${selected.has(student.id) ? 'Selected' : 'Pick'}</span>
      </div>
    </div>`).join('');
  updateGroupSelectionHint();
}

function toggleStudentSelection(studentId) {
  const groupSize = Number(document.getElementById('group-size-select')?.value || 0);
  if (!groupSize) {
    showToast('Please select a group size first.', 'err');
    return;
  }
  const index = S.selectedGroupStudentIds.indexOf(studentId);
  if (index >= 0) {
    S.selectedGroupStudentIds.splice(index, 1);
  } else {
    if (S.selectedGroupStudentIds.length >= groupSize) {
      showToast(`You can only select ${groupSize} students for this group.`, 'err');
      return;
    }
    S.selectedGroupStudentIds.push(studentId);
  }
  renderUnassignedStudents();
  validateGroupSelection();
}

function validateGroupSelection() {
  const groupSize = Number(document.getElementById('group-size-select')?.value || 0);
  const selectedCount = S.selectedGroupStudentIds.length;
  const message = document.getElementById('group-validation-msg');
  const createBtn = document.getElementById('btn-create-group');
  if (!groupSize) {
    if (message) message.textContent = 'Select a group size to begin.';
    if (createBtn) createBtn.disabled = true;
    return;
  }
  if (selectedCount === 0) {
    if (message) message.textContent = `Select exactly ${groupSize} students.`;
    if (createBtn) createBtn.disabled = true;
    return;
  }
  if (selectedCount !== groupSize) {
    if (message) message.textContent = `You have selected ${selectedCount} of ${groupSize} students.`;
    if (createBtn) createBtn.disabled = true;
    return;
  }
  if (message) message.textContent = '';
  if (createBtn) createBtn.disabled = false;
}

function updateGroupSelectionHint() {
  const hint = document.getElementById('group-selection-hint');
  const groupSize = Number(document.getElementById('group-size-select')?.value || 0);
  const count = S.selectedGroupStudentIds.length;
  if (!hint) return;
  if (!groupSize) {
    hint.textContent = 'Pick a group size to start selecting students.';
    return;
  }
  hint.textContent = `Selected ${count} of ${groupSize} students.`;
}

function resetGroupSelection() {
  S.selectedGroupStudentIds = [];
  document.getElementById('group-validation-msg').textContent = '';
  document.getElementById('btn-create-group').disabled = true;
  renderUnassignedStudents();
  updateGroupAccessCode();
}

function nextGroupCode() {
  const next = S.groups.reduce((max, g) => {
    const num = parseInt((g.id || '').replace(/[^0-9]/g, ''), 10) || 0;
    return Math.max(max, num);
  }, 0) + 1;
  return `G${String(next).padStart(3, '0')}`;
}

function createGroup() {
  const groupSize = Number(document.getElementById('group-size-select')?.value || 0);
  const groupName = (document.getElementById('group-name-input')?.value || '').trim();
  const groupCode = (document.getElementById('group-access-code')?.value || '').trim() || nextGroupCode();
  const selected = S.selectedGroupStudentIds;
  if (!groupSize || selected.length !== groupSize) {
    showToast(`Please select exactly ${groupSize} students.`, 'err');
    return;
  }
  const group = {
    id: groupCode,
    code: groupCode,
    name: groupName || `Project Group ${String((S.groups || []).length + 1).padStart(2, '0')}`,
    size: groupSize,
    members: [...selected],
    supervisor_id: '',
    project_title: '',
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  S.groups.push(group);
  saveGroupsToStorage();
  S.selectedGroupStudentIds = [];
  loadGroupsFromStorage();
  renderUnassignedStudents();
  renderGroupsTable();
  document.getElementById('group-name-input').value = '';
  updateGroupAccessCode();
  // Open assign supervisor modal immediately so admin can attach a supervisor
  openGroupAssignModal(group.id);
  showToast(`Group ${group.code || group.id} created. Assign a supervisor next.`, 'info');
}

function autoGenerateGroups() {
  const size = Number(document.getElementById('group-size-select')?.value || 0);
  if (!size) {
    showToast('Choose a group size before auto-generating groups.', 'err');
    return;
  }
  if (S.unassignedStudents.length < size) {
    showToast('Not enough unassigned students to generate a group.', 'err');
    return;
  }
  const students = [...S.unassignedStudents];
  let groupCount = 0;
  while (students.length >= size) {
    const members = students.splice(0, size).map(s => s.id);
    S.groups.push({
      id: nextGroupCode(),
      size,
      members,
      supervisor_id: '',
      project_title: '',
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    groupCount += 1;
  }
  saveGroupsToStorage();
  loadGroupsFromStorage();
  renderUnassignedStudents();
  renderGroupsTable();
  const remainder = students.length;
  if (remainder) {
    showToast(`Created ${groupCount} groups. ${remainder} student${remainder === 1 ? '' : 's'} remain unassigned.`, 'info');
  } else {
    showToast(`Created ${groupCount} groups successfully.`, 'ok');
  }
}

function renderGroupsTable() {
  const tbody = document.getElementById('groups-tbody');
  const pagination = document.getElementById('groups-pagination');
  if (!tbody) return;
  const search = document.getElementById('groups-search')?.value?.toLowerCase() || '';
  const status = document.getElementById('group-status-filter')?.value || 'all';
  let filtered = S.groups || [];
  if (status !== 'all') {
    filtered = filtered.filter(g => getGroupStatus(g) === status);
  }
  if (search) {
    filtered = filtered.filter(g => {
      const memberNames = getGroupMemberNames(g).toLowerCase();
      return g.id.toLowerCase().includes(search) || memberNames.includes(search) || (g.project_title || '').toLowerCase().includes(search);
    });
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / S.groupsPerPage));
  S.groupsPage = Math.min(S.groupsPage, totalPages);
  const start = (S.groupsPage - 1) * S.groupsPerPage;
  const pageItems = filtered.slice(start, start + S.groupsPerPage);
  if (!pageItems.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:40px;text-align:center;color:var(--txt3);">No groups match your filters.</td></tr>`;
  } else {
    tbody.innerHTML = pageItems.map(g => `
      <tr>
        <td><strong>${esc(g.id)}</strong></td>
        <td>${(g.members || []).length}</td>
        <td>${esc(getGroupMemberNames(g))}</td>
        <td>${esc(getSupervisorNameById(g.supervisor_id) || 'Unassigned')}</td>
        <td>${esc(g.project_title || 'Unassigned')}</td>
        <td><span class="badge" style="background:${getStatusColor(getGroupStatus(g))};color:white;text-transform:capitalize;">${fmtStatus(getGroupStatus(g))}</span></td>
        <td style="white-space:nowrap;">
          <button class="btn btn-ghost btn-xs" onclick="viewGroup('${g.id}')" title="View Group"><i class="fas fa-eye"></i></button>
          <button class="btn btn-ghost btn-xs" onclick="editGroupMembers('${g.id}')" title="Edit Members"><i class="fas fa-users"></i></button>
          <button class="btn btn-ghost btn-xs" onclick="openGroupAssignModal('${g.id}')" title="Assign Supervisor"><i class="fas fa-user-tie"></i></button>
          <button class="btn btn-ghost btn-xs" onclick="deleteGroup('${g.id}')" title="Delete Group"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`).join('');
  }
  if (pagination) {
    pagination.innerHTML = Array.from({ length: totalPages }, (_, index) => `
      <button class="btn btn-ghost btn-xs" onclick="changeGroupsPage(${index + 1})" style="${S.groupsPage === index + 1 ? 'font-weight:700;color:var(--txt);' : ''}">${index + 1}</button>`
    ).join('');
  }
}

function changeGroupsPage(page) {
  S.groupsPage = page;
  renderGroupsTable();
}

function viewGroup(groupId) {
  const group = S.groups.find(g => g.id === groupId);
  if (!group) return;
  const body = document.getElementById('group-detail-body');
  if (!body) return;
  body.innerHTML = `
    <div style="display:grid;gap:14px;">
      <div><strong>Group ID:</strong> ${esc(group.id)}</div>
      <div><strong>Members:</strong><br>${getGroupMemberNames(group)}</div>
      <div><strong>Supervisor:</strong> ${esc(getSupervisorNameById(group.supervisor_id) || 'Unassigned')}</div>
      <div><strong>Project Title:</strong> ${esc(group.project_title || 'Unassigned')}</div>
      <div><strong>Status:</strong> ${fmtStatus(getGroupStatus(group))}</div>
      <div><strong>Created:</strong> ${fmtDateTime(group.created_at)}</div>
      <div style="display:grid;gap:8px;">
        <button class="btn btn-admin" onclick="editGroupMembers('${group.id}')"><i class="fas fa-users"></i> Edit Members</button>
        <button class="btn btn-ghost" onclick="openGroupAssignModal('${group.id}')"><i class="fas fa-user-tie"></i> Assign Supervisor</button>
      </div>
    </div>`;
  openModal('modal-group-detail');
}

function editGroupMembers(groupId) {
  const group = S.groups.find(g => g.id === groupId);
  if (!group) return;
  S.editingGroup = { ...group, buffer: [...group.members] };
  const body = document.getElementById('group-edit-body');
  if (!body) return;
  const available = S.unassignedStudents;
  body.innerHTML = `
    <div style="display:grid;gap:14px;">
      <div><strong>Group ID:</strong> ${esc(group.id)}</div>
      <div><strong>Required members:</strong> ${group.members.length}</div>
      <div><strong>Current members (${group.members.length}):</strong></div>
      <div>${group.members.map(id => `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);"><span>${esc(getStudentNameById(id) || 'Unknown')}</span><button class="btn btn-ghost btn-xs" onclick="removeGroupMember('${group.id}', ${id})">Remove</button></div>`).join('')}</div>
      <div><strong>Available students</strong></div>
      ${available.length ? available.map(s => `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);"><span>${esc(s.full_name)}</span><button class="btn btn-ghost btn-xs" onclick="addGroupMember('${group.id}', ${s.id})">Add</button></div>`).join('') : '<div style="color:var(--txt3);">No available students to add.</div>'}
    </div>`;
  openModal('modal-edit-group');
}

function removeGroupMember(groupId, studentId) {
  const group = S.groups.find(g => g.id === groupId);
  if (!group) return;
  const idx = group.members.indexOf(studentId);
  if (idx >= 0) {
    group.members.splice(idx, 1);
    saveGroupsToStorage();
    loadGroupsFromStorage();
    editGroupMembers(groupId);
  }
}

function addGroupMember(groupId, studentId) {
  const group = S.groups.find(g => g.id === groupId);
  if (!group) return;
  const maxSize = group.size || group.members.length;
  if (group.members.length >= maxSize) {
    showToast('Group is already at its configured size.', 'err');
    return;
  }
  if (group.members.includes(studentId)) return;
  group.members.push(studentId);
  saveGroupsToStorage();
  loadGroupsFromStorage();
  editGroupMembers(groupId);
}

function openGroupAssignModal(groupId) {
  const group = S.groups.find(g => g.id === groupId);
  if (!group) return;
  S.currentGroupId = groupId;
  const select = document.getElementById('assign-group-supervisor-select');
  if (!select) return;
  const info = document.getElementById('assign-group-supervisor-info');
  api('php/users.php', { action: 'get_by_role', role: 'supervisor' }, 'GET').then(res => {
    const supervisors = (res.users || []).length ? res.users : (S.users || []).filter(u => u.role === 'supervisor');
    const options = (supervisors || []).map(s => {
      const staffId = s.staff_id || s.staff_number || s.employee_id || s.student_id || s.id;
      const dept = s.department || '';
      return `<option value="${s.id}" data-staff="${esc(staffId)}" data-dept="${esc(dept)}">${esc(s.full_name)} — ${esc(staffId)}${dept ? ' • ' + esc(dept) : ''}</option>`;
    }).join('');
    select.innerHTML = `<option value="">Choose supervisor…</option>${options}`;
    select.value = group.supervisor_id || '';
    // display current supervisor details
    const cur = (supervisors || []).find(s => s.id == group.supervisor_id);
    if (info) info.innerHTML = cur ? `<strong>${esc(cur.full_name)}</strong><br/>Staff ID: ${esc(cur.staff_id||cur.staff_number||cur.employee_id||cur.student_id||cur.id)}<br/>${esc(cur.department||'')}` : 'No supervisor assigned.';
    select.onchange = () => {
      const opt = select.selectedOptions[0];
      if (!opt) return;
      const staff = opt.dataset.staff || '';
      const dept = opt.dataset.dept || '';
      const label = opt.text.split(' — ')[0] || opt.text;
      if (info) info.innerHTML = `<strong>${esc(label)}</strong><br/>Staff ID: ${esc(staff)}<br/>${esc(dept)}`;
    };
  }).catch(() => {
    select.innerHTML = `<option value="">No supervisors available</option>`;
    if (info) info.innerHTML = 'No supervisors available.';
  });
  openModal('modal-assign-group');
}

async function confirmAssignGroup() {
  if (!S.currentGroupId) return;
  const supervisorId = document.getElementById('assign-group-supervisor-select')?.value;
  if (!supervisorId) {
    showToast('Select a supervisor first.', 'err');
    return;
  }
  const group = S.groups.find(g => g.id === S.currentGroupId);
  if (!group) return;
  group.supervisor_id = supervisorId;
  group.status = 'active';
  saveGroupsToStorage();
  renderGroupsTable();
  closeModal('modal-assign-group');
  showToast('Supervisor assigned to group.', 'ok');
}

function deleteGroup(groupId) {
  if (!confirm('Delete this group? This will return all students to unassigned status.')) return;
  S.groups = S.groups.filter(g => g.id !== groupId);
  saveGroupsToStorage();
  loadGroupsFromStorage();
  renderUnassignedStudents();
  renderGroupsTable();
  showToast(`Group ${groupId} deleted.`, 'ok');
}

function getGroupStatus(group) {
  if (group.status) return group.status;
  if (group.supervisor_id) return 'active';
  return 'pending';
}

function getStudentNameById(id) {
  const user = (S.users || []).find(u => u.id === id);
  return user ? user.full_name : '';
}

function getSupervisorNameById(id) {
  const user = (S.users || []).find(u => u.id === id);
  return user ? user.full_name : '';
}

function getGroupMemberNames(group) {
  return (group.members || []).map(getStudentNameById).filter(Boolean).join(', ');
}

function getStudentIndex(id) {
  const user = (S.users || []).find(u => u.id === id);
  return user ? user.student_id : '';
}

function filterProjects(search) {
  const term = (search || document.getElementById('proj-search')?.value || '').toLowerCase();
  const status = document.getElementById('proj-status-filter')?.value || 'all';
  const filtered = S.projects.filter(p => {
    const matchesSearch = !term || (p.title || '').toLowerCase().includes(term) || (p.student_name || '').toLowerCase().includes(term);
    const matchesStatus = status === 'all' || p.status === status;
    return matchesSearch && matchesStatus;
  });
  renderProjectsTable(filtered);
}

function viewProjectDetail(projectId) {
  editProject(projectId);
}

function editProject(projectId) {
  const project = S.projects.find(p => p.id === projectId);
  if (!project) return;
  S.currentProjectId = projectId;
  if (document.getElementById('form-proj-title')) {
    document.getElementById('form-proj-title').value = project.title || '';
    document.getElementById('form-proj-student').value = project.student_id || '';
    document.getElementById('form-proj-supervisor').value = project.supervisor_id || '';
    document.getElementById('form-proj-status').value = project.status || 'pending';
    document.getElementById('form-proj-progress').value = project.progress || 0;
  }
  openModal('modal-edit-project');
}

async function saveProject() {
  if (!S.currentProjectId) return;
  const res = await api('php/projects.php', {
    action: 'update',
    id: S.currentProjectId,
    supervisor_id: document.getElementById('form-proj-supervisor').value,
    status: document.getElementById('form-proj-status').value,
    progress: document.getElementById('form-proj-progress').value,
  });

  if (res.success) {
    closeModal('modal-edit-project');
    showToast('Project updated!', 'ok');
    S.currentProjectId = null;
    await loadProjects();
  } else {
    showToast(res.message || 'Error updating project.', 'err');
  }
}

// ══════════════════════════════════════════════════════════════
// ASSIGNMENTS
// ══════════════════════════════════════════════════════════════
async function loadAssignments() {
  try {
    const [projRes, supRes] = await Promise.all([
      api('php/projects.php', { action: 'get_all' }, 'GET'),
      api('php/users.php', { action: 'get_by_role', role: 'supervisor' }, 'GET'),
    ]);
    
    S.projects = projRes.projects || [];
    const supervisors = supRes.users || [];
    
    const unassigned = S.projects.filter(p => !p.supervisor_id);
    renderUnassignedProjects(unassigned);
    
    const supervisorOptions = supervisors.map(s => `<option value="${s.id}">${esc(s.full_name)}</option>`).join('');
    document.getElementById('assign-supervisor').innerHTML = `<option value="">Select supervisor...</option>${supervisorOptions}`;
  } catch (e) {
    console.error('Error loading assignments:', e);
  }
}

function renderUnassignedProjects(projects) {
  const el = document.getElementById('assign-projects-list') || document.createElement('div');
  if (!projects.length) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--txt3);">All projects are assigned!</div>`;
    return;
  }
  el.innerHTML = projects.map(p => `
    <div style="padding:16px;border:1px solid var(--border);border-radius:8px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
      <div style="flex:1;">
        <h4 style="margin:0 0 4px 0;">${esc(p.title)}</h4>
        <p style="margin:0;font-size:12px;color:var(--txt3);">${esc(p.student_name || 'Unknown')}</p>
      </div>
      <button class="btn btn-admin btn-sm" onclick="assignSupervisor(${p.id})">Assign</button>
    </div>`).join('');
}

function assignSupervisor(projectId) {
  S.currentProjectId = projectId;
  openModal('modal-assign-supervisor');
}

async function confirmAssign() {
  if (!S.currentProjectId) return;
  const supervisorId = document.getElementById('assign-supervisor').value;
  if (!supervisorId) {
    showToast('Please select a supervisor.', 'err');
    return;
  }
  const res = await api('php/projects.php', {
    action: 'assign_supervisor',
    project_id: S.currentProjectId,
    supervisor_id: supervisorId,
  });
  if (res.success) {
    closeModal('modal-assign-supervisor');
    showToast('Supervisor assigned!', 'ok');
    S.currentProjectId = null;
    await loadAssignments();
  } else {
    showToast(res.message || 'Error assigning supervisor.', 'err');
  }
}

// ══════════════════════════════════════════════════════════════
// ACTIVITY LOG
// ══════════════════════════════════════════════════════════════
async function loadActivity() {
  try {
    const res = await api('php/activity.php', { action: 'get_all' }, 'GET');
    S.activities = res.activities || [];
    renderActivityList(S.activities);
  } catch (e) {
    console.error('Error loading activity:', e);
  }
}

function renderActivityList(activities) {
  const el = document.getElementById('activity-list') || document.createElement('div');
  if (!activities.length) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--txt3);">No activity yet.</div>`;
    return;
  }
  el.innerHTML = activities.slice(0, 100).map(a => `
    <div style="padding:16px;border-bottom:1px solid var(--border);display:flex;gap:16px;">
      <div style="flex-shrink:0;font-size:20px;">${getActivityIcon(a.activity_type)}</div>
      <div style="flex:1;">
        <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${esc(a.description)}</div>
        <div style="font-size:11px;color:var(--txt3);">by ${esc(a.username || 'System')} • ${fmtDateTime(a.created_at)}</div>
      </div>
    </div>`).join('');
}

function getActivityIcon(type) {
  const icons = {
    user_created: '👤',
    user_updated: '✏️',
    user_deleted: '❌',
    project_created: '📁',
    project_updated: '✏️',
    project_deleted: '❌',
    assignment_made: '🎯',
    submission_received: '📁',
    approval_given: '✅',
  };
  return icons[type] || '📋';
}

// ══════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════
function loadSettings() {
  const u = S.user || {};
  if (document.getElementById('settings-name')) {
    document.getElementById('settings-name').value = u.full_name || '';
    document.getElementById('settings-email').value = u.email || '';
    document.getElementById('settings-phone').value = u.phone || '';
    document.getElementById('settings-dept').value = u.department || '';
  }
}

async function saveSettings() {
  const res = await api('php/auth.php', {
    action: 'update_profile',
    full_name: document.getElementById('settings-name').value,
    phone: document.getElementById('settings-phone').value,
    department: document.getElementById('settings-dept').value,
  });
  if (res.success) {
    S.user = { ...S.user, ...res.user };
    applyUser();
    loadSettings();
    showToast('Settings saved!', 'ok');
  } else {
    showToast(res.message || 'Error saving settings.', 'err');
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

function getStatusColor(status) {
  const colors = {
    pending: 'var(--gray)',
    active: 'var(--teal)',
    under_review: 'var(--blue)',
    completed: 'var(--green)',
    rejected: 'var(--red)',
    in_progress: 'var(--amber)',
    overdue: 'var(--red)',
    approved: 'var(--green)',
    revision: 'var(--amber)',
  };
  return colors[status] || 'var(--txt3)';
}

