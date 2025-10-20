import os
import json
import requests

from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional, Literal, Dict, Any

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/api/chat")
MODEL_NAME = os.getenv("MODEL_NAME", "codepilot-qwen2_5-coder-7b-instruct")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Message(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str

class ChatPayload(BaseModel):
    prompt: str = Field(default="")
    code: Optional[str] = None
    filename: Optional[str] = None
    task: Literal["general","explain","fix","docstring","refactor","review","optimize","testgen","translate","generate"] = "general"
    history: Optional[List[Message]] = None
    stream: bool = False

TASK_PROMPTS: Dict[str, str] = {
    "general":   "Solve the request precisely. If anything is ambiguous, ask one clarifying question, otherwise produce the final result.",
    "explain":   "Explain the code briefly, focusing on intent, complexity hotspots, and pitfalls. Give a short actionable summary.",
    "fix":       "Find the minimal change to make the code correct, safe, and passing. Return fixed code only, no explanation.",
    "docstring": "Add or improve docstrings and type hints. Preserve behavior. Return the complete updated code.",
    "refactor":  "Refactor for clarity, testability, and performance without changing the public API. Return the complete updated code.",
    "review":    "Perform a concise code review: correctness, security, complexity, naming, tests, edge cases. Give a prioritized checklist.",
    "optimize":  "Optimize for readability and performance, remove dead code, keep behavior. Return the complete updated code.",
    "testgen":   "Add or improve tests covering edge cases and error paths. Use deterministic seeds. Return tests only unless otherwise asked.",
    "translate": "Translate code or text to the target language idiomatically while preserving semantics. Return only the translation.",
    "generate":  "Generate the requested artifact in the exact format asked, nothing else.",
}

SYSTEM_PROMPT = (
    "You are Codepilot, an offline coding copilot. Be correct, secure, and concise. "
    "Ask a brief clarifying question only if essential; otherwise deliver the final result. "
    "For fixes return code only. For refactors preserve public API. For docstrings add accurate types. "
    "Avoid chain-of-thought; provide results and brief bullet rationales only when asked. "
    "Honor exact output formats requested. Prefer standard libraries and deterministic examples."
)

def build_user_prompt(task: str, prompt: str, code: Optional[str], filename: Optional[str]) -> str:
    header = f"Task: {task}\nFile: {filename or 'unknown'}\n"
    ctx = f"\n---CODE START---\n{code}\n---CODE END---\n" if code else ""
    instruction = TASK_PROMPTS.get(task, TASK_PROMPTS["general"])
    return f"{instruction}\n{header}User request: {prompt}\n{ctx}\nRespond with the final result only."

def build_messages(p: ChatPayload) -> List[Dict[str, Any]]:
    msgs: List[Dict[str, str]] = []
    msgs.append({"role": "system", "content": SYSTEM_PROMPT})
    if p.history:
        for m in p.history:
            if m.role in ("user", "assistant", "system") and m.content:
                msgs.append({"role": m.role, "content": m.content})
    msgs.append({"role": "user", "content": build_user_prompt(p.task, p.prompt, p.code, p.filename)})
    return msgs

@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "ollama": OLLAMA_URL}

@app.post("/chat")
def chat(p: ChatPayload):
    try:
        r = requests.post(
            OLLAMA_URL,
            json={
                "model": MODEL_NAME,
                "messages": build_messages(p),
                "stream": False,
                "options": {
                    "temperature": 0.2,
                    "top_p": 0.9,
                    "top_k": 40,
                    "repeat_penalty": 1.05,
                    "num_ctx": 8192,
                    "stop": ["<|im_end|>"]
                },
            },
            timeout=300,
        )
        r.raise_for_status()
        data = r.json()
        return {"content": data.get("message", {}).get("content", "")}
    except requests.HTTPError as e:
        try:
            err = r.json()
        except Exception:
            err = {"detail": str(e)}
        raise HTTPException(status_code=getattr(e.response, "status_code", 500), detail=err)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat_stream")
def chat_stream(p: ChatPayload):
    def generator():
        try:
            with requests.post(
                OLLAMA_URL,
                json={
                    "model": MODEL_NAME,
                    "messages": build_messages(p),
                    "stream": True,
                    "options": {
                        "temperature": 0.2,
                        "top_p": 0.9,
                        "top_k": 40,
                        "repeat_penalty": 1.05,
                        "num_ctx": 8192,
                        "stop": ["<|im_end|>"]
                    },
                },
                stream=True,
                timeout=300,
            ) as r:
                r.raise_for_status()
                for line in r.iter_lines(decode_unicode=True):
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        yield line
                        continue
                    piece = obj.get("message", {}).get("content", "")
                    if piece:
                        yield piece
                    if obj.get("done"):
                        break
        except requests.HTTPError as e:
            msg = f"\n\n[Error {getattr(e.response, 'status_code', 500)}] {e}"
            yield msg
        except Exception as e:
            yield f"\n\n[Error] {e}"
    return StreamingResponse(generator(), media_type="text/plain")