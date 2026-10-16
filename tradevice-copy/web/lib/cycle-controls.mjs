/** Presentation only. Does not authorize commands or clear reconciliation. */
export function showCloseControl(runtime, {fresh, closed, lastActive, brokerExposure = null, unfinished = 0}) {
 if (Number.isSafeInteger(brokerExposure) && brokerExposure > 0) return true;
 if (closed) return false;
 const executing = state => ['STARTING','RUNNING','PAUSING','PAUSED','STOPPING'].includes(state);
 // Waiting for admission is not an open basket. A fresh flat check also
 // prevents historical unfinished cycles from resurrecting Close all.
 if (fresh && runtime?.checks?.brokerFlat === true && !executing(runtime?.state)) return false;
 return !!(executing(runtime?.state) || executing(lastActive?.state) ||
  runtime?.state === 'RECOVERY_REQUIRED' || runtime?.blockers?.some(b => /RECOVERY|RECONCILIATION/.test(b)) ||
  unfinished > 0 || runtime?.checks?.brokerFlat === false);
}
