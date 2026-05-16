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

export type ClassifierToolMode = "force" | "required" | "auto";

export interface ClassifierConfig {
  model: string | null;
  prompt: string | null;
  environment: string[];
  hardDeny: string[];
  softDeny: string[];
  allow: string[];
  timeoutMs: number;
  toolMode?: ClassifierToolMode;
}

export interface ToolTierConfig {
  alwaysAllow: string[];
  allowInProject: string[];
  alwaysEvaluate: string[];
  alwaysBlock: string[];
}

export interface AutoModeSettings {
  defaultMode: PermissionMode;
  classifier: ClassifierConfig;
  denyAndContinue: DenyAndContinueConfig;
  tools?: ToolTierConfig;
  protectedPaths?: string[];
}

export interface ResolvedConfig {
  defaultMode: PermissionMode;
  classifier: Required<ClassifierConfig>;
  denyAndContinue: Required<DenyAndContinueConfig>;
  tools: Required<ToolTierConfig>;
  protectedPaths: string[];
}
