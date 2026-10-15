/** UI-only completion evidence. Never authorizes Start or clears reconciliation. */
export function closeCompleted(runtime, now = Date.now()) {
 const proof = runtime?.emergencyClose;
 if (!runtime?.online || !Number.isSafeInteger(runtime.observedMs) || now < runtime.observedMs || now - runtime.observedMs > 8000) return false;
 if (['STARTING','RUNNING','PAUSING','PAUSED','STOPPING'].includes(runtime.state) || runtime.checks?.brokerFlat !== true) return false;
 if (!proof || proof.phase !== 'COMPLETE' || proof.positionsRemaining !== 0 || proof.ordersRemaining !== 0 || !Number.isSafeInteger(proof.observedMs) || proof.observedMs > runtime.observedMs) return false;
 // API history is newest-first. A subsequent Start or close invalidates old proof.
 const latest = runtime.commands?.find(c => c.action === 'EMERGENCY_CLOSE' || c.action === 'START' && !['REJECTED','EXPIRED'].includes(c.status));
 return !!latest && latest.action === 'EMERGENCY_CLOSE' && latest.status === 'APPLIED' && latest.requestId === proof.requestId;
}
