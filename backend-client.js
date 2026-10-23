(() => {
  'use strict';

  const API_ORIGIN = 'https://securevault-account-api.onrender.com';
  const $ = (id) => document.getElementById(id);
  let apiToken = null;
  let apiUser = null;
  let apiReady = false;
  let apiUsers = [];
  let phoneChallengeId = null;

  const style = document.createElement('style');
  style.textContent = `
    .backend-status{margin:12px 0;padding:10px 12px;border:1px solid #dfe8e8;border-radius:9px;background:#f4f7f7;color:#526a72;font-size:10px;line-height:1.5}
    .backend-status[data-state="online"]{border-color:#cfe8d9;background:#eff9f2;color:#17603e}
    .backend-status[data-state="offline"]{border-color:#f0dfb9;background:#fff8eb;color:#73531a}
    .backend-session-note,.phone-verification{display:none;margin:0 0 18px}
    #backend-phone-field{display:none}
    body[data-auth="on"][data-auth-mode="api"] .backend-session-note{display:block}
    body[data-auth="on"][data-auth-mode="api"][data-role="user"] .phone-verification{display:block}
    body[data-auth="on"][data-auth-mode="api"] #top .grid>section[aria-labelledby="verify-title"]{display:none}
    body[data-auth="on"][data-auth-mode="api"] #reset-flow{display:none}
    body[data-auth="on"][data-auth-mode="api"] .demo-control,body[data-auth="on"][data-auth-mode="api"] .demo-hint{display:none!important}
    body[data-auth="on"][data-auth-mode="api"][data-role="admin"] #backend-phone-field{display:grid!important}
    .phone-verification .flow{padding:16px 20px}
    .backend-phone-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
    .backend-code{max-width:180px}
    .backend-rfid-label{font-size:10px;color:#526a72}
  `;
  document.head.append(style);

  function setStatus(text, state = 'offline') {
    const node = $('backend-status');
    if (!node) return;
    node.textContent = text;
    node.dataset.state = state;
  }

  function setMessage(id, text, isError = false) {
    const node = $(id);
    if (!node) return;
    node.textContent = text;
    node.dataset.state = isError ? 'error' : 'info';
  }

  async function request(path, { method = 'GET', body, token = apiToken } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${API_ORIGIN}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store', signal: AbortSignal.timeout(65000)
    });
    if (response.status === 204) return {};
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  function addBackendStatus() {
    if ($('backend-status')) return;
    const node = document.createElement('p');
    node.id = 'backend-status';
    node.className = 'backend-status';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.textContent = 'Checking live account service…';
    $('login-message')?.after(node);
    const disclaimer = document.querySelector('.auth-disclaimer');
    if (disclaimer) disclaimer.innerHTML = '<b>Demo and live accounts:</b> the demo buttons use local sample accounts. Real accounts use the secure backend only when its status above is online. Never enter real credentials while the backend is unavailable.';
  }

  function addLiveSessionNote() {
    if ($('backend-session-note')) return;
    const node = document.createElement('section');
    node.id = 'backend-session-note';
    node.className = 'panel backend-session-note';
    node.innerHTML = '<div class="flow"><strong>Live account session</strong><p class="caption">Your login and account settings are handled by the SecureVault API. Physical RFID, PIN, OTP, and tamper results come from the ESP32 through the separate read-only relay. This website cannot unlock the vault.</p></div>';
    $('top')?.querySelector('.grid')?.before(node);
  }

  function addPhoneVerification() {
    if ($('phone-verification')) return;
    const panel = document.createElement('section');
    panel.id = 'phone-verification';
    panel.className = 'panel phone-verification';
    panel.innerHTML = '<div class="ph"><div><h2>Verify your phone</h2><p class="caption" id="phone-verification-status">Phone verification is required before the vault device can request an OTP.</p></div><span class="count">SMS VERIFICATION</span></div><div class="flow"><div class="backend-phone-actions"><button class="btn" id="send-phone-code" type="button">Send verification SMS</button><input class="field backend-code" id="phone-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="Enter SMS code" hidden><button class="btn light" id="verify-phone-code" type="button" hidden>Verify phone</button></div><p class="auth-message" id="phone-verification-message" role="status" aria-live="polite"></p></div>';
    const forcePassword = $('force-password');
    forcePassword?.after(panel);
    $('send-phone-code')?.addEventListener('click', sendPhoneCode);
    $('verify-phone-code')?.addEventListener('click', verifyPhoneCode);
  }

  function addAdminPhoneField() {
    if ($('new-user-phone')) return;
    const form = $('provision-form');
    const rfid = $('new-user-rfid');
    if (!form || !rfid) return;
    const label = document.createElement('label');
    label.id = 'backend-phone-field';
    label.className = 'auth-label';
    label.htmlFor = 'new-user-phone';
    label.textContent = 'User phone number';
    const input = document.createElement('input');
    input.id = 'new-user-phone';
    input.className = 'field';
    input.type = 'tel';
    input.autocomplete = 'tel';
    input.placeholder = '+91XXXXXXXXXX';
    input.maxLength = 16;
    input.required = false;
    label.append(input);
    rfid.closest('label')?.before(label);
    rfid.type = 'text';
    rfid.pattern = '[A-Fa-f0-9]{6,32}';
    rfid.placeholder = 'Hex card UID, e.g. A1B2C3D4';
    const hint = form.querySelector('.provision-hint');
    if (hint) hint.textContent = 'Live accounts require a +countrycode phone number and a 6–32 character hexadecimal RFID UID. The card UID is stored as a keyed digest; it is not shown again.';
    const rfidHeading = document.querySelector('#accounts-title')?.closest('.admin-panel')?.querySelector('th:nth-child(4)');
    if (rfidHeading) rfidHeading.textContent = 'Card storage';
  }

  async function checkBackend() {
    addBackendStatus();
    try {
      const result = await request('/healthz', { token: null });
      apiReady = result.status === 'ok';
      setStatus(apiReady ? 'Live account backend is online. Real account sign-in is enabled.' : 'Live account backend is not ready. Use the clearly marked demo accounts until setup is complete.', apiReady ? 'online' : 'offline');
    } catch {
      apiReady = false;
      setStatus('Live account backend is not ready yet. Demo accounts remain available; real accounts need the backend setup completed.', 'offline');
    }
    return apiReady;
  }

  function setApiSession(user, token) {
    apiToken = token;
    apiUser = user;
    apiUsers = [];
    phoneChallengeId = null;
    document.getElementById('use-demo')?.click();
    document.body.dataset.auth = 'on';
    document.body.dataset.authMode = 'api';
    document.body.dataset.role = user.role;
    document.body.dataset.passwordChange = user.mustChangePassword ? 'on' : 'off';
    $('account-chip').textContent = `${user.name} · ${user.role === 'admin' ? 'Seller Admin' : 'User'}`;
    $('session-label').textContent = 'Live account · API authenticated';
    $('avatar').textContent = (user.name || 'S').trim().charAt(0).toUpperCase();
    $('avatar').setAttribute('aria-label', user.role === 'admin' ? 'Seller Admin' : 'User');
    $('login-form').reset();
    setMessage('login-message', '');
    addLiveSessionNote();
    addPhoneVerification();
    addAdminPhoneField();
    $('new-user-phone').required = user.role === 'admin';
    if (user.role === 'admin') loadAdminUsers();
    if (user.role === 'user') renderPhoneStatus();
    if (user.mustChangePassword) {
      $('new-login-password').minLength = 12;
      $('confirm-login-password').minLength = 12;
      $('new-login-password').placeholder = 'Use at least 12 characters';
      $('confirm-login-password').placeholder = 'Enter it again';
      $('password-change-message').textContent = 'Choose a new password of at least 12 characters.';
    }
    setStatus('Live account backend is online. You are signed in securely.', 'online');
  }

  async function signIn(form) {
    const email = $('login-username').value.trim();
    const password = $('login-password').value;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    setMessage('login-message', 'Signing in…');
    try {
      if (!apiReady) await checkBackend();
      if (!apiReady) {
        setMessage('login-message', 'The live backend is offline. No credentials were sent; you can still use the sample demo accounts.', true);
        form.dataset.localFallback = '1';
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        delete form.dataset.localFallback;
        return;
      }
      const data = await request('/api/auth/login', { method: 'POST', body: { email, password }, token: null });
      setApiSession(data.user, data.token);
    } catch (error) {
      setMessage('login-message', error.message || 'The live account service is unavailable. Try again later or use a demo account.', true);
    } finally {
      button.disabled = false;
    }
  }

  async function loadAdminUsers() {
    try {
      const result = await request('/api/admin/users');
      apiUsers = result.users || [];
      renderAdminUsers();
    } catch (error) {
      apiUsers = [];
      renderAdminUsers();
      setMessage('provision-message', `Could not load users: ${error.message}`, true);
    }
  }

  function renderAdminUsers() {
    const body = $('account-table-body');
    if (!body) return;
    body.replaceChildren();
    if (!apiUsers.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = 'No user accounts yet.';
      row.append(cell);
      body.append(row);
      return;
    }
    for (const user of apiUsers) {
      const row = document.createElement('tr');
      for (const value of [user.name, user.email, 'User', 'Stored as digest']) {
        const cell = document.createElement('td');
        cell.textContent = value || '—';
        row.append(cell);
      }
      const status = document.createElement('td');
      status.textContent = user.active ? 'Active' : 'Inactive';
      row.append(status);
      const action = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'table-action';
      button.dataset.backendUserId = user.id;
      button.textContent = user.active ? 'Deactivate' : 'Reactivate';
      action.append(button);
      row.append(action);
      body.append(row);
    }
  }

  async function createApiUser(form) {
    const name = $('new-user-name').value.trim();
    const email = $('new-user-login').value.trim().toLowerCase();
    const phoneNumber = $('new-user-phone').value.trim();
    const rfidCardId = $('new-user-rfid').value.trim().replace(/\s+/g, '').toUpperCase();
    if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
      setMessage('provision-message', 'Enter the phone number with country code, such as +91XXXXXXXXXX.', true);
      return;
    }
    if (!/^[A-F0-9]{6,32}$/.test(rfidCardId)) {
      setMessage('provision-message', 'Enter a 6–32 character hexadecimal RFID UID.', true);
      return;
    }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    setMessage('provision-message', 'Creating the user account…');
    try {
      const result = await request('/api/admin/users', { method: 'POST', body: { name, email, phoneNumber, rfidCardId } });
      $('result-login').textContent = result.user.email;
      $('result-rfid').textContent = 'Stored securely as a keyed digest';
      $('result-password').textContent = result.temporaryPassword;
      $('provision-result').hidden = false;
      form.reset();
      setMessage('provision-message', 'User created. Share the temporary password privately; it is shown only now.');
      await loadAdminUsers();
    } catch (error) {
      setMessage('provision-message', error.message || 'Could not create the user.', true);
    } finally {
      button.disabled = false;
    }
  }

  async function changeApiPassword(form) {
    const first = $('new-login-password').value;
    const second = $('confirm-login-password').value;
    if (first.length < 12) return setMessage('password-change-message', 'Choose a password with at least 12 characters.', true);
    if (first !== second) return setMessage('password-change-message', 'The passwords do not match.', true);
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await request('/api/auth/change-password', { method: 'POST', body: { newPassword: first } });
      await endApiSession(false);
      setMessage('login-message', 'Password updated. Sign in again with your new password.');
      $('login-password').value = '';
    } catch (error) {
      setMessage('password-change-message', error.message || 'Could not update the password.', true);
    } finally {
      button.disabled = false;
      form.reset();
    }
  }

  function renderPhoneStatus() {
    const status = $('phone-verification-status');
    const send = $('send-phone-code');
    const code = $('phone-code');
    const verify = $('verify-phone-code');
    if (!status || !apiUser || apiUser.role !== 'user') return;
    phoneChallengeId = null;
    code.hidden = true;
    verify.hidden = true;
    code.value = '';
    send.disabled = false;
    if (apiUser.phoneVerified) {
      status.textContent = `Phone ${apiUser.phoneNumber || ''} is verified. A vault OTP is requested by the physical device, not this dashboard.`;
      send.hidden = true;
      return;
    }
    send.hidden = false;
    status.textContent = apiUser.phoneNumber ? `A verification code will be sent by SMS to ${apiUser.phoneNumber}.` : 'No phone number is set. Ask the Seller Admin to update your account.';
    send.disabled = !apiUser.phoneNumber;
  }

  async function sendPhoneCode() {
    const button = $('send-phone-code');
    button.disabled = true;
    try {
      const result = await request('/api/account/phone/send-verification', { method: 'POST', body: {} });
      phoneChallengeId = result.challengeId;
      $('phone-code').hidden = false;
      $('verify-phone-code').hidden = false;
      $('phone-code').focus();
      setMessage('phone-verification-message', 'Verification SMS sent. Enter the code here.');
    } catch (error) {
      setMessage('phone-verification-message', error.message || 'Could not send the verification SMS.', true);
      button.disabled = false;
    }
  }

  async function verifyPhoneCode() {
    if (!phoneChallengeId) return;
    const code = $('phone-code').value.trim();
    try {
      await request('/api/account/phone/verify', { method: 'POST', body: { challengeId: phoneChallengeId, code } });
      apiUser.phoneVerified = true;
      setMessage('phone-verification-message', 'Phone verified successfully.');
      renderPhoneStatus();
    } catch (error) {
      setMessage('phone-verification-message', error.message || 'The code could not be verified.', true);
    }
  }

  async function endApiSession(callLogout = true) {
    const token = apiToken;
    if (callLogout && token) {
      try { await request('/api/auth/logout', { method: 'POST', token }); } catch { /* Expired or unavailable session. */ }
    }
    apiToken = null;
    apiUser = null;
    apiUsers = [];
    phoneChallengeId = null;
    document.body.dataset.auth = 'off';
    document.body.dataset.authMode = '';
    document.body.dataset.role = '';
    document.body.dataset.passwordChange = 'off';
    if ($('new-user-phone')) $('new-user-phone').required = false;
    if ($('new-user-rfid')) {
      $('new-user-rfid').removeAttribute('pattern');
      $('new-user-rfid').placeholder = 'Card UID / printed ID';
    }
    const provisionHint = $('provision-form')?.querySelector('.provision-hint');
    if (provisionHint) provisionHint.textContent = 'Use the card’s ID only. Never enter the user’s PIN or OTP here. This demo keeps new accounts in memory in this tab; refresh clears them.';
    const rfidHeading = document.querySelector('#accounts-title')?.closest('.admin-panel')?.querySelector('th:nth-child(4)');
    if (rfidHeading) rfidHeading.textContent = 'RFID ID';
    $('login-form').reset();
    $('login-password').value = '';
    $('provision-result').hidden = true;
    document.getElementById('use-demo')?.click();
    setMessage('login-message', 'Signed out.');
    setStatus(apiReady ? 'Live account backend is online. Real account sign-in is enabled.' : 'Live account backend is not ready yet. Demo accounts remain available.', apiReady ? 'online' : 'offline');
  }

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form?.id === 'login-form') {
      if (form.dataset.localFallback === '1') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      signIn(form);
      return;
    }
    if (!apiToken) return;
    if (form?.id === 'password-change-form') {
      event.preventDefault();
      event.stopImmediatePropagation();
      changeApiPassword(form);
    } else if (form?.id === 'provision-form' && apiUser?.role === 'admin') {
      event.preventDefault();
      event.stopImmediatePropagation();
      createApiUser(form);
    }
  }, true);

  document.addEventListener('click', async (event) => {
    const logout = event.target.closest('#logout-button');
    if (logout && apiToken) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await endApiSession(true);
      return;
    }
    const button = event.target.closest('[data-backend-user-id]');
    if (!button || !apiToken || apiUser?.role !== 'admin') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const account = apiUsers.find((item) => item.id === button.dataset.backendUserId);
    if (!account) return;
    button.disabled = true;
    try {
      await request(`/api/admin/users/${encodeURIComponent(account.id)}/status`, { method: 'PATCH', body: { active: !account.active } });
      await loadAdminUsers();
      setMessage('provision-message', account.active ? 'User deactivated.' : 'User reactivated.');
    } catch (error) {
      setMessage('provision-message', error.message || 'Could not update the user.', true);
      button.disabled = false;
    }
  }, true);

  addBackendStatus();
  addPhoneVerification();
  addAdminPhoneField();
  checkBackend();
})();
