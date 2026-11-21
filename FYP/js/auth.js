// Auth JS extracted from index.html and adjusted for external file
(function(){
  // Expose functions globally used by inline attributes
  window.showTab = function(tab) {
    document.querySelectorAll('.auth-tab, .auth-form').forEach(el => el.classList.remove('active'));
    const tabEl = document.getElementById('tab-' + tab);
    const formEl = document.getElementById('form-' + tab);
    if (tabEl) tabEl.classList.add('active');
    if (formEl) formEl.classList.add('active');
  };

  window.togglePass = function(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.type = el.type === 'password' ? 'text' : 'password';
  };

  // Role picker UX (only on pages that have it)
  function initRolePicker(){
    const radios = document.querySelectorAll('input[name="role"]');
    if (!radios || radios.length === 0) return;
    radios.forEach(radio => {
      radio.addEventListener('change', () => {
        document.querySelectorAll('.role-opt').forEach(el => el.classList.remove('active'));
        const opt = radio.closest('.role-opt');
        if (opt) opt.classList.add('active');
        const sid = document.getElementById('studentid-group');
        if (sid) sid.style.display = radio.value === 'student' ? 'block' : 'none';
      });
    });
  }

  function showError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }
  function clearErrors() {
    document.querySelectorAll('.auth-error').forEach(el => { el.textContent=''; el.style.display='none'; });
  }

  function showToast(msg, ok = true) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast ' + (ok ? 'ok' : 'err') + ' show';
    setTimeout(() => t.classList.remove('show'), 3500);
  }

  async function apiPost(url, data) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(data)) fd.append(k, v);
    try {
      const res = await fetch(url, { method: 'POST', body: fd });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const json = await res.json();
      return json;
    } catch (e) {
      console.error('API Error:', e);
      return { success: false, message: 'Network error: Unable to reach the server. Check that PHP/Apache is running.', error: e.message };
    }
  }

  async function checkSystemStatus() {
    try {
      const res = await fetch('php/auth.php?action=debug');
      const data = await res.json();
      console.log('System Debug Info:', data);
      return data;
    } catch (e) {
      console.error('Debug failed:', e);
      return null;
    }
  }

  window.doLogin = async function() {
    clearErrors();
    const emailEl = document.getElementById('l-email');
    const passEl  = document.getElementById('l-pass');
    const email = emailEl ? emailEl.value.trim() : '';
    const pass  = passEl ? passEl.value : '';
    if (!email || !pass) { showError('login-error', 'Please enter email and password.'); return; }

    const btn = document.querySelector('#form-login .btn-submit');
    if (btn) { btn.disabled = true; const s = btn.querySelector('span'); if (s) s.textContent = 'Signing in…'; }

    try {
      const res = await apiPost('php/auth.php', { action: 'login', email, password: pass });
      if (res.success) {
        showToast('Welcome back, ' + (res.user && res.user.full_name ? res.user.full_name : '') + '!');
        // Redirect based on user role
        let redirectUrl = 'dashboard.html';
        if (res.user && res.user.role === 'supervisor') {
          redirectUrl = 'supervisor-dashboard.html';
        } else if (res.user && res.user.role === 'admin') {
          redirectUrl = 'admin-dashboard.html';
        }
        setTimeout(() => { window.location.href = redirectUrl; }, 800);
      } else {
        const msg = res.message || res.error || 'Login failed. Check server status.';
        console.error('Login error:', res);
        showError('login-error', msg);
        if (btn) { btn.disabled = false; const s = btn.querySelector('span'); if (s) s.textContent = 'Sign In'; }
      }
    } catch(e) {
      console.error('Login exception:', e);
      showError('login-error', 'Network error. Is PHP/Apache running? Check browser console for details.');
      if (btn) { btn.disabled = false; const s = btn.querySelector('span'); if (s) s.textContent = 'Sign In'; }
    }
  };

  window.doRegister = async function() {
    clearErrors();
    const nameEl  = document.getElementById('r-name');
    const emailEl = document.getElementById('r-email');
    const idEl    = document.getElementById('r-id');
    const deptEl  = document.getElementById('r-dept');
    const passEl  = document.getElementById('r-pass');

    const name  = nameEl ? nameEl.value.trim() : '';
    const email = emailEl ? emailEl.value.trim() : '';
    const id    = idEl ? idEl.value.trim() : '';
    const dept  = deptEl ? deptEl.value : '';
    const pass  = passEl ? passEl.value : '';
    const roleEl = document.querySelector('input[name="role"]:checked');
    const role = roleEl ? roleEl.value : 'student';

    if (!name || !email || !pass) { showError('reg-error', 'Please fill in all required fields.'); return; }
    if (pass.length < 8) { showError('reg-error', 'Password must be at least 8 characters.'); return; }

    const btn = document.querySelector('#form-register .btn-submit');
    if (btn) { btn.disabled = true; const s = btn.querySelector('span'); if (s) s.textContent = 'Creating…'; }

    try {
      const res = await apiPost('php/auth.php', { action: 'register', full_name: name, email, password: pass, role, student_id: id, department: dept });
      if (res.success) {
        showToast('Account created! Redirecting…');
        // Redirect based on user role
        let redirectUrl = 'dashboard.html';
        if (res.user && res.user.role === 'supervisor') {
          redirectUrl = 'supervisor-dashboard.html';
        } else if (res.user && res.user.role === 'admin') {
          redirectUrl = 'admin-dashboard.html';
        }
        setTimeout(() => { window.location.href = redirectUrl; }, 800);
      } else {
        const msg = res.message || res.error || 'Registration failed. Check server status.';
        console.error('Register error:', res);
        showError('reg-error', msg);
        if (btn) { btn.disabled = false; const s = btn.querySelector('span'); if (s) s.textContent = 'Create Account'; }
      }
    } catch(e) {
      console.error('Register exception:', e);
      showError('reg-error', 'Network error. Is PHP/Apache running? Check browser console for details.');
      if (btn) { btn.disabled = false; const s = btn.querySelector('span'); if (s) s.textContent = 'Create Account'; }
    }
  };

  // Enter key handler
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const active = document.querySelector('.auth-form.active');
      if (!active) return;
      if (active.id === 'form-login') window.doLogin();
      else window.doRegister();
    }
  });

  // Initial auth check (if php endpoint exists)
  (async () => {
    try {
      const res = await fetch('php/auth.php?action=check');
      if (!res.ok) throw new Error('Server not responding');
      const data = await res.json();
      if (data.success) {
        // Redirect based on role so supervisors/admins land on the right dashboard
        let redirectUrl = 'dashboard.html';
        if (data.user && data.user.role === 'supervisor') redirectUrl = 'supervisor-dashboard.html';
        else if (data.user && data.user.role === 'admin') redirectUrl = 'admin-dashboard.html';
        window.location.href = redirectUrl;
      }
    } catch(e) {
      console.warn('Auth check failed - server may not be ready yet:', e);
      checkSystemStatus().then(debug => {
        if (!debug || !debug.success) {
          console.error('System Status:', debug);
          const le = document.getElementById('login-error');
          if (le) showError('login-error', 'Server is not responding. Please ensure Apache/PHP and MySQL are running and that this project is served via http://localhost/.');
        }
      });
    }
  })();

  // Initialize UI pieces
  document.addEventListener('DOMContentLoaded', () => {
    initRolePicker();
  });

})();
