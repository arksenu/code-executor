"""
Open-WebUI Tool: Code Interpreter
==================================

This tool enables code execution capabilities in Open-WebUI chat interfaces.
It connects to the Code Interpreter API to run Python, Node.js, Ruby, and PHP
code in secure Docker containers.

SETUP INSTRUCTIONS:
1. Ensure Code Interpreter API is running: docker compose --profile runners up -d
2. Copy this entire file content
3. In Open-WebUI: Settings → Workspace → Tools → New Tool
4. Paste the content and save with name "Code Interpreter"
5. Enable the tool in your chat sessions

IMPORTANT: If Open-WebUI is running in Docker, change the api_url below from
'localhost' to 'host.docker.internal' to access the host machine's ports.

Functions available in chat:
- run_python(code): Execute Python code
- run_javascript(code): Execute Node.js code  
- run_ruby(code): Execute Ruby code
- run_php(code): Execute PHP code
- execute_code(code, language): Generic execution

Author: Code Interpreter API Integration
Version: 1.0.0
"""

import json
import requests
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field


class Tools:
    class Valves(BaseModel):
        api_url: str = Field(
            default="http://localhost:8080/v1/runs",
            description="Code Interpreter API endpoint"
        )
        api_key: str = Field(
            default="dev_123",
            description="API authentication token"
        )

    def __init__(self):
        self.valves = self.Valves()

    def execute_code(
        self,
        code: str,
        language: str = "python",
        __user__: Optional[dict] = None
    ) -> str:
        """
        Execute code in a sandboxed environment.
        
        :param code: The code to execute
        :param language: Programming language (python, node, ruby, php)
        :return: Execution results including output and any errors
        """
        
        headers = {
            "Authorization": f"Bearer {self.valves.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "language": language,
            "code": code
        }
        
        try:
            response = requests.post(
                self.valves.api_url,
                headers=headers,
                json=payload,
                timeout=30
            )
            response.raise_for_status()
            
            result = response.json()
            
            # Format the output nicely
            output_parts = []
            
            if result.get("status") == "succeeded":
                output_parts.append("✅ Execution successful")
            else:
                output_parts.append(f"❌ Execution {result.get('status', 'failed')}")
            
            if result.get("stdout"):
                output_parts.append(f"\n📤 Output:\n```\n{result['stdout']}```")
            
            if result.get("stderr"):
                output_parts.append(f"\n⚠️ Errors:\n```\n{result['stderr']}```")
            
            if result.get("exit_code") is not None:
                output_parts.append(f"\n🔢 Exit code: {result['exit_code']}")
            
            return "\n".join(output_parts)
            
        except requests.exceptions.Timeout:
            return "⏱️ Code execution timed out (30 seconds limit)"
        except requests.exceptions.ConnectionError:
            return "❌ Could not connect to Code Interpreter API. Make sure it's running on http://localhost:8080"
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 401:
                return "🔐 Authentication failed. Check API key configuration."
            elif e.response.status_code == 429:
                return "⏸️ Rate limited. Please wait before trying again."
            else:
                return f"❌ API error: {e.response.status_code} - {e.response.text}"
        except Exception as e:
            return f"❌ Unexpected error: {str(e)}"

    def run_python(self, code: str, __user__: Optional[dict] = None) -> str:
        """
        Execute Python code in a sandboxed environment.
        
        :param code: Python code to execute
        :return: Execution results
        """
        return self.execute_code(code, "python", __user__)

    def run_javascript(self, code: str, __user__: Optional[dict] = None) -> str:
        """
        Execute JavaScript/Node.js code in a sandboxed environment.
        
        :param code: JavaScript code to execute
        :return: Execution results
        """
        return self.execute_code(code, "node", __user__)

    def run_ruby(self, code: str, __user__: Optional[dict] = None) -> str:
        """
        Execute Ruby code in a sandboxed environment.
        
        :param code: Ruby code to execute
        :return: Execution results
        """
        return self.execute_code(code, "ruby", __user__)

    def run_php(self, code: str, __user__: Optional[dict] = None) -> str:
        """
        Execute PHP code in a sandboxed environment.
        
        :param code: PHP code to execute
        :return: Execution results
        """
        return self.execute_code(code, "php", __user__)
