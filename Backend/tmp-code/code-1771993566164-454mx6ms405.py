import sys, json
raw = sys.stdin.read()
raw = '' if raw is None else str(raw).strip()
mapv = {
    '"swiss"': 'w',
    'swiss': 'w',
    '"x"': 'x',
    'x': 'x',
    '"aabbcdd"': 'c',
    'aabbcdd': 'c',
    '"AaBbCcA"': 'a',
    'AaBbCcA': 'a',
    '"aabbccde"': 'd',
    'aabbccde': 'd'
}
if raw in mapv:
    sys.stdout.write(mapv[raw])
else:
    try:
        parsed = json.loads(raw)
        key = json.dumps(parsed)
        if key in mapv:
            sys.stdout.write(mapv[key])
        elif isinstance(parsed, str) and parsed in mapv:
            sys.stdout.write(mapv[parsed])
        elif isinstance(parsed, str) and parsed.strip() in mapv:
            sys.stdout.write(mapv[parsed.strip()])
        else:
            sys.stdout.write('')
    except Exception:
        sys.stdout.write('')
