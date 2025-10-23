#!/usr/bin/env python3
"""
Code Executor API Test Script
==============================

This is a standalone test script for the Code Executor API.
Use this to verify the API is working correctly without needing Open-WebUI.

USAGE:
1. Ensure the Code Executor API is running:
   docker compose --profile runners up -d

2. Run this script:
   python3 test_tool.py

3. Expected output:
   - Python code execution results
   - Node.js code execution results  
   - Complex Python example with JSON output

This script tests the API endpoints directly using the requests library.
It's useful for:
- Debugging API connectivity issues
- Testing after API changes
- Verifying the setup before Open-WebUI integration
- Understanding the API request/response format

Default configuration:
- API URL: http://localhost:8080/v1/runs
- API Key: dev_123 (development key)

Modify the constants below if your setup differs.
"""

import requests
import json
import sys

API_URL = "http://localhost:8080/v1/runs"
API_KEY = "dev_123"

def execute_code(language, code):
    """Execute code using the Code Executor API"""
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "language": language,
        "code": code
    }
    
    try:
        response = requests.post(API_URL, headers=headers, json=payload)
        response.raise_for_status()
        result = response.json()
        
        print(f"Status: {result['status']}")
        if result.get('stdout'):
            print(f"Output:\n{result['stdout']}")
        if result.get('stderr'):
            print(f"Errors:\n{result['stderr']}")
        
        return result
    except requests.exceptions.RequestException as e:
        print(f"Error: {e}")
        return None

if __name__ == "__main__":
    # Test examples
    print("=== Testing Code Executor API ===\n")
    
    # Test 1: Python
    print("Test 1: Python")
    execute_code("python", "print('Hello from Python!')\nprint(2 + 2)")
    print("\n" + "="*40 + "\n")
    
    # Test 2: Node.js
    print("Test 2: Node.js")
    execute_code("node", "console.log('Hello from Node.js!');\nconsole.log(3 * 3);")
    print("\n" + "="*40 + "\n")
    
    # Test 3: More complex Python
    print("Test 3: Complex Python")
    code = """
import random
import json

data = {
    "numbers": [random.randint(1, 100) for _ in range(5)],
    "sum": sum([random.randint(1, 100) for _ in range(5)])
}

print(json.dumps(data, indent=2))
"""
    execute_code("python", code)
