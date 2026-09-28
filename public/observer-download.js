(() => {
  const STORAGE_KEY = 'tradeviceApprovalKey';
  const currentKey = () => String(sessionStorage.getItem(STORAGE_KEY) || '').trim();

  async function ensureUnlocked() {
    let key = currentKey();
    if (!key) key = String(window.prompt('Tradevice Approval Key') || '').trim();
    if (!key) return null;

    const verify = await fetch('/api/v1/approval/verify', {
      method: 'POST',
      headers: { 'x-approval-key': key },
      cache: 'no-store'
    });
    if (!verify.ok) {
      sessionStorage.removeItem(STORAGE_KEY);
      window.alert('Approval key is invalid.');
      return null;
    }
    sessionStorage.setItem(STORAGE_KEY, key);
    return key;
  }

  async function downloadObserver(button) {
    const key = await ensureUnlocked();
    if (!key) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparing…';
    try {
      const res = await fetch('/downloads/TradeviceObserver.mq5', {
        headers: { 'x-approval-key': key },
        cache: 'no-store'
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to prepare Observer');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'TradeviceObserver.mq5';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      button.textContent = 'Downloaded ✓';
      setTimeout(() => { button.textContent = original; }, 1800);
    } catch (error) {
      window.alert(error.message || 'Observer download failed.');
      button.textContent = original;
    } finally {
      button.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('observerDownloadBtn');
    if (button) button.addEventListener('click', () => downloadObserver(button));
  });
})();
