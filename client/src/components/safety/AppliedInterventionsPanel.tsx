import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, MapPin } from "lucide-react";
import {
  getInterventionIcon,
  type AppliedIntervention,
  type GeneratedIntervention,
} from "@/lib/interventions";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Props {
  interventions: AppliedIntervention[];
  generatedInterventions?: GeneratedIntervention[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function AppliedInterventionsPanel({
  interventions,
  generatedInterventions = [],
  selectedId,
  onSelect,
  onDelete,
}: Props) {
  const showGenerated = generatedInterventions.length > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Applied Interventions</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {showGenerated ? generatedInterventions.length : interventions.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {interventions.length === 0 && !showGenerated ? (
          <div className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
            Drag interventions from the toolbox onto the map.
          </div>
        ) : showGenerated ? (
          // CHANGE 3 — intervention generation
          <ScrollArea className="h-[240px] pr-2">
            {generatedInterventions.map((intervention) => (
              <div
                key={`${intervention.clusterId ?? "cluster"}-${intervention.title}`}
                className="intervention-card"
                style={{
                  background: "#1a1a2e",
                  borderLeft: "3px solid #ff2d55",
                  borderRadius: "4px",
                  padding: "10px 12px",
                  marginBottom: "8px",
                  fontSize: "12px",
                }}
              >
                <div style={{ fontWeight: "bold", marginBottom: "3px" }}>
                  <GeneratedInterventionIcon interventionId={intervention.interventionId} />{" "}
                  {intervention.title}
                </div>
                {intervention.clusterName ? (
                  <div style={{ color: "#ff2d55", fontSize: "10px", marginBottom: "4px" }}>
                    {intervention.clusterName}
                  </div>
                ) : null}
                <div style={{ color: "#aaa", marginBottom: "4px" }}>{intervention.action}</div>
                <div style={{ display: "flex", gap: "12px", fontSize: "11px" }}>
                  <span style={{ color: "#4caf50" }}>
                    ↓ {intervention.reduction} crash reduction
                  </span>
                </div>
                <div
                  style={{
                    marginTop: "5px",
                    fontSize: "10px",
                    color: "#ff2d55",
                    fontStyle: "italic",
                  }}
                >
                  {intervention.evidence}
                </div>
              </div>
            ))}
          </ScrollArea>
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
                  <MapPin
                    className={`h-3.5 w-3.5 shrink-0 ${
                      iv.origin === "llm" ? "text-red-600" : "text-blue-600"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{iv.interventionType}</div>
                    <div className={iv.origin === "llm" ? "text-red-600" : "text-blue-600"}>
                      {iv.origin === "llm" ? "LLM" : "Planner"} · CMF {iv.cmf.toFixed(2)}
                    </div>
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

function GeneratedInterventionIcon({ interventionId }: { interventionId?: string }) {
  const Icon = getInterventionIcon(interventionId ?? "");
  return <Icon className="inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true" />;
}
