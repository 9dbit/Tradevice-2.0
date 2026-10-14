"""Forex Factory weekly export -> research news guard. No broker dependencies.

Only the pinned official HTTPS export is fetched. The API retains only an expiring in-memory snapshot for its operator display.
Coverage is conservatively restricted to the exported event envelope. This does
not prove the publisher has listed every news event or detect unannounced news.
"""
import hashlib
import json
import re
import time
import threading
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from .news_policy import evaluate_calendar, MAX_CALENDAR_AGE_MS

URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
MAX_BYTES = 2_000_000
MIN_REFRESH_MS = 300_000
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


def retry_deadline(headers, now):
    value = headers.get('Retry-After', '')
    try:
        until = now+int(value)*1000 if str(value).isdigit() else http_ms(value)
    except (ValueError, TypeError, OverflowError):
        until = now+900000
    return max(now+MIN_REFRESH_MS, until)


class NewsCalendar:
    """Single-replica, staging display cache. Never authorizes broker execution.

    Source failures immediately invalidate earlier CLEAR. The calendar is
    re-evaluated at request time, so blackout transitions need no new download.
    Polling is opt-in and independent of operator requests; no request amplification.
    """
    def __init__(self, transport=download, clock=lambda: int(time.time()*1000)):
        self.transport, self.clock = transport, clock
        self.lock = threading.Lock()
        self.calendar = self.provenance = None
        self.error = 'CALENDAR_NOT_CONNECTED'
        self.next_fetch = 0
        self.stop = threading.Event()
        self.thread = None

    def refresh(self):
        now = self.clock()
        with self.lock:
            if now < self.next_fetch:
                return False
            self.next_fetch = now+MIN_REFRESH_MS
        try:
            body, headers = self.transport()
            calendar, provenance = normalize(body, headers, self.clock())
            with self.lock:
                self.calendar, self.provenance, self.error = calendar, provenance, None
        except HTTPError as exc:
            with self.lock:
                self.calendar = self.provenance = None
                self.error = 'CALENDAR_HTTP_'+str(exc.code)
                if exc.code in (429, 503):
                    self.next_fetch = retry_deadline(exc.headers or {}, self.clock())
        except Exception as exc:
            code = str(exc) if type(exc) is ValueError and re.fullmatch('[A-Z_]+', str(exc)) else type(exc).__name__
            with self.lock:
                self.calendar = self.provenance = None
                self.error = 'CALENDAR_'+code
        return True

    def projection(self, now=None):
        now = self.clock() if now is None else now
        with self.lock:
            calendar, provenance, error, retry = self.calendar, self.provenance, self.error, self.next_fetch
        decision = evaluate_calendar(calendar, now, source_verified=calendar is not None)
        if error:
            decision['reason'] = error
        valid = decision['status'] in ('CLEAR', 'BLACKOUT')
        stamp = calendar['observed_utc_ms'] if calendar else None
        events = sorted((e for e in calendar['events'] if e['impact']=='HIGH'),
                        key=lambda e:e['scheduled_utc_ms']) if valid else []
        event = next((e for e in events if e['scheduled_utc_ms']+HOUR >= now), None)
        def event_view(e):
            when = e['scheduled_utc_ms']
            return dict(title=e['title'][:160], currency=e['currency'][:8],
                        at=when, blackoutStart=when-HOUR, blackoutEnd=when+HOUR)
        return dict(provider='Forex Factory', source='OFFICIAL_HTTPS_WEEKLY_EXPORT',
                    status=decision['status'], reason=decision['reason'],
                    policy='AVOID', beforeMinutes=60, afterMinutes=60,
                    observedAt=stamp, evaluatedAt=now,
                    validUntil=stamp+MAX_CALENDAR_AGE_MS if stamp is not None else None,
                    nextRefreshAt=retry or None,
                    coverageStart=calendar['coverage_start_utc_ms'] if calendar else None,
                    coverageEnd=calendar['coverage_end_utc_ms'] if calendar else None,
                    blackoutUntil=decision['blackout_until_utc_ms'],
                    nextEvent=event_view(event) if event else None,
                    highImpactEvents=[event_view(e) for e in events],
                    contentSha256=provenance['sha256'] if provenance else None,
                    entriesAllowed=valid and decision['entries_allowed'],
                    superviseExistingBasket=True, orderDispatchAuthorized=False)

    def start(self):
        def loop():
            while not self.stop.is_set():
                self.refresh()
                self.stop.wait(max(1, (self.next_fetch-self.clock())/1000))
        self.thread = threading.Thread(target=loop, name='staging-news-calendar', daemon=True)
        self.thread.start()

    def close(self):
        self.stop.set()


HOUR = 3600000

