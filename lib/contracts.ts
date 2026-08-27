export type RecordValue = Record<string, unknown>;

export type ProviderAttempt = {
  order: number;
  provider: string;
  tool: string;
  status: "hit" | "miss" | "error" | "skipped";
  durationMs: number;
  detail: string;
};

export type WaterfallTrace = {
  entity: "company" | "person";
  attempts: ProviderAttempt[];
};

export type CompanyProfile = {
  name: string;
  domain: string;
  employeeCount: number;
  salesTeamSize: number | null;
  revenue: string | null;
  industry: string | null;
  location: string | null;
  technologies: string[];
  enrichmentSource: string;
  fullProfile: RecordValue;
};

export type PersonProfile = {
  fullName: string | null;
  email: string;
  title: string | null;
  seniority: string | null;
  role: string | null;
  location: string | null;
  linkedinUrl: string | null;
  enrichmentSource: string;
  fullProfile: RecordValue;
};

export type CompanyWaterfallResult = {
  company: CompanyProfile | null;
  trace: WaterfallTrace;
};

export type PersonWaterfallResult = {
  person: PersonProfile | null;
  trace: WaterfallTrace;
};

export type ToolRunner = (
  tool: string,
  input: RecordValue,
) => Promise<unknown>;

export type PersonInput = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
};
