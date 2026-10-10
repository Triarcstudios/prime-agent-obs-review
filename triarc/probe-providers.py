#!/usr/bin/env python3
"""Manual live-provider probes; never imported by CI, never prints credentials."""
import argparse
import concurrent.futures
import json
from pathlib import Path
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument('--command', default=str(Path(__file__).resolve().parent / 'pi-local'))
parser.add_argument('--output', required=True)
args = parser.parse_args()
matrix = [('openai-codex', 'gpt-6-astra'), ('xai', 'grok-4.6'),
          ('antigravity', 'gemini-3.7-flash'), ('openrouter', 'liquid/lfm-2.5-2.6b:free'),
          ('cerebras', 'gpt-oss-120b'), ('google', 'gemini-3.7-flash')]

def probe(pair):
    provider, model = pair
    start = time.monotonic()
    command = [args.command, '--offline', '--no-session', '-nc', '-ns', '-np', '--no-tools',
               '--system-prompt', 'Reply exactly OK.', '--provider', provider, '--model', model,
               '--thinking', 'low', '-p', 'Reply exactly OK.']
    try:
        with tempfile.TemporaryFile(mode='w+') as output, tempfile.TemporaryFile(mode='w+') as errors:
            result = subprocess.run(command, cwd='/tmp', stdout=output, stderr=errors, timeout=45)
            output.seek(0)
            ok = result.returncode == 0 and output.read().strip() in ('OK', 'OK.')
            record = dict(provider=provider, model=model, result='PASS' if ok else 'FAIL',
                          exit=result.returncode, seconds=round(time.monotonic() - start, 2))
    except subprocess.TimeoutExpired:
        record = dict(provider=provider, model=model, result='FAIL', reason='45 second timeout')
    print(json.dumps(record), flush=True)
    return record

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    results = list(pool.map(probe, matrix))
Path(args.output).write_text(json.dumps(results, indent=2) + '\n')
raise SystemExit(0 if all(r['result'] == 'PASS' for r in results) else 1)
