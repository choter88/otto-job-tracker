// Today v2 telemetry event names + client metadata shape. Event names are
// snake_case and <= 50 chars. Client-emitted Today telemetry carries NO
// strings (numbers/enums only) so patient names / job-type labels can never
// be logged from the client — see ClientTodayMetadata below.

export const TODAY_EVENTS = {
  VIEW_OPENED: "today_view_opened",
  ATTEMPT_CALLED: "today_attempt_called",
  ATTEMPT_TEXTED: "today_attempt_texted",
  SNOOZE: "today_snooze",
  PICKUP: "today_pickup",
  CHASE_ATTEMPT: "today_chase_attempt",
  SEARCH_OPENED: "today_search_opened",
  NEW_JOB_CLICKED: "today_new_job_clicked",
  STAR_DONE: "today_star_done",
} as const;

export type TodayEventName = (typeof TODAY_EVENTS)[keyof typeof TODAY_EVENTS];

// Client-emitted Today telemetry carries NO strings — numbers only — so patient
// names / job-type labels can never typecheck into a client emit.
export type ClientTodayMetadata = Record<string, number>;
