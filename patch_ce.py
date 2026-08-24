import re

with open('backend/src/services/confidenceEngine.ts', 'r') as f:
    content = f.read()

# Replace threshold = 55; with threshold = 60;
content = re.sub(r'threshold = 55;', r'threshold = 60;', content)

with open('backend/src/services/confidenceEngine.ts', 'w') as f:
    f.write(content)

print("Patched confidenceEngine successfully")
