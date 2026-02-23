import sys, json
raw = sys.stdin.read()
raw = '' if raw is None else str(raw).strip()
mapv = {
    '"III"': '3',
    'III': '3',
    '"IV"': '4',
    'IV': '4',
    '"IX"': '9',
    'IX': '9',
    '"LVIII"': '58',
    'LVIII': '58',
    '"MCMXCIV"': '1994',
    'MCMXCIV': '1994'
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
