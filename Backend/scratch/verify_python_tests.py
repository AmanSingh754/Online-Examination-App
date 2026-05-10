
import sys
import subprocess
import os

# Solutions from coding-judge-regression.js
SOLUTIONS = {
    1: """class Solution:
    def reverseString(self, s):
        return s[::-1]
""",
    2: """class Solution:
    def numberPyramid(self, n):
        lines = []
        for i in range(1, n + 1):
            left = ''.join(str(x) for x in range(1, i + 1))
            right = ''.join(str(x) for x in range(i - 1, 0, -1))
            spaces = ' ' * (n - i)
            lines.append(spaces + left + right)
        return '\\n'.join(lines)
""",
    3: """class Solution:
    def twoSum(self, numbers, target):
        left, right = 0, len(numbers) - 1
        while left < right:
            total = numbers[left] + numbers[right]
            if total == target:
                return [left + 1, right + 1]
            if total < target:
                left += 1
            else:
                right -= 1
        return []
"""
}

# The wrapper logic from Backend/routes/exam.routes.js (buildPythonLeetCodeWrapper)
def build_wrapper(question_id, user_code):
    wrapper_template = f"""
import sys as __lc_sys
import json as __lc_json
import ast as __lc_ast
import re as __lc_re

{user_code}

def __lc_parse_q1(raw):
    return raw.rstrip("\\n").rstrip("\\r")

def __lc_parse_q2(raw):
    value = raw.strip()
    return int(value) if value else 0

def __lc_parse_q3(raw):
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    if len(lines) >= 2:
        return __lc_ast.literal_eval(lines[0]), int(lines[1])
    numbers_match = __lc_re.search(r'numbers\\s*=\\s*(\\[[^\\]]*\\])', raw)
    target_match = __lc_re.search(r'target\\s*=\\s*(-?\\d+)', raw)
    if not numbers_match or not target_match:
        raise ValueError("Invalid testcase input for twoSum")
    return __lc_ast.literal_eval(numbers_match.group(1)), int(target_match.group(1))

def __lc_args(question_id, raw):
    if question_id == 1:
        return (__lc_parse_q1(raw),)
    if question_id == 2:
        return (__lc_parse_q2(raw),)
    if question_id == 3:
        return __lc_parse_q3(raw)
    return (raw,)

def __lc_format(value):
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(str(item) for item in value) + "]"
    return str(value)

def __lc_pick_callable():
    if 'Solution' in globals():
        sol = globals()['Solution']()
        methods = [m for m in dir(sol) if not m.startswith('__') and callable(getattr(sol, m))]
        if methods:
            return getattr(sol, methods[0])
    for name, obj in globals().items():
        if not name.startswith('__') and callable(obj) and name != 'Solution':
            return obj
    return None

def __lc_main():
    raw = __lc_sys.stdin.read()
    fn = __lc_pick_callable()
    if fn is None:
        return
    result = fn(*__lc_args({question_id}, raw))
    formatted = __lc_format(result)
    if formatted is not None:
        print(formatted)

if __name__ == "__main__":
    __lc_main()
"""
    return wrapper_template

def normalize_output(value, question_id):
    # normalizeCodeExecutionOutput
    normalized = value.replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    
    if question_id == 2:
        return "\n".join([line.replace(" ", "") for line in normalized.split("\n")])
    
    return normalized

def test_question(qid, input_str, expected_output):
    code = SOLUTIONS[qid]
    wrapped_code = build_wrapper(qid, code)
    
    with open("temp_test.py", "w") as f:
        f.write(wrapped_code)
    
    process = subprocess.Popen(["python3", "temp_test.py"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    stdout, stderr = process.communicate(input=input_str)
    
    if stderr:
        print(f"Error in Q{qid}: {stderr}")
        return False
    
    actual_output = normalize_output(stdout, qid)
    expected_normalized = normalize_output(expected_output, qid)
    
    if actual_output == expected_normalized:
        print(f"Q{qid} PASSED")
        return True
    else:
        print(f"Q{qid} FAILED")
        print(f"  Input: {input_str!r}")
        print(f"  Expected: {expected_normalized!r}")
        print(f"  Actual:   {actual_output!r}")
        return False

print("Starting Python Test Verification...")
test_question(1, "hello", "olleh")
test_question(2, "3", "  1\n 121\n12321")
test_question(3, "[2,7,11,15]\n9", "[1,2]")

os.remove("temp_test.py")
