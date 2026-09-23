"""
Helper library to interact with n8n Cloud via MCP endpoint.
Instance: https://roigdecoure.app.n8n.cloud
"""

import json
import urllib.request
import os

N8N_URL = "https://roigdecoure.app.n8n.cloud/mcp-server/http"
N8N_TOKEN = os.environ.get(
    "N8N_MCP_TOKEN",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlOTQyNmFjZi1mODlmLTQ1Y2ItOTg2ZC1lZmQ4NTBkOTA1OWMiLCJpc3MiOiJuOG4iLCJhdWQiOiJtY3Atc2VydmVyLWFwaSIsImp0aSI6IjA2YmQ4MDY3LTZmMzctNDEzYS1hNzhjLTRhMjc1NjE4NDM3ZiIsImlhdCI6MTc5MDE5MzQwM30.pmxr75djAfx9avyPEDemc2Uw-uTKL16OcsE4WbR3z0s"
)

def call_n8n_mcp(method: str, params: dict = None, request_id: int = 1) -> dict:
    headers = {
        "Authorization": f"Bearer {N8N_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream"
    }
    payload = {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params or {}
    }
    req = urllib.request.Request(
        N8N_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST"
    )
    with urllib.request.urlopen(req) as resp:
        raw = resp.read().decode("utf-8")
        for line in raw.split("\n"):
            if line.startswith("data: "):
                return json.loads(line[6:])
    return {}

def call_tool(tool_name: str, arguments: dict = None) -> dict:
    return call_n8n_mcp("tools/call", {
        "name": tool_name,
        "arguments": arguments or {}
    })

def list_tools() -> list:
    res = call_n8n_mcp("tools/list", {})
    return res.get("result", {}).get("tools", [])

def search_workflows(query: str = "") -> dict:
    res = call_tool("search_workflows", {"query": query} if query else {})
    return res.get("result", {}).get("structuredContent", {})

def search_projects() -> dict:
    res = call_tool("search_projects", {})
    return res.get("result", {}).get("structuredContent", {})

if __name__ == "__main__":
    print("Connecting to n8n MCP...")
    projects = search_projects()
    print("Projects:", projects)
    wf = search_workflows()
    print("Workflows:", wf)
