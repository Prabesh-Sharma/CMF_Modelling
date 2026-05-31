import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, MapPin } from "lucide-react";
import type { AppliedIntervention } from "@/lib/interventions";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Props {
  interventions: AppliedIntervention[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function AppliedInterventionsPanel({
  interventions,
  selectedId,
  onSelect,
  onDelete,
}: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Applied Interventions</span>
          <span className="text-xs text-muted-foreground tabular-nums">{interventions.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {interventions.length === 0 ? (
          <div className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
            Drag interventions from the toolbox onto the map.
          </div>
        ) : (
          <ScrollArea className="h-[240px] pr-2">
            <div className="space-y-1.5">
              {interventions.map((iv) => (
                <div
                  key={iv.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-md border p-2 text-xs transition-colors",
                    selectedId === iv.id
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50 cursor-pointer",
                  )}
                  onClick={() => onSelect(iv.id)}
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{iv.interventionType}</div>
                    <div className="tabular-nums text-[10px] text-muted-foreground">
                      {iv.latitude.toFixed(4)}, {iv.longitude.toFixed(4)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(iv.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
