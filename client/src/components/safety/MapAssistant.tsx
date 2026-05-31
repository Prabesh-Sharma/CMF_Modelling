import { useMemo, useState } from "react";
import { MessageCircle, ChevronDown, ChevronUp, Loader2 } from "lucide-react";

import type { Hotspot } from "@/lib/road-data";
import type { AppliedIntervention } from "@/lib/interventions";
import { submitChat } from "@/lib/api/chat.functions";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

interface Props {
  hotspot: Hotspot | null;
  interventions: AppliedIntervention[];
  selectedIntervention: AppliedIntervention | null;
}

export function MapAssistant({ hotspot, interventions, selectedIntervention }: Props) {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const context = useMemo(
    () => ({
      hotspot: hotspot ?? null,
      interventions,
      selectedIntervention,
    }),
    [hotspot, interventions, selectedIntervention],
  );

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setInput("");
    setError(null);
    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    try {
      const response = await submitChat({
        data: {
          message: trimmed,
          context,
        },
      });
      const assistantMsg: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        text: response.reply,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pointer-events-auto absolute bottom-4 right-4 z-[1100] w-[340px]">
      <div className="overflow-hidden rounded-xl border bg-card/95 shadow-lg backdrop-blur">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <MessageCircle className="h-3.5 w-3.5" /> Map Assistant
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Collapse assistant" : "Expand assistant"}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>

        {open ? (
          <div className="flex max-h-[60vh] flex-col gap-3 p-3">
            <div className="rounded-lg border bg-muted/30 p-2 text-[11px] text-muted-foreground">
              <div className="font-semibold uppercase tracking-wide text-[10px]">Context</div>
              <div className="mt-1 space-y-1">
                <div>
                  Hotspot: {hotspot ? hotspot.name : "None selected"}
                </div>
                <div>Interventions: {interventions.length}</div>
                <div>
                  Selected: {selectedIntervention ? selectedIntervention.interventionType : "None"}
                </div>
              </div>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto rounded-lg border bg-background/80 p-2 text-[12px]">
              {messages.length === 0 ? (
                <div className="text-muted-foreground">
                  Ask about CMFs, expected crash reduction, or recommended interventions.
                </div>
              ) : null}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-md px-2 py-1.5 ${
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {m.text}
                </div>
              ))}
              {loading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                </div>
              ) : null}
            </div>

            {error ? <div className="text-xs text-destructive">{error}</div> : null}

            <div className="flex items-center gap-2">
              <textarea
                className="min-h-[46px] flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="Ask about this hotspot…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                onClick={handleSend}
                disabled={loading}
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            Click to expand and chat with context.
          </div>
        )}
      </div>
    </div>
  );
}
