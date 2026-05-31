import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { INTERVENTION_CATEGORIES, type InterventionType } from "@/lib/interventions";
import { cn } from "@/lib/utils";

interface Props {
  onDragStart: (intervention: InterventionType) => void;
  onDragEnd: () => void;
}

export function InterventionToolbox({ onDragStart, onDragEnd }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    "Speed Management": true,
  });

  return (
    <div className="space-y-2">
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
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="h-4 px-1 py-0 text-[10px]">
              CMF {intervention.cmf.toFixed(2)}
            </Badge>
            <span className="tabular-nums">${intervention.cost.toLocaleString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
