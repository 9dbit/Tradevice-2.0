"""Private staging skill catalog. Selection is configuration, never broker authority."""
import base64,hashlib,io,json,re,stat,zipfile
from pathlib import PurePosixPath
from uuid import UUID
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from .master_control import allowed_operator_dsn

MAX_UPLOAD=524288
MAX_BODY=710000
SCHEMA='tradevice.trading.skill.v1'
class SkillError(ValueError):
    def __init__(self,code,status=422):self.code,self.status=code,status;super().__init__(code)

def clean_text(value,label,limit):
    if not isinstance(value,str) or not value.strip() or len(value)>limit or any(ord(c)<32 for c in value):
        raise SkillError('SKILL_INVALID_'+label)
    return value.strip()

def json_object(raw):
    def unique(pairs):
        d={}
        for k,v in pairs:
            if k in d:raise SkillError('SKILL_DUPLICATE_JSON_KEY')
            d[k]=v
        return d
    try:
        obj=json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _:(_ for _ in ()).throw(SkillError('SKILL_NONFINITE_JSON')))
    except (ValueError,UnicodeError,RecursionError):raise SkillError('SKILL_INVALID_JSON') from None
    if not isinstance(obj,dict):raise SkillError('SKILL_INVALID_JSON')
    return obj

def manifest(raw):
    m=json_object(raw)
    if set(m)-{'schema','name','version','description','strategy','documentation'} or m.get('schema')!=SCHEMA:
        raise SkillError('SKILL_MANIFEST_SCHEMA_INVALID')
    out={k:clean_text(m.get(k),k.upper(),n) for k,n in [('name',80),('version',32),('description',500)]}
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._+-]{0,31}',out['version']):raise SkillError('SKILL_INVALID_VERSION')
    out['schema']=SCHEMA
    out['strategy']=clean_text(m.get('strategy','CUSTOM_RESEARCH'),'STRATEGY',80)
    doc=m.get('documentation','')
    if not isinstance(doc,str) or len(doc)>65536 or '\x00' in doc:raise SkillError('SKILL_DOCUMENT_TOO_LARGE')
    out['documentation']=doc
    return out

def parse_upload(filename,encoded):
    filename=clean_text(filename,'FILENAME',120)
    if '/' in filename or '\\' in filename or filename.startswith('.'):raise SkillError('SKILL_FILENAME_INVALID')
    if not isinstance(encoded,str) or len(encoded)>699052:raise SkillError('SKILL_UPLOAD_TOO_LARGE',413)
    try:raw=base64.b64decode(encoded,validate=True)
    except (ValueError,TypeError):raise SkillError('SKILL_ENCODING_INVALID') from None
    if not raw or len(raw)>MAX_UPLOAD:raise SkillError('SKILL_UPLOAD_TOO_LARGE',413)
    if filename.lower().endswith('.json'):
        m=manifest(raw);kind='MANIFEST'
    elif filename.lower().endswith('.zip'):
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                info=z.infolist()
                if not info or len(info)>64:raise SkillError('SKILL_ARCHIVE_FILE_LIMIT')
                seen=set();files={};total=0
                for f in info:
                    p=PurePosixPath(f.filename)
                    if (p.is_absolute() or '..' in p.parts or '\\' in f.filename or ':' in f.filename or
                        f.filename.lower() in seen or f.flag_bits&1 or stat.S_ISLNK(f.external_attr>>16)):
                        raise SkillError('SKILL_UNSAFE_ARCHIVE')
                    seen.add(f.filename.lower())
                    if f.is_dir():continue
                    total+=f.file_size
                    if total>2097152 or f.file_size>524288 or f.file_size>max(1,f.compress_size)*100:
                        raise SkillError('SKILL_ARCHIVE_EXPANSION_LIMIT')
                    if p.suffix.lower() not in {'.md','.json','.py','.txt','.yaml','.yml','.csv'}:
                        raise SkillError('SKILL_ARCHIVE_FILE_TYPE')
                    content=z.read(f).decode('utf-8-sig')
                    if '\x00' in content:raise SkillError('SKILL_ARCHIVE_BINARY_FILE')
                    files[f.filename]=content
                docs=[v for k,v in files.items() if PurePosixPath(k).name.upper()=='SKILL.MD']
                manifests=[v for k,v in files.items() if PurePosixPath(k).name.lower()=='manifest.json']
                if len(docs)!=1 or len(manifests)>1:raise SkillError('SKILL_ARCHIVE_REQUIRES_ONE_SKILL_MD')
                if len(docs[0])>65536:raise SkillError('SKILL_DOCUMENT_TOO_LARGE')
                if manifests:m=manifest(manifests[0]);kind='MANIFEST'
                else:
                    heading=re.search(r'^#\s+(.+)$',docs[0],re.M)
                    name=(heading.group(1) if heading else filename[:-4])[:80]
                    m=dict(schema=SCHEMA,name=clean_text(name,'NAME',80),version='unversioned',description='Uploaded SKILL.md package; execution review pending.',strategy='CUSTOM_RESEARCH')
                    kind='DOCUMENT'
                m['documentation']=docs[0]
        except SkillError:raise
        except (zipfile.BadZipFile,NotImplementedError,RuntimeError,UnicodeError,ValueError,OSError):
            raise SkillError('SKILL_ARCHIVE_INVALID') from None
    else:raise SkillError('SKILL_JSON_OR_ZIP_REQUIRED')
    return dict(filename=filename,raw=raw,sha256=hashlib.sha256(raw).hexdigest(),manifest=m,kind=kind)

def validate_request(p):
    if not isinstance(p,dict):raise SkillError('SKILL_REQUEST_INVALID')
    try:actor=UUID(str(p.get('actor_id')))
    except (ValueError,TypeError):raise SkillError('SKILL_ACTOR_INVALID') from None
    if actor.int==0:raise SkillError('SKILL_ACTOR_INVALID')
    if p.get('action')=='UPLOAD' and set(p)=={'actor_id','action','filename','contentBase64'}:
        return actor,parse_upload(p['filename'],p['contentBase64'])
    if p.get('action')=='SELECT' and set(p)=={'actor_id','action','skillId','expectedRevision'}:
        if type(p['expectedRevision']) is not int or not 0<=p['expectedRevision']<=2**53-1:raise SkillError('SKILL_REVISION_INVALID')
        try:uid=UUID(p['skillId']) if p['skillId'] is not None else None
        except (ValueError,TypeError,AttributeError):raise SkillError('SKILL_ID_INVALID') from None
        return actor,uid
    raise SkillError('SKILL_REQUEST_INVALID')

def catalog(conn):
    state=conn.execute('SELECT selected_skill_id,revision FROM master_skills.selection WHERE singleton=true').fetchone()
    if state is None:raise RuntimeError('SKILL_STATE_MISSING')
    rows=conn.execute('''SELECT id,name,version,description,strategy,kind,sha256,created_at,
        manifest->>'documentation' AS documentation FROM master_skills.packages ORDER BY created_at,id LIMIT 50''').fetchall()
    return dict(revision=state['revision'],selectedSkillId=str(state['selected_skill_id']) if state['selected_skill_id'] else None,
        executionAuthorized=False,selectionScope='STAGING_CONFIGURATION_ONLY',
        skills=[dict(id=str(r['id']),name=r['name'],version=r['version'],description=r['description'],strategy=r['strategy'],kind=r['kind'],sha256=r['sha256'],createdAt=r['created_at'].isoformat(),documentation=r['documentation'] or '',active=r['id']==state['selected_skill_id'],executionStatus='REQUIRES_ENGINE_APPROVAL') for r in rows])

def registry(dsn,payload=None):
    if not allowed_operator_dsn(dsn):raise RuntimeError('SKILL_STAGING_DSN_REQUIRED')
    parsed=validate_request(payload) if payload is not None else None
    with psycopg.connect(dsn,connect_timeout=5,options='-c statement_timeout=5000 -c lock_timeout=3000',row_factory=dict_row) as conn:
        if conn.execute('SELECT current_user AS role').fetchone()['role']!='tradevice_master_operator':raise RuntimeError('SKILL_OPERATOR_ROLE_REQUIRED')
        # One locked singleton serializes uploads and compare-and-swap selection.
        state=conn.execute('SELECT selected_skill_id,revision FROM master_skills.selection WHERE singleton=true FOR UPDATE').fetchone()
        if state is None:raise RuntimeError('SKILL_STATE_MISSING')
        if payload is not None:
            actor,item=parsed
            recent=conn.execute("SELECT count(*) AS n FROM master_skills.audit WHERE created_at>now()-interval '1 minute'").fetchone()['n']
            if recent>=10:raise SkillError('SKILL_RATE_LIMIT',429)
            if payload['action']=='UPLOAD':
                duplicate=conn.execute('SELECT id FROM master_skills.packages WHERE sha256=%s',(item['sha256'],)).fetchone()
                if duplicate:return dict(catalog(conn),uploadStatus='ALREADY_UPLOADED',uploadedSkillId=str(duplicate['id']))
                if conn.execute('SELECT count(*) AS n FROM master_skills.packages').fetchone()['n']>=50:raise SkillError('SKILL_CATALOG_FULL',409)
                m=item['manifest']
                if conn.execute('SELECT id FROM master_skills.packages WHERE name=%s AND version=%s',(m['name'],m['version'])).fetchone():raise SkillError('SKILL_VERSION_ALREADY_EXISTS',409)
                uid=conn.execute('''INSERT INTO master_skills.packages(name,version,description,strategy,kind,sha256,filename,archive,manifest,uploaded_by)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id''',(m['name'],m['version'],m['description'],m['strategy'],item['kind'],item['sha256'],item['filename'],item['raw'],Jsonb(m),actor)).fetchone()['id']
                conn.execute("INSERT INTO master_skills.audit(actor_id,action,skill_id,revision) VALUES (%s,'UPLOAD',%s,%s)",(actor,uid,state['revision']))
                return dict(catalog(conn),uploadStatus='UPLOADED',uploadedSkillId=str(uid))
            if state['revision']!=payload['expectedRevision']:raise SkillError('SKILL_REVISION_CONFLICT',409)
            if item and not conn.execute('SELECT id FROM master_skills.packages WHERE id=%s',(item,)).fetchone():raise SkillError('SKILL_NOT_FOUND',404)
            if item!=state['selected_skill_id']:
                conn.execute('UPDATE master_skills.selection SET selected_skill_id=%s,revision=revision+1,updated_by=%s,updated_at=now() WHERE singleton=true',(item,actor))
                conn.execute("INSERT INTO master_skills.audit(actor_id,action,skill_id,previous_skill_id,revision) VALUES (%s,'SELECT',%s,%s,%s)",(actor,item,state['selected_skill_id'],state['revision']+1))
        return catalog(conn)
