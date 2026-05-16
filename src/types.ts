export type PermissionMode = "off" | "auto" | "dontAsk";

export interface ClassifierDecision {
  decision: "allow" | "block";
  reason: string;
  confidence: "high" | "medium" | "low";
  category:
    | "user_intent"
    | "security"
    | "data_loss"
    | "scope_creep"
    | "infrastructure"
    | "credential_access"
    | "other";
}

export interface DenyAndContinueConfig {
  maxConsecutiveDenials: number;
  maxTotalDenials: number;
}

export interface ClassifierConfig {
  model: string | null;
  prompt: string | null;
  environment: string[];
  hardDeny: string[];
  softDeny: string[];
  allow: string[];
  timeoutMs: number;
}

export interface AutoModeSettings {
  defaultMode: PermissionMode;
  classifier: ClassifierConfig;
  denyAndContinue: DenyAndContinueConfig;
}

export interface ResolvedConfig {
  defaultMode: PermissionMode;
  classifier: Required<ClassifierConfig>;
  denyAndContinue: Required<DenyAndContinueConfig>;
}
