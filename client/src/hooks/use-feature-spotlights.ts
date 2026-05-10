// Single source of truth for spotlight state on the desktop.
//
// Loads:
//   - User preferences (`/api/user/preferences`) — per-user spotlight
//     state lives under `preferences.featureSpotlights`.
//   - Server-enabled feature ids (`/api/feature-flags`) — kill-switch
//     and gradual-rollout. Hard-coded fallback if the call fails so
//     spotlights can render in offline windows.
//
// Computes a derived list of "active" features the orchestrator should
// surface, given:
//   - Migration deadline (existing users skip pre-deploy features).
//   - Per-feature dismissal state (modal/tour/pulse/target-clicked).
//   - First-session skip (configurable per feature).
//   - Server enabled-list intersection.
//
// Exposes mutators that write back through PUT /api/user/preferences
// (which merges, so we send only the spotlight subtree).

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  FEATURE_SPOTLIGHTS,
  freshSpotlightPrefs,
  isFeatureEligible,
  type FeatureSpotlight,
  type SpotlightPreferencesShape,
  type SpotlightUserState,
} from "@shared/feature-spotlights";

interface RawPrefs {
  featureSpotlights?: SpotlightPreferencesShape;
  [k: string]: any;
}

interface FeatureFlagsResponse {
  enabledFeatureIds: string[];
}

const SESSION_ID_KEY = "otto.spotlight.sessionId";

/** Generate a per-tab session id used to count "logins" exactly once
 *  per session. (Window unload clears it; a fresh load mints a new id.) */
function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const fresh = `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(SESSION_ID_KEY, fresh);
    return fresh;
  } catch {
    // sessionStorage unavailable (private mode, etc.) — fall back to a
    // module-scope value so we still only count once per page load.
    return moduleSessionId;
  }
}
const moduleSessionId = `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export interface ActiveSpotlight {
  feature: FeatureSpotlight;
  state: SpotlightUserState;
  /** True when this feature has never been seen by this user in any
   *  session — drives the What's New modal show. */
  isFirstAppearance: boolean;
}

export function useFeatureSpotlights() {
  const queryClient = useQueryClient();

  const { data: prefs } = useQuery<RawPrefs>({
    queryKey: ["/api/user/preferences"],
    queryFn: async () => {
      const res = await fetch("/api/user/preferences", { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: flags } = useQuery<FeatureFlagsResponse>({
    queryKey: ["/api/feature-flags"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/feature-flags", { credentials: "include" });
        if (!res.ok) return { enabledFeatureIds: FEATURE_SPOTLIGHTS.map((f) => f.id) };
        return res.json();
      } catch {
        // Network failure: optimistically enable everything in the
        // local registry so dev / offline windows still surface
        // spotlights. The server kill-switch only matters when the
        // call succeeds.
        return { enabledFeatureIds: FEATURE_SPOTLIGHTS.map((f) => f.id) };
      }
    },
    staleTime: 30 * 60 * 1000,
  });

  const featureSpotlightsPrefs = prefs?.featureSpotlights;

  const saveMutation = useMutation({
    mutationFn: async (next: SpotlightPreferencesShape) => {
      // Server merges shallowly, so we send the full featureSpotlights
      // subtree. Optimistic update lets the UI react instantly.
      const res = await apiRequest("PUT", "/api/user/preferences", { featureSpotlights: next });
      return res.json();
    },
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ["/api/user/preferences"] });
      const previous = queryClient.getQueryData<RawPrefs>(["/api/user/preferences"]) ?? {};
      queryClient.setQueryData<RawPrefs>(["/api/user/preferences"], {
        ...previous,
        featureSpotlights: next,
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["/api/user/preferences"], ctx.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/preferences"] });
    },
  });

  // Mutator helper that takes a producer and writes the new prefs back.
  const update = useCallback(
    (producer: (current: SpotlightPreferencesShape) => SpotlightPreferencesShape) => {
      const current = featureSpotlightsPrefs ?? freshSpotlightPrefs();
      const next = producer(structuredClone(current));
      saveMutation.mutate(next);
    },
    [featureSpotlightsPrefs, saveMutation],
  );

  // ── Session bookkeeping ─────────────────────────────────────────────
  // On the first call per session for which prefs are loaded, increment
  // the session counter and bump loginsSeenIn for every active feature.
  // Bake the migration deadline if absent so existing users skip
  // pre-deploy features.
  const sessionBumpedRef = useRef(false);
  useEffect(() => {
    if (!prefs) return;
    if (sessionBumpedRef.current) return;
    const sessionId = getOrCreateSessionId();
    const sessions = featureSpotlightsPrefs?.__sessions__ ?? { count: 0 };
    if (sessions.lastSessionId === sessionId) {
      sessionBumpedRef.current = true;
      return;
    }
    sessionBumpedRef.current = true;

    update((cur) => {
      cur.__sessions__ = {
        count: (cur.__sessions__?.count ?? 0) + 1,
        lastSessionId: sessionId,
      };
      if (!cur.__meta__?.migrationDeadline) {
        cur.__meta__ = { migrationDeadline: new Date().toISOString() };
      }
      // Bump per-feature loginsSeenIn for everything in the active
      // registry. We'll filter eligibility downstream.
      for (const f of FEATURE_SPOTLIGHTS) {
        const s = (cur[f.id] ?? {}) as SpotlightUserState;
        s.loginsSeenIn = (s.loginsSeenIn ?? 0) + 1;
        if (!s.firstSeenAt) s.firstSeenAt = new Date().toISOString();
        cur[f.id] = s;
      }
      return cur;
    });
  }, [prefs, featureSpotlightsPrefs, update]);

  // ── Derived: which spotlights to surface ────────────────────────────
  const enabledIds = useMemo(
    () => new Set(flags?.enabledFeatureIds ?? FEATURE_SPOTLIGHTS.map((f) => f.id)),
    [flags?.enabledFeatureIds],
  );

  const sessionCount = featureSpotlightsPrefs?.__sessions__?.count ?? 0;

  const active: ActiveSpotlight[] = useMemo(() => {
    if (!featureSpotlightsPrefs) return [];
    const out: ActiveSpotlight[] = [];
    for (const f of FEATURE_SPOTLIGHTS) {
      if (!enabledIds.has(f.id)) continue;
      if (!isFeatureEligible(f, featureSpotlightsPrefs)) continue;
      const state = (featureSpotlightsPrefs[f.id] as SpotlightUserState) ?? {};
      // Skip the very first session if requested (default true).
      const skipFirst = f.skipFirstSession !== false;
      if (skipFirst && sessionCount <= 1) continue;
      const isFirstAppearance = !state.modalDismissedAt && !state.modalShowMeClickedAt
        && !state.tourCompletedAt && !state.tourSkippedAt;
      out.push({ feature: f, state, isFirstAppearance });
    }
    return out;
  }, [featureSpotlightsPrefs, enabledIds, sessionCount]);

  // ── Mutators ────────────────────────────────────────────────────────

  const patchFeatureState = useCallback(
    (featureId: string, patch: Partial<SpotlightUserState>) => {
      update((cur) => {
        const s = (cur[featureId] ?? {}) as SpotlightUserState;
        cur[featureId] = { ...s, ...patch };
        return cur;
      });
    },
    [update],
  );

  return {
    isReady: !!prefs,
    sessionCount,
    activeSpotlights: active,
    enabledIds,
    rawState: featureSpotlightsPrefs,
    /** Mark the What's New modal dismissed (without starting the tour). */
    dismissModal: (featureId: string) =>
      patchFeatureState(featureId, { modalDismissedAt: new Date().toISOString() }),
    /** Record the user clicked the modal's primary CTA — orchestrator
     *  will start the tour. */
    startTour: (featureId: string) =>
      patchFeatureState(featureId, { modalShowMeClickedAt: new Date().toISOString() }),
    /** Tour finished naturally. */
    completeTour: (featureId: string) =>
      patchFeatureState(featureId, { tourCompletedAt: new Date().toISOString() }),
    /** Tour was skipped mid-way. */
    skipTour: (featureId: string) =>
      patchFeatureState(featureId, { tourSkippedAt: new Date().toISOString() }),
    /** Pulse dot dismissed via its X. */
    dismissPulse: (featureId: string) =>
      patchFeatureState(featureId, { pulseDismissedAt: new Date().toISOString() }),
    /** Target element was clicked naturally — counts as engaged. */
    markTargetClicked: (featureId: string, stepId: string) =>
      update((cur) => {
        const s = (cur[featureId] ?? {}) as SpotlightUserState;
        const stepsClicked = { ...(s.stepsClicked ?? {}), [stepId]: new Date().toISOString() };
        cur[featureId] = { ...s, stepsClicked, targetClickedAt: s.targetClickedAt ?? new Date().toISOString() };
        return cur;
      }),
    /** Reset a feature's state — re-trigger from the What's New archive. */
    resetFeature: (featureId: string) =>
      update((cur) => {
        cur[featureId] = { firstSeenAt: new Date().toISOString(), loginsSeenIn: 1 };
        return cur;
      }),
  };
}

export type UseFeatureSpotlightsReturn = ReturnType<typeof useFeatureSpotlights>;
