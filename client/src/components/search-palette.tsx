import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";

export interface SearchPatientResult {
  id: string;
  firstName: string;
  lastName: string;
  jobId: string;
}

export interface SearchJobResult {
  id: string;
  orderId: string;
  patientFirstName: string;
  patientLastName: string;
  status: string;
}

interface SearchResponse {
  patients: SearchPatientResult[];
  jobs: SearchJobResult[];
}

interface SearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired when the user picks a result — carries the job id to open. */
  onSelectJob: (jobId: string) => void;
}

/** Debounce a value by `delayMs`, re-running whenever `value` changes. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Global Cmd+K / Ctrl+K search palette. Searches patients and jobs by
 *  patient name via GET /api/search and hands the chosen job's id back to
 *  the caller, which is responsible for opening the record. */
export default function SearchPalette({ open, onOpenChange, onSelectJob }: SearchPaletteProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 200);

  // Reset the query each time the palette closes so it opens fresh next time.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const { data, isFetching } = useQuery<SearchResponse>({
    queryKey: ["/api/search", debouncedQuery],
    queryFn: async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: open && debouncedQuery.length > 0,
  });

  const patients = data?.patients ?? [];
  const jobs = data?.jobs ?? [];
  const hasQuery = debouncedQuery.length > 0;
  const hasResults = patients.length > 0 || jobs.length > 0;

  const selectJob = (jobId: string) => {
    onOpenChange(false);
    onSelectJob(jobId);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <CommandInput
        placeholder="Search patients and jobs"
        value={query}
        onValueChange={setQuery}
        data-testid="input-search-palette"
      />
      <CommandList data-testid="list-search-palette">
        {hasQuery && !isFetching && !hasResults && (
          <CommandEmpty>No matches</CommandEmpty>
        )}
        {patients.length > 0 && (
          <CommandGroup heading="Patients">
            {patients.map((patient) => (
              <CommandItem
                key={patient.id}
                value={`patient-${patient.firstName}-${patient.lastName}-${patient.jobId}`}
                onSelect={() => selectJob(patient.jobId)}
                data-testid={`search-result-patient-${patient.jobId}`}
              >
                {patient.firstName} {patient.lastName}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {jobs.length > 0 && (
          <CommandGroup heading="Jobs">
            {jobs.map((job) => (
              <CommandItem
                key={job.id}
                value={`job-${job.patientFirstName}-${job.patientLastName}-${job.orderId}`}
                onSelect={() => selectJob(job.id)}
                data-testid={`search-result-job-${job.id}`}
              >
                {job.patientFirstName} {job.patientLastName} ({job.orderId})
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
