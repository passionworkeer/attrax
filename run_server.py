import subprocess
import sys
import os

# Change to the project directory
os.chdir(r'D:\Data\Desktop\h\attrax')

# Run the server using the venv python with uvicorn
venv_python = r'D:\Data\Desktop\h\attrax\rag_service\.venv\Scripts\python.exe'

result = subprocess.run(
    [venv_python, '-m', 'uvicorn', 'rag_service.main:app', '--host', '127.0.0.1', '--port', '8000'],
    capture_output=True,
    text=True
)

print("STDOUT:", result.stdout)
print("STDERR:", result.stderr)