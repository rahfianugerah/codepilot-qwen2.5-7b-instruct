import os
import json
import requests

from pydantic import BaseModel
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/api/chat")
MODEL_NAME = os.getenv("MODEL_NAME", "codepilot")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatPayload(BaseModel):
    prompt: str
    code: str | None = None
    filename: str | None = None
    task: str = "general"

TASK_PROMPTS = {
    "general":   "You are assisting with coding tasks.",
    "explain":   "Explain the code briefly and point out pitfalls.",
    "fix":       "Find bugs and propose a minimal fix. Return fixed code only.",
    "docstring": "Add/improve docstrings and type hints. Return full updated code.",
    "refactor":  "Refactor for clarity and performance. Keep public API.",
}

def build_user_prompt(task: str, prompt: str, code: str | None, filename: str | None) -> str:
    header = f"Task: {task}\nFile: {filename or 'unknown'}\n"
    ctx = f"\n---CODE START---\n{code}\n---CODE END---\n" if code else ""
    return (
        f"{TASK_PROMPTS.get(task, TASK_PROMPTS['general'])}\n"
        f"{header}"
        f"User request: {prompt}\n"
        f"{ctx}\n"
        f"Respond with final result only."
    )

@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "ollama": OLLAMA_URL}

@app.post("/chat")
def chat(p: ChatPayload):
    user_prompt = build_user_prompt(p.task, p.prompt, p.code, p.filename)
    try:
        r = requests.post(
            OLLAMA_URL,
            json={
                "model": MODEL_NAME,
                "messages": [
                    {"role": "system", "content": "You are Offline Copilot."},
                    {"role": "user", "content": user_prompt},
                ],
                "stream": False,
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
        raise HTTPException(status_code=r.status_code, detail=err)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat_stream")
def chat_stream(p: ChatPayload):
    user_prompt = build_user_prompt(p.task, p.prompt, p.code, p.filename)

    def generator():
        try:
            with requests.post(
                OLLAMA_URL,
                json={
                    "model": MODEL_NAME,
                    "messages": [
                        {"role": "system", "content": "You are Offline Copilot."},
                        {"role": "user", "content": user_prompt},
                    ],
                    "stream": True,
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