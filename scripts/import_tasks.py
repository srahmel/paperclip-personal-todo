"""Run-scoped HTTP fallback for Paperclip collectors; reads existing agent credentials only.

python import_tasks.py list
python import_tasks.py upsert --payload /path/to/tasks.json
python import_tasks.py report --payload /path/to/source-status.json
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['list', 'upsert', 'report'])
    parser.add_argument('--payload', type=Path)
    args = parser.parse_args()
    base = os.environ.get('PAPERCLIP_API_URL', '').rstrip('/')
    company = os.environ.get('PAPERCLIP_COMPANY_ID', '')
    key = os.environ.get('PAPERCLIP_API_KEY', '')
    if not base or not company or not key:
        parser.error('PAPERCLIP_API_URL, PAPERCLIP_COMPANY_ID und PAPERCLIP_API_KEY müssen im Agentenlauf vorhanden sein. Keine Schlüssel als Argument übergeben.')
    url = base + '/api/plugins/srahmel.personal-todo/api/board'
    headers = {'Authorization': 'Bearer ' + key}
    run_id = os.environ.get('PAPERCLIP_RUN_ID')
    if run_id:
        headers['X-Paperclip-Run-Id'] = run_id
    body = None
    if args.command == 'list':
        from urllib.parse import urlencode
        url += '?' + urlencode({'companyId': company})
    else:
        if not args.payload:
            parser.error('--payload fehlt.')
        value = json.loads(args.payload.read_text(encoding='utf-8'))
        if not isinstance(value, dict):
            parser.error('Payload muss ein JSON-Objekt sein.')
        value.update(companyId=company, op='ingest' if args.command == 'upsert' else 'report')
        body = json.dumps(value, ensure_ascii=False).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=body, headers=headers, method='GET' if body is None else 'POST')
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        # Show the plugin's bounded validation message, never request headers or raw bodies.
        message = 'Paperclip hat den Zugriff abgelehnt oder konnte die Aktion nicht speichern.'
        try:
            detail = json.loads(error.read(8192)).get('error')
            if isinstance(detail, str) and len(detail) <= 1000:
                message = detail
        except (ValueError, AttributeError):
            pass
        print(json.dumps({'error': message, 'status': error.code}, ensure_ascii=False), file=sys.stderr)
        return 1
    except urllib.error.URLError:
        print('Paperclip ist aus diesem Agentenlauf nicht erreichbar.', file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
