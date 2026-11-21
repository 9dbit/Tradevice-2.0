// Isolated observation storage. No broker or order operations.
import express from 'express';
import pg from 'pg';
const { Pool } = pg;
const allowed = new Set('st_line st_direction st_atr adx14 di_plus di_minus atr14 atr_points ema50 ema_distance_atr rsi14 bb_width bb_width_atr tick_volume volume_mean20 volume_ratio open high low close candle_range_atr body_atr upper_wick_atr lower_wick_atr spread_points spread_atr distance_to_st_points h4_st_direction live_bid live_ask tick_time_msc forming_bar_tick_volume point_size broker_digits reference_price features_bar_shift'.split(' '));
const validId = /^[A-Za-z0-9_.-]{5,180}$/;
let pool, initialized;
async function getDb() {
  if (!process.env.DATABASE_URL) throw Error('research_database_not_configured');
  if (!pool) pool = new Pool({ connectionString:process.env.DATABASE_URL,
    max:2, ssl: process.env.PGSSL === 'disable' ? false : undefined });
  if (!initialized) initialized = pool.query(`CREATE TABLE IF NOT EXISTS supertrend_research_observations (
    event_id TEXT PRIMARY KEY, symbol TEXT NOT NULL, timeframe TEXT NOT NULL,
    direction TEXT NOT NULL, signal_type TEXT NOT NULL, bar_open_epoch BIGINT NOT NULL,
    record JSONB NOT NULL, outcomes JSONB NOT NULL DEFAULT '{}'::jsonb,
    screenshot BYTEA, screenshot_mime TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS supertrend_research_epoch_idx
    ON supertrend_research_observations(bar_open_epoch DESC);`).catch(e=>{initialized=null;throw e;});
  await initialized;
  return pool;
}
function unavailable(res,e) {
  console.error('ST research storage:',e?.message || e);
  res.status(503).json({error:'research_store_unavailable'});
}
function validEvent(e) {
  return e && e.schema_version === 1 && e.record_type === 'SIGNAL' &&
    validId.test(String(e.event_id || '')) &&
    ['BUY','SELL'].includes(e.direction) &&
    ['CONFIRMED_FLIP','INTRABAR_BREAK'].includes(e.signal_type) &&
    ['M1','PERIOD_M1'].includes(e.timeframe) &&
    /^[A-Za-z0-9_.-]{3,32}$/.test(String(e.symbol||'')) &&
    Number.isSafeInteger(e.bar_open_epoch) && e.bar_open_epoch > 1600000000 &&
    e.features && typeof e.features === 'object' && !Array.isArray(e.features);
}
function sanitizeEvent(e) {
  const features = {};
  for (const [key,value] of Object.entries(e.features))
    if (allowed.has(key) && typeof value === 'number' && Number.isFinite(value))
      features[key] = value;
  return { schema_version:1, record_type:'SIGNAL', event_id:e.event_id,
    signal_type:e.signal_type, symbol:e.symbol, timeframe:'M1',
    direction:e.direction, bar_open_epoch:e.bar_open_epoch,
    observed_utc:String(e.observed_utc || '').slice(0,32),
    bar_server_time:String(e.bar_server_time || '').slice(0,32),
    screenshot_requested:e.screenshot_requested===true,
    price_reference:String(e.price_reference||'').slice(0,40),
    features, research_only:true };
}
function validOutcome(o) {
  return o && o.schema_version === 1 && o.record_type === 'OUTCOME' &&
    validId.test(String(o.event_id||'')) && [1,3,6].includes(o.horizon_bars) &&
    ['forward_close','forward_points','mfe_points','mae_points'].every(k =>
      o[k] === null || (typeof o[k] === 'number' && Number.isFinite(o[k]))) &&
    typeof o.st_trend_held === 'boolean' &&
    typeof o.favorable_1atr_observed === 'boolean';
}
export function registerSupertrendResearch(app,requireKey) {
  function auth(req,res,next) {
    if (!process.env.TRADEVICE_API_KEY) return res.status(503).json({error:'research_auth_not_configured'});
    return requireKey(req,res,next);
  }
  app.post('/api/v1/research/supertrend/events',auth,async(req,res)=>{
    const e=req.body;
    if (!validEvent(e)) return res.status(400).json({error:'invalid_research_signal'});
    const v=sanitizeEvent(e);
    try {
      const db=await getDb();
      await db.query(`INSERT INTO supertrend_research_observations
        (event_id,symbol,timeframe,direction,signal_type,bar_open_epoch,record)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
        ON CONFLICT(event_id) DO UPDATE SET record=EXCLUDED.record,updated_at=NOW()`,
        [v.event_id,v.symbol,v.timeframe,v.direction,v.signal_type,v.bar_open_epoch,JSON.stringify(v)]);
      res.json({stored:true,event_id:v.event_id});
    } catch(e){unavailable(res,e);}
  });
  app.post('/api/v1/research/supertrend/outcomes',auth,async(req,res)=>{
    const o=req.body;
    if(!validOutcome(o))return res.status(400).json({error:'invalid_research_outcome'});
    const v={horizon_bars:o.horizon_bars,forward_close:o.forward_close,
      forward_points:o.forward_points,mfe_points:o.mfe_points,mae_points:o.mae_points,
      st_trend_held:o.st_trend_held,favorable_1atr_observed:o.favorable_1atr_observed};
    try {
      const db=await getDb();
      const result=await db.query(`UPDATE supertrend_research_observations
        SET outcomes=jsonb_set(outcomes,ARRAY[$2::text],$3::jsonb,true),
        updated_at=NOW() WHERE event_id=$1`,[o.event_id,String(o.horizon_bars),JSON.stringify(v)]);
      if(!result.rowCount)return res.status(404).json({error:'event_not_found'});
      res.json({stored:true});
    } catch(e){unavailable(res,e);}
  });
  app.post('/api/v1/research/supertrend/images/:id',auth,
    express.raw({type:'image/png',limit:'2200kb'}), async(req,res)=>{
      const id=String(req.params.id||'');
      if(!validId.test(id)||!Buffer.isBuffer(req.body)||req.body.length<16||
        req.body.length>2200000||req.body.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')
        return res.status(400).json({error:'invalid_image'});
      try {
        const db=await getDb();
        const result=await db.query(`UPDATE supertrend_research_observations
          SET screenshot=$2,screenshot_mime='image/png',updated_at=NOW()
          WHERE event_id=$1`,[id,req.body]);
        if(!result.rowCount)return res.status(404).json({error:'event_not_found'});
        res.json({stored:true});
      } catch(e){unavailable(res,e);}
    });
  app.get('/api/v1/research/supertrend/events',auth,async(req,res)=>{
    const limit=Math.max(1,Math.min(500,Number(req.query.limit)||150));
    try {
      const db=await getDb();
      const {rows}=await db.query(`SELECT event_id,record,outcomes,
        screenshot IS NOT NULL AS has_screenshot,received_at
        FROM supertrend_research_observations ORDER BY bar_open_epoch DESC
        LIMIT $1`,[limit]);
      res.set('Cache-Control','private, no-store');
      res.json({mode:'OBSERVATION_ONLY',store:'postgres',rows,generated_at:new Date().toISOString()});
    } catch(e){unavailable(res,e);}
  });
  app.get('/api/v1/research/supertrend/images/:id',auth,async(req,res)=>{
    const id=String(req.params.id||'');
    if(!validId.test(id))return res.status(400).json({error:'invalid_id'});
    try {
      const db=await getDb();
      const {rows}=await db.query(
        'SELECT screenshot,screenshot_mime FROM supertrend_research_observations WHERE event_id=$1',[id]);
      if(!rows[0]?.screenshot)return res.status(404).json({error:'image_not_found'});
      res.set('Cache-Control','private, no-store');
      res.type(rows[0].screenshot_mime||'image/png').send(rows[0].screenshot);
    } catch(e){unavailable(res,e);}
  });
}
