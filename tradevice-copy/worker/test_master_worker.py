import unittest
from master_worker import enforce_safety

SAFE={"PLATFORM_ENVIRONMENT":"staging","SUPABASE_PROJECT_REF":"scqzlcivherovlwqypeu",
"TRADING_EXECUTION_MODE":"paper","BROKER_ADAPTER":"paper","BROKER_LIVE_ENABLED":"false",
"COPY_EXECUTION_ENABLED":"false","MASTER_QUOTE_SOURCE":"none","MASTER_DATABASE_URL":"postgresql://placeholder"}

class SafetyTests(unittest.TestCase):
    def test_safe(self): enforce_safety(SAFE)
    def test_live_flags(self):
        for key,value in [("BROKER_LIVE_ENABLED","true"),("COPY_EXECUTION_ENABLED","true"),
          ("TRADING_EXECUTION_MODE","live"),("BROKER_ADAPTER","mt5"),
          ("PLATFORM_ENVIRONMENT","production"),("MASTER_QUOTE_SOURCE","primary"),
          ("SUPABASE_PROJECT_REF","wrong"),("MASTER_DATABASE_URL","")]:
            with self.subTest(key=key),self.assertRaises(RuntimeError):
                enforce_safety({**SAFE,key:value})
if __name__=="__main__": unittest.main()
