"""Forex Factory weekly export -> research news guard. No broker dependencies.

Only the pinned official HTTPS export is fetched. Restart reuse requires a locally
authenticated cache; an unsigned historical snapshot never grants admission.
Coverage is conservatively restricted to the exported event envelope. This does
not prove the publisher has listed every news event or detect unannounced news.
"""
import argparse
import hashlib
import hmac
import json
import os
import re
import time
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from v51_news_guard import evaluate_calendar

URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
MAX_BYTES = 2_000_000
MIN_REFRESH_MS = 21_600_000  # One collector, at most four attempts per rolling day.
MAX_SOURCE_AGE_MS = 300_000
IMPACTS = {'High': 'HIGH', 'Medium': 'MODERATE', 'Low': 'LOW', 'Holiday': 'NONE'}


def utc_ms(value):
    if not isinstance(value, str) or not re.search(r'(Z|[+-]\d{2}:\d{2})$', value):
        raise ValueError('EVENT_TIME_OFFSET_REQUIRED')
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.utcoffset() is None:
        raise ValueError('EVENT_TIME_OFFSET_REQUIRED')
    return int(stamp.timestamp() * 1000)


def http_ms(value):
    stamp = parsedate_to_datetime(value)
    if stamp.utcoffset() is None:
        raise ValueError('HTTP_TIME_OFFSET_REQUIRED')
    return int(stamp.timestamp() * 1000)


def normalize(body, headers, now_ms):
    """Validate a complete HTTPS response; caller is responsible for transport."""
    if len(body) > MAX_BYTES:
        raise ValueError('BODY_TOO_LARGE')
    h = {k.lower(): v for k, v in headers.items()}
    if h.get('content-type', '').split(';')[0].strip() != 'application/json':
        raise ValueError('CONTENT_TYPE_INVALID')
    date = http_ms(h.get('date', ''))
    modified = http_ms(h.get('last-modified', ''))
    age = int(h.get('age', '0')) * 1000
    if not 0 <= age <= MAX_SOURCE_AGE_MS or not -1000 <= now_ms-date <= MAX_SOURCE_AGE_MS:
        raise ValueError('HTTP_RESPONSE_STALE_OR_FUTURE')
    if modified < 0 or modified > date+1000:
        raise ValueError('SOURCE_REVISION_INVALID_OR_FUTURE')
    # Last-Modified is a content revision, not a heartbeat. An unchanged calendar
    # remains valid after a fresh HTTPS response. Conservatively subtract Age even
    # when a CDN rewrites Date, so a new local fetch cannot renew an old response.
    confirmed = min(now_ms, date)-age
    if now_ms-confirmed > MAX_SOURCE_AGE_MS:
        raise ValueError('HTTP_RESPONSE_STALE_OR_FUTURE')
    rows = json.loads(body)
    if not isinstance(rows, list) or not 2 <= len(rows) <= 10000:
        raise ValueError('EVENT_LIST_EMPTY_OR_INVALID')
    events = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or row.get('impact') not in IMPACTS:
            raise ValueError('EVENT_IMPACT_INVALID')
        title, currency = row.get('title'), row.get('country')
        if not isinstance(title, str) or not title.strip() or not isinstance(currency, str) or not currency.strip():
            raise ValueError('EVENT_IDENTITY_INVALID')
        when = utc_ms(row.get('date'))
        if when < 0:
            raise ValueError('EVENT_TIME_INVALID')
        impact = IMPACTS[row['impact']]
        if impact == 'HIGH' and (row.get('tentative') or row.get('all_day') or
                re.search(r'\b(tentative|all day|tbd)\b', title, re.I)):
            raise ValueError('HIGH_IMPACT_TIME_UNCONFIRMED')
        key = json.dumps([title.strip(), currency.strip(), when], ensure_ascii=False)
        eid = 'ff-' + hashlib.sha256(key.encode()).hexdigest()[:24]
        if eid in seen:
            raise ValueError('DUPLICATE_EVENT')
        seen.add(eid)
        events.append(dict(id=eid, title=title, currency=currency, impact=impact,
                           scheduled_utc_ms=when, time_confirmed=True))
    start = min(e['scheduled_utc_ms'] for e in events)
    end = max(e['scheduled_utc_ms'] for e in events)
    if end-start > 8*86400000:
        raise ValueError('WEEKLY_RANGE_INVALID')
    calendar = dict(schema='tradevice.calendar.utc.v1', time_basis='UTC', complete=True,
                    observed_utc_ms=confirmed, coverage_start_utc_ms=start,
                    coverage_end_utc_ms=end, events=events)
    provenance = dict(provider='Forex Factory', url=URL, retrieved_utc_ms=now_ms,
                      http_date_utc_ms=date, last_modified_utc_ms=modified, age_ms=age,
                      sha256=hashlib.sha256(body).hexdigest(),
                      coverage_basis='official_weekly_export_restricted_to_event_envelope',
                      time_basis='explicit ISO-8601 offsets from export; publisher times may change')
    return calendar, provenance


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('REDIRECT_REFUSED')


def download():
    request = Request(URL, headers={'Accept': 'application/json',
                                    'User-Agent': 'Tradevice-V51-Research-Calendar/1.0'})
    with build_opener(NoRedirect()).open(request, timeout=15) as response:
        if response.status != 200 or response.url != URL:
            raise ValueError('HTTP_RESPONSE_INVALID')
        body = response.read(MAX_BYTES+1)
        return body, dict(response.headers.items())


def retry_until(headers, now_ms):
    value = headers.get('Retry-After', '')
    try:
        until = now_ms+int(value)*1000 if str(value).isdigit() else http_ms(value)
    except (ValueError, TypeError, OverflowError):
        until = now_ms+900000
    return max(now_ms+MIN_REFRESH_MS, until)


def atomic_json(path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding='utf-8')
    os.replace(temp, path)


def cache_signature(directory, payload):
    # Reuse the restricted local bridge key with a distinct cryptographic domain.
    key = (Path(directory).parent/'demo_bridge.secret').read_text().strip()
    if not re.fullmatch('[a-f0-9]{64}', key):raise ValueError('CACHE_KEY_INVALID')
    raw = json.dumps(payload, sort_keys=True, separators=(',',':')).encode()
    return hmac.new(bytes.fromhex(key), b'tradevice-calendar-cache-v1\n'+raw, hashlib.sha256).hexdigest()


def persist_cache(directory, output):
    payload = {k: output[k] for k in ('calendar','provenance','recorded_utc_ms')}
    try:sig = cache_signature(directory, payload)
    except FileNotFoundError:return  # Standalone research collector has no signing key.
    atomic_json(Path(directory)/'trusted_cache.json', dict(payload=payload,signature=sig))


def read_cache(directory, now):
    try:
        p = Path(directory)/'trusted_cache.json'
        if p.stat().st_size > MAX_BYTES*2:return None
        envelope = json.loads(p.read_text())
        payload = envelope['payload']
        if not hmac.compare_digest(envelope['signature'],cache_signature(directory,payload)):return None
        c = payload['calendar']
        if evaluate_calendar(c,now,source_verified=True)['status'] not in ('CLEAR','BLACKOUT'):return None
        return payload
    except (OSError,ValueError,KeyError,TypeError):return None


def collect(directory, *, transport=download, clock=lambda: int(time.time()*1000)):
    """One bounded request, no retries, no scheduling, no broker calls.

    Cooldown reuses only authenticated, unexpired evidence; lock failures return UNKNOWN.
    A crashed lock needs operator inspection; it is never silently stolen.
    """
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    now = clock()
    output = dict(provider='Forex Factory', execution_enabled=False,
                  decision=evaluate_calendar(None, now), recorded_utc_ms=now)
    lock = directory/'fetch.lock'
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        # A concurrent local reader is not a provider cooldown. Reuse only
        # authenticated unexpired evidence; never steal the owner's lock.
        cached = read_cache(directory, now)
        output['next_fetch_utc_ms'] = now+5000
        if cached:
            output.update(cached, cache_reused=True,
                          decision=evaluate_calendar(cached['calendar'],now,source_verified=True))
        else:output['error'] = 'FETCH_ALREADY_LOCKED'
        return output
    os.close(fd)
    state_path = directory/'fetch_state.json'
    try:
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        until = state.get('next_fetch_utc_ms', 0)
        if type(until) is not int or until < 0:
            raise ValueError('FETCH_STATE_INVALID')
        if now < until:
            cached = read_cache(directory, now)
            if cached:
                output.update(cached, next_fetch_utc_ms=until, cache_reused=True,
                              decision=evaluate_calendar(cached['calendar'],now,source_verified=True))
            else:output.update(error='REFRESH_COOLDOWN', next_fetch_utc_ms=until)
            atomic_json(directory/'latest.json', output)
            return output
        output['next_fetch_utc_ms'] = now+MIN_REFRESH_MS
        atomic_json(state_path, dict(next_fetch_utc_ms=output['next_fetch_utc_ms']))
        body, headers = transport()
        now = clock()
        output['recorded_utc_ms'] = now
        # Keep failed validation evidence too; never relabel it as a valid feed.
        public_headers = {k.lower(): v for k, v in headers.items()
                          if k.lower() in ('date', 'last-modified', 'age', 'content-type')}
        output['response_metadata'] = dict(headers=public_headers,
                                           sha256=hashlib.sha256(body).hexdigest(), byte_count=len(body))
        if len(body) <= MAX_BYTES:
            (directory/f'{now}.response.json').write_bytes(body)
        calendar, provenance = normalize(body, headers, now)
        decision = evaluate_calendar(calendar, now, source_verified=True)
        output.update(calendar=calendar, provenance=provenance, decision=decision,
                      recorded_utc_ms=now)
        # Preserve raw public feed and normalized evidence for this exact fetch.
        atomic_json(directory/f'{now}.snapshot.json', output)
        persist_cache(directory, output)
    except HTTPError as exc:
        until = retry_until(exc.headers, clock()) if exc.code in (429, 503) else clock()+MIN_REFRESH_MS
        atomic_json(state_path, dict(next_fetch_utc_ms=until))
        output.update(error=f'HTTP_{exc.code}', next_fetch_utc_ms=until)
    except Exception as exc:
        # Fixed validation codes or class names only; never URLs/body/credentials.
        error = str(exc) if type(exc) is ValueError and re.fullmatch('[A-Z_]+', str(exc)) else type(exc).__name__
        output['error'] = error
        output['decision'] = evaluate_calendar(None, clock())
    finally:
        lock.unlink()
    if 'error' in output:
        (directory/'trusted_cache.json').unlink(missing_ok=True)
    if 'response_metadata' in output and 'error' in output:
        atomic_json(directory/f'{output["recorded_utc_ms"]}.rejected.json', output)
    atomic_json(directory/'latest.json', output)
    return output


def summary(result):
    now = result['recorded_utc_ms']
    upcoming = []
    for event in sorted(result.get('calendar', {}).get('events', []), key=lambda e: e['scheduled_utc_ms']):
        when = event['scheduled_utc_ms']
        if event['impact'] == 'HIGH' and when+3600000 >= now:
            wib = lambda ms: datetime.fromtimestamp(ms/1000, timezone(timedelta(hours=7))).isoformat()
            upcoming.append(dict(title=event['title'], currency=event['currency'],
                                 event_wib=wib(when), blocked_from_wib=wib(when-3600000),
                                 blocked_through_wib=wib(when+3600000)))
    return dict(provider=result['provider'], decision=result['decision'], error=result.get('error'),
                response_metadata=result.get('response_metadata'), recorded_utc_ms=now,
                event_count=len(result.get('calendar', {}).get('events', [])),
                upcoming_high_impact=upcoming[:5], execution_enabled=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(summary(collect(args.output)), indent=2))
