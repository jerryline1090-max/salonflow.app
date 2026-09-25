import { FormEvent, useState } from "react";
import { useLocation } from "react-router-dom";
import { assistantApi } from "@/api/resources";
import { ApiError } from "@/api/client";

type Message = { role: "user" | "ai"; text: string };

export function AssistantChat() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
    setMessages((current) => [...current, { role: "user", text: message }]);
    setText("");
    setSending(true);
    try {
      const result = await assistantApi.ask(message, location.pathname);
      setMessages((current) => [...current, { role: "ai", text: result.reply }]);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "I couldn't reach SalonFlow AI. Please try again.";
      setMessages((current) => [...current, { role: "ai", text: message }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 sm:bottom-6 sm:right-6">
      {open && (
        <section aria-label="SalonFlow AI assistant" className="mb-3 flex h-[min(32rem,calc(100vh-7rem))] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-lg border border-brass-100 bg-paper-raised shadow-popover">
          <header className="flex items-center justify-between bg-brass-500 px-4 py-3 text-white">
            <div><p className="font-medium">SalonFlow AI</p><p className="text-xs text-white/80">Your role-aware assistant</p></div>
            <button onClick={() => setOpen(false)} aria-label="Close assistant" className="rounded p-1 hover:bg-white/15">×</button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
            {messages.length === 0 && <p className="rounded bg-brass-50 p-3 text-ink-soft">Hi — I can help with your schedule, clients, and SalonFlow. I only use information you’re allowed to access.</p>}
            {messages.map((message, index) => <p key={index} className={`max-w-[88%] rounded px-3 py-2 ${message.role === "user" ? "ml-auto bg-ink text-white" : "bg-paper-sunken text-ink"}`}>{message.text}</p>)}
            {sending && <p className="text-ink-muted">Thinking…</p>}
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
            <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Ask anything…" className="min-w-0 flex-1 rounded border border-line bg-paper px-3 py-2 text-sm" aria-label="Message SalonFlow AI" />
            <button disabled={sending || !text.trim()} className="rounded bg-brass-500 px-3 text-sm font-medium text-white disabled:opacity-50">Send</button>
          </form>
        </section>
      )}
      <button onClick={() => setOpen((value) => !value)} aria-label={open ? "Close SalonFlow AI" : "Open SalonFlow AI"} className="flex h-14 w-14 items-center justify-center rounded-full bg-brass-500 text-2xl text-white shadow-popover transition-transform hover:scale-105">✦</button>
    </div>
  );
}
