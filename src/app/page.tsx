"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Image from "next/image";
import type { Components } from "react-markdown";

export default function Home() {
  const BASE_URL =
    process.env.NEXT_PUBLIC_COPILOT_URL || "http://127.0.0.1:8000";

  type Msg = { id: string; role: "user" | "assistant"; content: string };

  const [messages, setMessages] = useState<Msg[]>([
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "Hi! I’m Codepilot. Paste code or ask me to explain, refactor, or fix it.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState<
    | "general"
    | "explain"
    | "fix"
    | "refactor"
    | "docstring"
    | "review"
    | "optimize"
    | "testgen"
    | "translate"
    | "generate"
  >("general");
  const [taskOpen, setTaskOpen] = useState(false);

  const streamListRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamListRef.current?.scrollTo({
      top: streamListRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    if (!taskOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setTaskOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setTaskOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [taskOpen]);

  const canSend = useMemo(() => input.trim().length > 0 && !busy, [input, busy]);

  async function sendMessage() {
    if (!canSend) return;

    const userMsg: Msg = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
    };
    const history = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setMessages((m) => [...m, userMsg]);
    setInput("");
    setBusy(true);

    const assistId = crypto.randomUUID();
    setMessages((m) => [...m, { id: assistId, role: "assistant", content: "" }]);

    try {
      const res = await fetch(`${BASE_URL}/chat_stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userMsg.content,
          code: null,
          filename: null,
          task,
          history,
        }),
      });
      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        if (chunk.value) {
          const text = decoder.decode(chunk.value, { stream: true });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistId ? { ...m, content: m.content + text } : m
            )
          );
          streamListRef.current?.scrollTo({
            top: streamListRef.current.scrollHeight,
          });
        }
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistId
            ? {
              ...msg,
              content: `> **Request failed**\n>\n> ${message}`,
            }
            : msg
        )
      );
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const inputPlaceholder = busy
    ? "Streaming…"
    : "Enter to Send · Shift+Enter for Newline";
    
  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100 flex flex-col items-center">
      <header className="w-full max-w-3xl px-4 pt-6 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="/codepilot.png"
              alt="Logo"
              width={48}
              height={48}
              className="h-12 w-12 object-contain"
              priority
            />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Codepilot</h1>
              <p className="text-xs text-neutral-400">Smart • Private • Fast</p>
            </div>
          </div>

          <div className="relative" ref={menuRef}>
            <button
              aria-haspopup="listbox"
              aria-expanded={taskOpen}
              onClick={() => setTaskOpen((v) => !v)}
              className="flex items-center gap-2 bg-neutral-900/70 text-sm rounded-xl px-3 py-2 ring-1 ring-white/10 hover:ring-cyan-500/40 transition focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
            >
              <span className="text-neutral-200 capitalize">{task}</span>
              <svg
                className={`h-4 w-4 transition-transform ${taskOpen ? "rotate-180" : "rotate-0"
                  }`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" />
              </svg>
            </button>

            {taskOpen && (
              <div className="absolute right-0 mt-2 w-52 overflow-hidden rounded-xl border border-white/10 bg-neutral-900/95 shadow-xl backdrop-blur-sm z-50">
                {(
                  [
                    "general",
                    "explain",
                    "fix",
                    "refactor",
                    "docstring",
                    "review",
                    "optimize",
                    "testgen",
                    "translate",
                    "generate",
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setTask(opt);
                      setTaskOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm capitalize hover:bg-white/5 transition ${opt === task ? "text-cyan-400" : "text-neutral-200"
                      }`}
                    role="option"
                    aria-selected={opt === task}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="w-full max-w-3xl px-4 flex-1 overflow-y-auto pb-40 md:pb-48">
        <div ref={streamListRef} className="space-y-6 py-4">
          {messages.map((m) => (
            <MessageBubble key={m.id} role={m.role} content={m.content} />
          ))}
          {busy && <TypingBubble />}
        </div>
      </main>

      <div
        className="fixed inset-x-0 bottom-0 z-50 pb-[max(0px,env(safe-area-inset-bottom))]"
        aria-live="polite"
      >
        <div className="mx-auto w-full max-w-2xl px-4 pb-10">
          <div className="rounded-2xl bg-neutral-900/85 backdrop-blur-md ring-1 ring-white/10 shadow-lg shadow-black/40">
            <AutoGrowTextarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={inputPlaceholder}
              disabled={busy}
            />
            <div className="flex items-center justify-between text-[11px] text-neutral-500 px-3 pb-2 -mt-1">
              <span>{busy ? "Streaming…" : "Ready"}</span>
              <span>Server: {BASE_URL.replace(/^https?:\/\//, "")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AutoGrowTextarea({
  value,
  onChange,
  onKeyDown,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  placeholder?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "0px";
    ref.current.style.height = Math.min(ref.current.scrollHeight, 220) + "px";
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      rows={1}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full resize-none bg-transparent outline-none placeholder:text-neutral-500 px-4 py-3 text-[15px] leading-7 max-h-[220px] disabled:opacity-60 disabled:cursor-not-allowed"
    />
  );
}

function MessageBubble({
  role,
  content,
}: {
  role: "user" | "assistant";
  content: string;
}) {
  const isUser = role === "user";
  return (
    <div className={`w-full py-3 ${isUser ? "text-cyan-300" : "text-neutral-100"}`}>
      <div className="max-w-3xl mx-auto leading-relaxed text-[15px]">
        <div
          className={`text-[11px] mb-1 font-medium ${isUser ? "text-cyan-600/70" : "text-neutral-500/70"
            }`}
        >
          {isUser ? "You" : "Codepilot"}
        </div>
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <Markdown content={content} />
        )}
      </div>
    </div>
  );
}

function Markdown({ content }: { content: string }) {
  const components: Components = {
    p: (props) => <div className="mb-2" {...props} />,
    h1: (p) => <h1 className="text-base font-semibold mb-2" {...p} />,
    h2: (p) => <h2 className="text-sm font-semibold mt-2 mb-1" {...p} />,
    ul: (p) => <ul className="list-disc ml-5 space-y-1 mb-2" {...p} />,
    ol: (p) => <ol className="list-decimal ml-5 space-y-1 mb-2" {...p} />,
    code({
      inline,
      className,
      children,
      ...props
    }: React.HTMLAttributes<HTMLElement> & {
      inline?: boolean;
      className?: string;
      children?: React.ReactNode;
    }) {
      if (inline) {
        return (
          <code
            className="px-1.5 py-0.5 rounded bg-neutral-900/70 ring-1 ring-white/10 font-mono"
            {...props}
          >
            {children}
          </code>
        );
      }
      return (
        <div className="group relative my-3">
          <button
            onClick={async () =>
              await navigator.clipboard.writeText(String(children))
            }
            className="absolute top-2 right-2 z-20 text-xs rounded-lg px-2 py-1 bg-white/5 hover:bg-white/10 ring-1 ring-white/10 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition"
            title="Copy"
          >
            Copy
          </button>
          <div className="overflow-x-auto rounded-xl bg-neutral-900/90 ring-1 ring-white/10">
            <pre className="p-3 pr-12">
              <code className={`font-mono ${className || ""}`} {...props}>
                {children}
              </code>
            </pre>
          </div>
        </div>
      );
    },
    blockquote: (p) => (
      <blockquote
        className="border-l-2 border-neutral-700 pl-3 italic text-neutral-300 mb-2"
        {...p}
      />
    ),
    a: (p) => (
      <a
        className="text-cyan-400 hover:underline"
        target="_blank"
        rel="noreferrer"
        {...p}
      />
    ),
    table: (p) => (
      <div className="overflow-x-auto my-2">
        <table
          className="w-full text-left border-separate border-spacing-y-1"
          {...p}
        />
      </div>
    ),
    th: (p) => (
      <th className="text-xs uppercase tracking-wide text-neutral-400 pb-1" {...p} />
    ),
    td: (p) => <td className="text-sm py-1" {...p} />,
  };

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}

function TypingBubble() {
  return (
    <div className="flex items-center gap-2 text-neutral-400 text-sm px-1">
      <div className="h-2 w-2 rounded-full bg-neutral-500 animate-bounce [animation-delay:-.3s]" />
      <div className="h-2 w-2 rounded-full bg-neutral-500 animate-bounce [animation-delay:-.15s]" />
      <div className="h-2 w-2 rounded-full bg-neutral-500 animate-bounce" />
      <span className="ml-1">Thinking…</span>
    </div>
  );
}