import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History } from "lucide-react";
import type { AppliedIntervention } from "@/lib/interventions";

export function InterventionHistory({ interventions }: { interventions: AppliedIntervention[] }) {
  const sorted = [...interventions].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="h-4 w-4" /> History
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {sorted.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-4">No actions yet.</div>
        ) : (
          <ScrollArea className="h-[160px] pr-2">
            <div className="space-y-1.5">
              {sorted.map((iv) => (
                <div key={iv.id} className="flex items-start gap-2 text-[11px]">
                  <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <div className="flex-1">
                    <div className="font-medium">{iv.interventionType}</div>
                    <div className="text-muted-foreground">
                      {new Date(iv.timestamp).toLocaleTimeString()} · {iv.latitude.toFixed(4)},{" "}
                      {iv.longitude.toFixed(4)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
