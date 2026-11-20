"""Create Block 9_nhom_4.zip with source/evidence and exclude live secrets/state."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from urllib.parse import urlparse, unquote, quote
from hashlib import sha256
import json
import re
import sys

root = Path(__file__).resolve().parents[1]
destination = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root.parent / 'Block 9_nhom_4.zip'
if destination.exists(): raise RuntimeError('Archive already exists; choose a new output path rather than overwrite it.')
blocked = {'node_modules', '.git', 'data', 'dist', 'dist-e2e', 'test-results', '__pycache__', 'certs', 'playwright-report'}
files = set()
for folder in ['api/src', 'api/test', 'api/scripts', 'api/migrations', 'web/src', 'web/public', 'shared', 'tests', 'docs']:
    for path in (root / folder).rglob('*'):
        if path.is_file() and not any(part in blocked for part in path.relative_to(root).parts): files.add(path)
for name in ['package.json','package-lock.json','.gitignore','README.md','HUONG_DAN_NOP_BAI.txt','playwright.config.ts',
             'api/package.json','api/.env.example','web/package.json','web/.env.example','web/index.html',
             'web/tsconfig.json','web/vite.config.ts','web/server.js','web/test-server.js','web/README.md',
             'scripts/package-block9.py','scripts/build-block9-report.py']:
    path = root / name
    if not path.is_file(): raise RuntimeError('Missing source file: '+name)
    files.add(path)
for path in (root / 'api/reports').glob('*.json'):
    if 'checkpoint' not in path.name: files.add(path)
required = ['docs/BAO_CAO_BLOCK9.html','docs/BLOCK9-NHOM4.md','docs/evidence/api-acceptance.json','docs/evidence/runtime-check.json','docs/flow-login.svg']
for name in required:
    if root / name not in files: raise RuntimeError('Missing evidence: '+name)
api = json.loads((root / 'docs/evidence/api-acceptance.json').read_text(encoding='utf-8'))
browser = list((root / 'docs/evidence/browser').glob('*.json'))
if api['total'] != api['passed'] or len(browser) != 9: raise RuntimeError('Acceptance evidence is incomplete')
if any(json.loads(path.read_text(encoding='utf-8'))['status'] != 'passed' or not path.with_suffix('.png').exists() for path in browser):
    raise RuntimeError('Browser evidence has a failed case or missing image')

secrets = set()
for env in [root / 'api/.env', root / 'web/.env', root / '.env']:
    if not env.exists(): continue
    for line in env.read_text(encoding='utf-8-sig').splitlines():
        if line.lstrip().startswith('#') or '=' not in line: continue
        key, value = line.split('=', 1); value = value.strip().strip('\"\'')
        if re.search(r'KEY|TOKEN|SECRET|PASS|DATABASE_URL', key, re.I) and len(value) >= 8:
            secrets.add(value.encode())
            if key.strip() == 'SMTP_PASS': secrets.add(re.sub(r'\s+', '', value).encode())
            try:
                password = urlparse(value).password
                if password and len(unquote(password)) >= 8:
                    secrets.add(password.encode()); secrets.add(unquote(password).encode()); secrets.add(quote(unquote(password), safe='').encode())
            except ValueError: pass
for path in (root / 'api/data').glob('*.key'):
    value = path.read_bytes().strip()
    if len(value) >= 16: secrets.add(value)

def validate(path, data):
    relative = path.relative_to(root)
    if path.name == '.env' or path.suffix.lower() in {'.key','.sqlite','.db','.pem','.crt','.zip','.har','.log'} or any(part in blocked for part in relative.parts):
        raise RuntimeError('Excluded state file selected: '+relative.as_posix())
    if any(secret and secret in data for secret in secrets): raise RuntimeError('Live secret detected; archive was not written: '+relative.as_posix())
    if path.suffix.lower() in {'.html','.json','.md','.txt','.js','.ts','.tsx','.py','.sql'}:
        text = data.decode('utf-8', errors='ignore')
        if re.search(r'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}', text):
            raise RuntimeError('Unredacted JWT found: '+relative.as_posix())

manifest = []
for path in sorted(files):
    data = path.read_bytes(); validate(path, data)
    manifest.append({'path':path.relative_to(root).as_posix(),'bytes':len(data),'sha256':sha256(data).hexdigest()})
destination.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(destination, 'x', ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(files): archive.write(path, 'Block 9_nhom_4/' + path.relative_to(root).as_posix())
    archive.writestr('Block 9_nhom_4/MANIFEST.json', json.dumps({'name':'Block 9_nhom_4','date':'2026-11-13','files':manifest,'liveSecretScan':'passed','excluded':['.env','keys','database','mailbox','node_modules','build','raw traces']}, ensure_ascii=False, indent=2))
with ZipFile(destination) as archive:
    if archive.testzip() is not None: raise RuntimeError('ZIP integrity check failed')
    for item in manifest:
        data = archive.read('Block 9_nhom_4/' + item['path'])
        if sha256(data).hexdigest() != item['sha256']: raise RuntimeError('Manifest mismatch')
        validate(root / item['path'], data)
print(json.dumps({'archive':str(destination),'files':len(files)+1,'sizeKB':round(destination.stat().st_size/1024,1),'integrity':'passed','liveSecretScan':'passed'}))
