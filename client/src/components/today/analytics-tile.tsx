// ponytail: reuse stats + link to the full Analytics tab; build bespoke KPIs only if asked
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import StatsTile from "./stats-tile";
import type { Job } from "@shared/schema";

export default function AnalyticsTile({ jobs }: { jobs: Job[] }) {
  const [, setLocation] = useLocation();
  return (
    <section className="rounded-xl border border-line bg-panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm text-ink">Analytics</span>
        <Button size="xs" variant="outline" onClick={() => setLocation("/dashboard/analytics")}>Open Analytics →</Button>
      </div>
      <StatsTile jobs={jobs} />
    </section>
  );
}
