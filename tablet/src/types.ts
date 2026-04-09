export interface TabletUser {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface LoginUser {
  id: string;
  firstName: string;
  lastName: string;
}

export interface OfficeInfo {
  officeId: string;
  officeName: string;
  tabletEnabled: boolean;
}

export interface Job {
  id: string;
  orderId: string;
  patientFirstName: string;
  patientLastName: string;
  trayNumber: string | null;
  phone: string | null;
  jobType: string;
  status: string;
  orderDestination: string;
  officeId: string;
  createdBy: string | null;
  statusChangedAt: string | number;
  customColumnValues: Record<string, any>;
  isRedoJob: boolean;
  originalJobId: string | null;
  notes: string | null;
  createdAt: string | number;
  updatedAt: string | number;
}

export interface JobComment {
  id: string;
  jobId: string;
  authorId: string;
  content: string;
  isOverdueComment: boolean;
  createdAt: string | number;
  author: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

export interface StatusHistoryEntry {
  id: string;
  jobId: string;
  oldStatus: string | null;
  newStatus: string;
  changedBy: string;
  changedAt: string | number;
}

export interface NotificationRule {
  id: string;
  officeId: string;
  status: string;
  maxDays: number;
  enabled: boolean;
}

export interface StatusConfig {
  id: string;
  label: string;
  color: string;
  order: number;
}

export interface JobTypeConfig {
  id: string;
  label: string;
  color: string;
  order: number;
}

export interface DestinationConfig {
  id: string;
  label: string;
  color: string;
  order: number;
}

export interface OfficeConfig {
  customStatuses: StatusConfig[];
  customJobTypes: JobTypeConfig[];
  customOrderDestinations: DestinationConfig[];
  jobIdentifierMode: "patientName" | "trayNumber";
}

export interface JobsResponse {
  jobs: Job[];
  commentCounts: Record<string, number>;
  notificationRules: NotificationRule[];
}

export interface JobDetailResponse {
  job: Job;
  comments: JobComment[];
  statusHistory: StatusHistoryEntry[];
  linkedJobs: Job[];
  groupNotes: any[];
}

export type ViewState =
  | { view: "login"; step: "userSelect" }
  | { view: "login"; step: "pinEntry"; user: LoginUser }
  | { view: "board" }
  | { view: "jobDetail"; jobId: string }
  | { view: "newJob" }
  | { view: "disabled" }
  | { view: "error"; message: string };
