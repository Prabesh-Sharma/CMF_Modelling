import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { INTERVENTION_CATEGORIES, type InterventionType } from "@/lib/interventions";
import { cn } from "@/lib/utils";
import { evaluateIntervention, type ModelRecommendation } from "@/lib/api/chat.functions";

interface Props {
  onDragStart: (intervention: InterventionType) => void;
  onDragEnd: () => void;
  onAddCustom: (recommendation: ModelRecommendation) => void;
}

export function InterventionToolbox({ onDragStart, onDragEnd, onAddCustom }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    "Speed Management": true,
  });
  const [custom, setCustom] = useState("");
  const [evaluating, setEvaluating] = useState(false);

  return (
    <div className="space-y-2">
      <div className="rounded-md border bg-card p-2">
        <div className="mb-1 text-xs font-semibold">Your Recommendation</div>
        <div className="flex gap-1">
          <input
            className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs"
            placeholder="e.g. overhead bridge"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
          <button
            type="button"
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
            disabled={evaluating || custom.trim().length < 2}
            onClick={async () => {
              setEvaluating(true);
              try {
                onAddCustom(await evaluateIntervention({ data: { name: custom.trim() } }));
                setCustom("");
              } finally {
                setEvaluating(false);
              }
            }}
          >
            {evaluating ? "..." : "Test Fit"}
          </button>
        </div>
      </div>
      {INTERVENTION_CATEGORIES.map((cat) => {
        const isOpen = open[cat.category] ?? false;
        return (
          <div key={cat.category} className="rounded-md border bg-card">
            <button
              type="button"
              onClick={() => setOpen((s) => ({ ...s, [cat.category]: !isOpen }))}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/50"
            >
              <span>{cat.category}</span>
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
            {isOpen && (
              <div className="space-y-1.5 border-t p-2">
                {cat.items.map((iv) => (
                  <InterventionCard
                    key={iv.id}
                    intervention={iv}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InterventionCard({
  intervention,
  onDragStart,
  onDragEnd,
}: {
  intervention: InterventionType;
  onDragStart: (i: InterventionType) => void;
  onDragEnd: () => void;
}) {
  const Icon = intervention.icon;
  return (
    <Card
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("text/plain", intervention.id);
        onDragStart(intervention);
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "cursor-grab border-border/60 transition-all hover:border-primary hover:shadow-sm active:cursor-grabbing active:scale-[0.98]",
      )}
    >
      <CardContent className="flex items-center gap-2 p-2">
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{intervention.name}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{intervention.category}</div>
        </div>
      </CardContent>
    </Card>
  );
}
