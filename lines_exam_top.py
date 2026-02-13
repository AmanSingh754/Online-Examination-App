with open('frontend-react/src/pages/Exam.jsx', encoding='utf-8') as f:
    for idx, line in enumerate(f, 1):
        if 1 <= idx <= 80:  # just show first 80 lines with numbers
            print(f"{idx}: {line.rstrip()}" )
Microsoft.QuickAction.WiFi