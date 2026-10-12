"""Staging-only privileged operator command inbox. Never connects to a live broker."""
import re
from urllib.parse import urlsplit,parse_qs
from uuid import UUID

import psycopg

STAGING_PROJECT = "scqzlcivherovlwqypeu"
MASTER = "tradevice-master-staging"
VALID_ACTIONS = frozenset(("START","STOP","CONFIGURE","RESET_SESSION"))
VALID_NEWS_POLICIES = frozenset(("AVOID","ALLOW","ONLY"))
VALID_CYCLE_MODES = frozenset(("CONTINUOUS","CUSTOM"))


def allowed_operator_dsn(value: str) -> bool:
    try:
        if not value or value != value.strip():
            return False
        u = urlsplit(value)
        return bool(u.scheme in ("postgresql","postgres") and
          u.hostname == f"db.{STAGING_PROJECT}.supabase.co" and
          u.port == 5432 and u.path == "/postgres" and
          u.username == "tradevice_master_operator" and
          u.password and parse_qs(u.query).get("sslmode") == ["require"] and
          not u.fragment)
    except (ValueError,TypeError):
        return False


def validate_command(payload):
    """Strict action-specific input validation, independent of the UI."""
    if not isinstance(payload,dict):
        raise ValueError("INVALID_COMMAND")
    if set(payload) != {"actor_id","request_id","action","cycle_mode","target_cycles","news_policy"}:
        raise ValueError("INVALID_COMMAND_FIELDS")
    try:
        actor = UUID(str(payload["actor_id"]))
        request = UUID(str(payload["request_id"]))
    except (ValueError,TypeError,AttributeError):
        raise ValueError("INVALID_COMMAND_IDENTIFIERS") from None
    if actor.int == 0 or request.int == 0 or payload["action"] not in VALID_ACTIONS:
        raise ValueError("INVALID_COMMAND")
    action=payload["action"]
    mode=payload["cycle_mode"]
    target=payload["target_cycles"]
    news=payload["news_policy"]
    if action=="CONFIGURE":
        if mode not in VALID_CYCLE_MODES or news not in VALID_NEWS_POLICIES:
            raise ValueError("INVALID_CONFIGURATION")
        if mode=="CONTINUOUS" and target is not None:
            raise ValueError("INVALID_CONFIGURATION")
        if mode=="CUSTOM" and (type(target) is not int or not (1 <= target <= 1000000)):
            raise ValueError("INVALID_CONFIGURATION")
    elif mode is not None or target is not None or news is not None:
        raise ValueError("UNEXPECTED_CONFIGURATION")
    return actor,request,action,mode,target,news


def submit_command(dsn: str, payload: dict):
    if not allowed_operator_dsn(dsn):
        raise RuntimeError("Operator DSN is not restricted to staging")
    actor,request,action,mode,target,news=validate_command(payload)
    with psycopg.connect(dsn,connect_timeout=5,options="-c statement_timeout=5000",autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_user")
            if cur.fetchone()[0]!="tradevice_master_operator":
                raise RuntimeError("Dedicated command writer role required")
            try:
                cur.execute("""INSERT INTO master_control.operator_commands
                    (master_id,actor_id,action,idempotency_key,cycle_mode,target_cycles,news_policy)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                    (MASTER,actor,action,request,mode,target,news))
                inserted = True
            except psycopg.errors.UniqueViolation as exc:
                if exc.diag.constraint_name != "operator_commands_idempotency_key_key":
                    raise
                inserted = False
    return {"requestId":str(request),"status":"PENDING" if inserted else "DUPLICATE"}
