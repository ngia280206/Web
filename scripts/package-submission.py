"""Create a source-only submission ZIP, never include local secrets/datasets/builds."""
from pathlib import Path
from urllib.parse import urlparse, unquote
from zipfile import ZipFile, ZIP_DEFLATED
from shutil import copy2
import json
import re
import sys

root=Path(__file__).resolve().parents[1]
blocked={'node_modules','.git','data','dist','dist-e2e','test-results','__pycache__','certs'}
files=[]
for folder in ['api/src','api/test','api/scripts','api/migrations','web/src','web/public','shared','tests','docs']:
    for p in (root/folder).rglob('*'):
        if p.is_file() and not any(part in blocked for part in p.relative_to(root).parts): files.append(p)
for name in ['package.json','package-lock.json','playwright.config.ts','.gitignore','README.md','frontend_aesthetics_prompt.md','bao-cao-qua-trinh-lam-viec.html','api/package.json','api/.env.example','web/package.json','web/.env.example','web/index.html','web/tsconfig.json','web/vite.config.ts','web/server.js','web/test-server.js','web/README.md','api/reports/kaggle-dry-run.json','api/reports/kaggle-import-status.json']:
    p=root/name
    if not p.is_file(): raise RuntimeError('Missing required file: '+name)
    files.append(p)
files.append(Path(__file__).resolve())
files.append(root/'trinh-bay-quyet-dinh-va-bang-chung-nhom-4.html')
for name in ['kaggle-import.json','kaggle-images.json','kaggle-image-inventory.json','kaggle-verification.json','kaggle-browser-smoke.json','demo-menu-fill.json','demo-menu-verification.json','demo-chefs-fill.json','demo-chefs-verification.json','presentation-evidence-summary.json']:
    report=root/'api/reports'/name
    if report.is_file(): files.append(report)
tex=root/'bao-cao-qua-trinh-lam-viec.tex'
if tex.is_file(): files.append(tex)
secrets=[]
for p in [root/'api/.env',root/'web/.env',root/'.env']:
    if not p.exists(): continue
    for line in p.read_text(encoding='utf-8-sig').splitlines():
        if line.lstrip().startswith('#') or '=' not in line: continue
        key,value=line.split('=',1);value=value.strip().strip('\"\'')
        if re.search(r'KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL',key) and len(value)>=8:
            secrets.append(value.encode())
            try:
                password=urlparse(value).password
                if password and len(unquote(password))>=8: secrets.append(unquote(password).encode())
            except ValueError: pass
files=sorted(set(files))
for p in files:
    if p.name=='.env' or any(secret in p.read_bytes() for secret in secrets):
        raise RuntimeError('Secret scan failed; package not written.')
materialize='--folder' in sys.argv
submission=root/'NOP_BAI_NHOM_4'
destination=submission/'BepNha_Nhom4'
if materialize and submission.exists():
    raise RuntimeError('Submission folder already exists; refusing to overwrite it.')
if materialize: submission.mkdir()
archive=(submission if materialize else root)/'BepNha_Nhom4_PhanTrang_TimKiem.zip'
guide='''BEP NHA - NHOM 4 - PAGINATION / SEARCH EXTENSION

Node.js >=24. Python 3 is needed for Kaggle dry-run/import tests.
Quick demo (no Supabase key needed):
  npm install
  npm run dev
Open http://localhost:5173 . No .env defaults to a local demo database.
Choose pages / load more / infinite from the list controls.
If the API cannot be reached, click the button to open the browser demo (MSW).

Real Supabase: configure api/.env from api/.env.example, the correct Project URL/key,
PostgreSQL connection and a trusted CA certificate. Then run:
  npm run migrate -w api
  npm run check:supabase -w api

Cloud setup: Session Pooler + trusted CA; TLS verification remains enabled.
See api/reports/kaggle-import.json and kaggle-verification.json for actual results.
The dataset has 13,493 valid recipes; 13,463 have matching source images, 30 do not.
The group's cloud database is private to its project. Keys for another project do
not grant access to the group's data. Use the bundled independent demo without keys.
Kaggle CSV/images and all secrets are excluded from this ZIP.
Download the licensed dataset separately, provide --file for dry-run/import.
Dataset source/license attribution is in docs/CATALOG-EXTENSION.md.
Do not call a dry-run or mock response a successful cloud import.
Generated demo prices (15,000-225,000 VND) and 14 heuristic categories retain
synthetic flags and are labeled as demo. Eight fictional chefs, labeled demo, are
assigned by category. Their profiles/assignments are not original Kaggle data.
Ingredient quantities were not inferred.

Verification:
  npm test
  npm run build
  npx playwright install chromium
  npm run test:e2e

Report: bao-cao-qua-trinh-lam-viec.html (open in browser, supports PDF printing).
Decisions + submission evidence: trinh-bay-quyet-dinh-va-bang-chung-nhom-4.html.
This standalone HTML embeds screenshots, observed Network requests and SQL/bug evidence.
Detailed setup and limitations: README.md and docs/CATALOG-EXTENSION.md.
'''
with ZipFile(archive,'w',ZIP_DEFLATED,compresslevel=9) as z:
    for p in files: z.write(p,'BepNha_Nhom4/'+p.relative_to(root).as_posix())
    z.writestr('BepNha_Nhom4/HUONG_DAN_NOP_BAI.txt',guide)
with ZipFile(archive) as z:
    assert z.testzip() is None
    assert not any(secret in z.read(name) for name in z.namelist() for secret in secrets)
if materialize:
    destination.mkdir()
    for p in files:
        target=destination/p.relative_to(root)
        target.parent.mkdir(parents=True,exist_ok=True)
        copy2(p,target)
        assert target.read_bytes()==p.read_bytes()
    (destination/'HUONG_DAN_NOP_BAI.txt').write_bytes(guide.encode('utf-8'))
    materialized=[p for p in destination.rglob('*') if p.is_file()]
    assert len(materialized)==len(files)+1
    assert not any(p.name=='.env' or any(secret in p.read_bytes() for secret in secrets) for p in materialized)
    (submission/'DOC_TRUOC_KHI_NOP.txt').write_text('''BEP NHA - NHOM 4

Nop file BepNha_Nhom4_PhanTrang_TimKiem.zip cho giao vien.
Thu muc BepNha_Nhom4 la ban da giai nen, co cung ma nguon va bao cao.
Khong can nop ca ZIP va thu muc da giai nen cung luc.

Chay demo khong can key: vao BepNha_Nhom4, chay npm install, roi npm run dev.
Mo http://localhost:5173. Can Node.js >=24.
Huong dan chi tiet: BepNha_Nhom4/HUONG_DAN_NOP_BAI.txt va README.md.

Ban nop khong chua .env that, key, chung chi local, node_modules, database local,
CSV/anh nguon Kaggle, build va ket qua kiem thu tam.
Ma nguon, migration/import, test, bao cao HTML va bang chung duoc giu lai.
''',encoding='utf-8')
print(json.dumps({'archive':archive.relative_to(root).as_posix(),'folder':destination.relative_to(root).as_posix() if materialize else None,'files':len(files)+1,'sizeKB':round(archive.stat().st_size/1024,1),'secretScan':'passed','integrity':'passed','sourceCopies':'identical' if materialize else None}))
