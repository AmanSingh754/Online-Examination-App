import os
import re

path = '/Users/aman/Downloads/EXAM PORTAL - Copy/Backend/routes/admin.routes.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace any occurrence of queryAsync( ... bdes ... )
content = re.sub(r'queryAsync\(\s*`[^`]*bdes[^`]*`[^)]*\)', 'Promise.resolve([])', content)

# Replace db.query( ... bdes ... ) with a dummy
# This matches the login part too
content = re.sub(r'db\.query\(\s*`[^`]*bdes[^`]*`[^)]*\)', '((...args) => { if(typeof args[args.length-1] === "function") args[args.length-1](null, []); })()', content)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
