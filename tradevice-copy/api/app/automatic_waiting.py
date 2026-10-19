"""A preparation request is NOT a broker Start, authorization, or release gate.

The intended session is persisted separately from master_demo.commands and
is never included in bridge commands.  Every attempt to turn it into a
broker execution command requires an independently reviewed future release.
"""
import math
from uuid import UUID
from .demo_pool import connection
from .master_skills import SkillError

PROTOCOL='V51_AUTOMATIC_WAITING_INTENT_20261019'
TARGET=100
MAX_GROSS_LOTS=.40
LOSS_TRIGGER_USD=30.0
EQUITY_FRACTION=.03

def risk_budget(equity,session_loss,booked_lots,broker_flat):
    if any(type(x) not in (float,int) or not math.isfinite(x) for x in (equity,session_loss,booked_lots)):
        return dict(verified=False,reason='RISK_EVIDENCE_INVALID')
    if type(broker_flat) is not bool or equity<=0 or session_loss<0 or booked_lots<0:
        return dict(verified=False,reason='RISK_EVIDENCE_INVALID')
    trigger=min(LOSS_TRIGGER_USD,equity*EQUITY_FRACTION)
    # This is a conservative research screen, not a live session-limit
    # setting.  Real session budget requires chronological broker receipts.
    remaining=max(0.0,trigger-session_loss)
    return dict(verified=True,brokerFlat=broker_flat,cycleTriggerUsd=round(trigger,2),
        grossBookedLots=round(booked_lots,4),maxGrossBookedLots=MAX_GROSS_LOTS,
        sessionLossObservedUsd=round(session_loss,2),researchRemainingUsd=round(remaining,2),
        admissionGranted=False,reason='VALIDATION_RELEASE_PENDING')

def validate_intent(payload):
    if not isinstance(payload,dict) or set(payload)!={'actor_id','requestId','action','targetCycles'}:
        raise SkillError('SKILL_WAITING_REQUEST_INVALID',422)
    try:
        if not UUID(str(payload['actor_id'])).int or not UUID(str(payload['requestId'])).int:
            raise ValueError()
    except (TypeError,ValueError,AttributeError):
        raise SkillError('SKILL_WAITING_REQUEST_INVALID',422) from None
    if payload['action'] not in ('REQUEST_AUTOMATIC_WAITING','CANCEL_AUTOMATIC_WAITING'):
        raise SkillError('SKILL_WAITING_ACTION_INVALID',422)
    if type(payload['targetCycles']) is not int or payload['targetCycles']!=TARGET:
        raise SkillError('SKILL_WAITING_TARGET_INVALID',422)
    return payload

def request(dsn,payload):
    p=validate_intent(payload)
    # The entire transaction touches ONLY the planning table. It is
    # physically impossible for this code path to enqueue a broker command.
    with connection(dsn) as conn:
        row=conn.execute('SELECT actor_id,request_id,status,target_cycles FROM master_demo.automatic_waiting WHERE singleton FOR UPDATE').fetchone()
        if row and str(row['request_id'])==str(p['requestId']):
            if str(row['actor_id'])!=str(p['actor_id']) or row['target_cycles']!=TARGET:
                raise SkillError('SKILL_WAITING_ID_CONFLICT',409)
            return dict(requestId=p['requestId'],status=row['status'],targetCycles=TARGET,automaticExecutionAllowed=False)
        status='WAITING_VALIDATION' if p['action']=='REQUEST_AUTOMATIC_WAITING' else 'OFF'
        conn.execute('''INSERT INTO master_demo.automatic_waiting
            (singleton,actor_id,request_id,status,target_cycles,updated_at)
            VALUES(true,%s,%s,%s,%s,now())
            ON CONFLICT(singleton) DO UPDATE SET actor_id=EXCLUDED.actor_id,
              request_id=EXCLUDED.request_id,status=EXCLUDED.status,
              target_cycles=EXCLUDED.target_cycles,updated_at=now()''',
            (p['actor_id'],p['requestId'],status,TARGET))
        return dict(requestId=p['requestId'],status=status,targetCycles=TARGET,automaticExecutionAllowed=False)

def read(conn):
    row=conn.execute('SELECT status,target_cycles,updated_at FROM master_demo.automatic_waiting WHERE singleton').fetchone()
    return dict(protocol=PROTOCOL,status=row['status'] if row else 'OFF',
        targetCycles=TARGET,completedCycles=0,automaticExecutionAllowed=False,
        releaseStatus='LOCKED_VALIDATION_PENDING',
        updatedAt=row['updated_at'].isoformat() if row and row['updated_at'] else None)
