import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

data = urllib.request.urlopen('http://localhost:4000/api/vocabulary').read()
entries = json.loads(data)['entries'][:2]

for entry in entries:
    print(f"{entry['english']} -> {entry['bengali']}")
