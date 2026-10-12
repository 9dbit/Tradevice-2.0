import unittest
from master_worker import enforce_safety, cycle_state

SAFE={"PLATFORM_ENVIRONMENT":"staging","SUPABASE_PROJECT_REF":"scqzlcivherovlwqypeu",
"TRADING_EXECUTION_MODE":"paper","BROKER_ADAPTER":"paper","BROKER_LIVE_ENABLED":"false",
"COPY_EXECUTION_ENABLED":"false","MASTER_QUOTE_SOURCE":"none","MASTER_DATABASE_URL":"postgresql://tradevice_master_worker:test-secret@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=require"}

class SafetyTests(unittest.TestCase):
    def test_safe(self): enforce_safety(SAFE)
    def test_live_flags(self):
        for key,value in [("BROKER_LIVE_ENABLED","true"),("COPY_EXECUTION_ENABLED","true"),
          ("TRADING_EXECUTION_MODE","live"),("BROKER_ADAPTER","mt5"),
          ("PLATFORM_ENVIRONMENT","production"),("MASTER_QUOTE_SOURCE","primary"),
          ("SUPABASE_PROJECT_REF","wrong"),("MASTER_DATABASE_URL",""),
          ("MASTER_DATABASE_URL","postgresql://postgres:secret@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=require"),
          ("MASTER_DATABASE_URL","postgresql://tradevice_master_worker:x@db.evil.supabase.co:5432/postgres?sslmode=require"),
          ("MASTER_DATABASE_URL","postgresql://tradevice_master_worker:x@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=disable")]:
            with self.subTest(key=key),self.assertRaises(RuntimeError):
                enforce_safety({**SAFE,key:value})
    def test_fails_closed_when_quotes_not_configured(self):
        self.assertEqual(cycle_state(False),("DEGRADED","MISSING_TRUSTED_QUOTE"))
        self.assertEqual(cycle_state(True),("HALTED","MANUAL_KILL"))

if __name__=="__main__": unittest.main()
