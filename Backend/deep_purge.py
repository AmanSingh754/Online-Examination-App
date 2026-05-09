import os
import re

path = '/Users/aman/Downloads/EXAM PORTAL - Copy/Backend/routes/admin.routes.js'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    # If line contains relation names that don't exist
    if 'bdes' in line.lower() or 'regular_exams' in line.lower() or 'regular_student_results' in line.lower():
        # Comment out or replace with dummy
        if 'queryAsync' in line:
            new_lines.append('            Promise.resolve([]), // stubbed\n')
        elif 'db.query' in line:
            new_lines.append('        Promise.resolve([]), // stubbed\n')
        else:
            new_lines.append(f'// {line}')
    else:
        new_lines.append(line)

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
