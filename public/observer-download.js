(() => {
  const currentApproval = () => String(sessionStorage.getItem('tradeviceApprovalKey') || '').trim();
  async function downloadObserver() {
    const key = currentApproval();
    if (!key) return window.alert('Unlock Tradevice first, then download the Observer.');
    const res = await fetch('/downloads/TradeviceObserver.mq5', { headers: { 'x-approval-key': key }, cache: 'no-store' });
    if (!res.ok) return window.alert('Unable to prepare Observer.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'TradeviceObserver.mq5';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('observerDownloadBtn')?.addEventListener('click', downloadObserver);
  });
})();
