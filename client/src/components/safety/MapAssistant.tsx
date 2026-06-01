import { useMemo, useState } from "react";
import { MessageCircle, ChevronDown, ChevronUp, Loader2 } from "lucide-react";

import type { Hotspot } from "@/lib/road-data";
import type { AppliedIntervention } from "@/lib/interventions";
import { submitChat, type ModelRecommendation } from "@/lib/api/chat.functions";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: string[];
  recommendations?: ModelRecommendation[];
  impactModel?: {
    combinedCmf?: number | null;
    projectedCrashes?: number | null;
    crashReduction?: number | null;
  } | null;
};

interface Props {
  hotspot: Hotspot | null;
  interventions: AppliedIntervention[];
  selectedIntervention: AppliedIntervention | null;
  onAddRecommendation: (recommendation: ModelRecommendation) => void;
}

export function MapAssistant({
  hotspot,
  interventions,
  selectedIntervention,
  onAddRecommendation,
}: Props) {
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
        sources: [
          ...new Set(response.sources?.flatMap((source) => (source.source ? [source.source] : []))),
        ],
        recommendations: response.recommendations,
        impactModel: response.impactModel,
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
                <div>Hotspot: {hotspot ? hotspot.name : "None selected"}</div>
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
                  <div className="whitespace-pre-wrap">{m.text}</div>
                  {m.sources?.length ? (
                    <div className="mt-2 border-t border-border/60 pt-1 text-[10px] text-muted-foreground">
                      Sources: {m.sources.join(", ")}
                    </div>
                  ) : null}
                  {m.role === "assistant" && m.impactModel?.combinedCmf ? (
                    <div className="mt-2 rounded border bg-background/80 p-2 text-[11px]">
                      <div className="font-semibold">Computed board impact</div>
                      <div>Combined CMF: {m.impactModel.combinedCmf.toFixed(3)}</div>
                      {m.impactModel.projectedCrashes != null ? (
                        <div>Projected crashes: {m.impactModel.projectedCrashes}</div>
                      ) : null}
                      {m.impactModel.crashReduction != null ? (
                        <div>Crash reduction: {m.impactModel.crashReduction}</div>
                      ) : null}
                    </div>
                  ) : null}
                  {m.role === "assistant" && m.recommendations?.length ? (
                    <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
                      <div className="text-[10px] font-semibold uppercase text-red-600">
                        Model recommendations
                      </div>
                      {m.recommendations.map((recommendation) => (
                        <button
                          key={recommendation.interventionId}
                          type="button"
                          className="block w-full rounded border border-red-300 bg-red-50 px-2 py-1 text-left text-[11px] text-red-800 hover:bg-red-100"
                          onClick={() => onAddRecommendation(recommendation)}
                        >
                          <div className="font-semibold">
                            + {recommendation.interventionType} · CMF{" "}
                            {recommendation.cmf.toFixed(2)}
                          </div>
                          <div>{recommendation.rationale}</div>
                          {recommendation.projectedCrashes != null ? (
                            <div>
                              {recommendation.baselineCrashes} →{" "}
                              {recommendation.projectedCrashes} crashes
                            </div>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
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
