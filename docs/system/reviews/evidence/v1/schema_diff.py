"""Compare openapi.yaml component schemas (converted to JSON) with interfaces in types.ts.
Crude TS parser: handles `export interface X extends A, B { field?: type; }` one level; nested braces skipped."""
import json, re, sys
spec = json.load(open(sys.argv[1]))
ts = open(sys.argv[2]).read()
S = spec['components']['schemas']

def resolve(s, seen=()):
    """Return (props:set, required:set, nullable map)"""
    if '$ref' in s:
        return resolve(S[s['$ref'].split('/')[-1]])
    props, req = {}, set()
    for part in s.get('allOf', []):
        p, r = resolve(part); props.update(p); req |= r
    for k, v in s.get('properties', {}).items():
        props[k] = v
    req |= set(s.get('required', []))
    return props, req

# parse TS interfaces
ifaces = {}
for m in re.finditer(r'export interface (\w+)(?: extends ([^{]+))?\s*\{', ts):
    name, ext = m.group(1), m.group(2)
    i = m.end(); depth = 1; body_start = i
    while depth:
        c = ts[i]
        if c == '{': depth += 1
        elif c == '}': depth -= 1
        i += 1
    body = ts[body_start:i-1]
    # remove comments
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S); body = re.sub(r'//.*', '', body)
    # top-level fields only
    fields = {}; depth = 0; buf = ''
    for c in body:
        if c in '{(<[': depth += 1
        if c in '})>]': depth -= 1
        if c == ';' and depth == 0:
            fm = re.match(r'\s*(\w+)(\??)\s*:\s*(.*)', buf, re.S)
            if fm: fields[fm.group(1)] = (fm.group(2) == '?', ' '.join(fm.group(3).split()))
            buf = ''
        else:
            buf += c
    exts = [e.strip() for e in re.split(r',(?![^<]*>)', ext)] if ext else []
    ifaces[name] = (fields, exts)

def ts_fields(name):
    f, exts = ifaces[name]
    out = {}
    for e in exts:
        base = re.match(r'(\w+)', e).group(1)
        if base in ifaces and '<' not in e: out.update(ts_fields(base))
    out.update(f)
    return out

for name in sorted(ifaces):
    if name not in S:
        print(f'TS-only interface (no schema): {name}'); continue
    tf = ts_fields(name)
    props, req = resolve(S[name])
    only_ts = set(tf) - set(props); only_api = set(props) - set(tf)
    opt_mismatch = [k for k in set(tf) & set(props) if tf[k][0] == (k in req)]
    if only_ts or only_api or opt_mismatch:
        print(f'{name}:')
        if only_ts: print('   in types.ts only :', sorted(only_ts))
        if only_api: print('   in openapi only  :', sorted(only_api), ' required:', sorted(only_api & req))
        if opt_mismatch: print('   optional/required differ:', sorted(opt_mismatch))
