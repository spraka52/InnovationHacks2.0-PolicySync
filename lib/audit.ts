import { getServiceClient } from "./supabase";

type AuditAction =
  | "fetch_triggered"
  | "artifact_unchanged"
  | "artifact_changed"
  | "draft_created"
  | "eval_passed"
  | "eval_failed"
  | "rule_published"
  | "rule_rejected"
  | "draft_deleted"
  | "config_updated";

interface AuditParams {
  action: AuditAction;
  userId?: string;
  userEmail?: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(params: AuditParams) {
  const db = getServiceClient();
  await db.from("audit_events").insert({
    action: params.action,
    user_id: params.userId ?? null,
    user_email: params.userEmail ?? null,
    entity_type: params.entityType,
    entity_id: params.entityId,
    metadata: params.metadata ?? {},
  });
}
