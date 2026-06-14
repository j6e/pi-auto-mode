import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

interface ProjectTrustContext extends ExtensionContext {
  isProjectTrusted?: () => boolean;
}

export function isProjectTrusted(ctx: ExtensionContext): boolean {
  return (ctx as ProjectTrustContext).isProjectTrusted?.() ?? false;
}
