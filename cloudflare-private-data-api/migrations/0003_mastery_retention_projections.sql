-- Prompt 33: additive local D1 mirror of the bounded mastery projections.
-- PostgreSQL remains canonical; this migration is intentionally local-only.
CREATE TABLE IF NOT EXISTS private_mastery (
  user_id TEXT NOT NULL,
  lecture_id TEXT NOT NULL,
  subject_id TEXT,
  state TEXT NOT NULL,
  evidence_score INTEGER NOT NULL,
  evidence_count INTEGER NOT NULL,
  objective_attempt_count INTEGER NOT NULL,
  objective_correct_count INTEGER NOT NULL,
  objective_incorrect_count INTEGER NOT NULL,
  flashcard_review_count INTEGER NOT NULL,
  flashcard_remembered_count INTEGER NOT NULL,
  flashcard_not_remembered_count INTEGER NOT NULL,
  recall_objective_attempt_count INTEGER NOT NULL,
  recall_objective_correct_count INTEGER NOT NULL,
  recall_objective_incorrect_count INTEGER NOT NULL,
  meaningful_focus_session_count INTEGER NOT NULL,
  meaningful_focus_seconds INTEGER NOT NULL,
  last_study_evidence_at TEXT,
  last_objective_evidence_at TEXT,
  last_recall_evidence_at TEXT,
  rule_version TEXT NOT NULL,
  revision INTEGER NOT NULL,
  projection_revision TEXT NOT NULL,
  last_evaluated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  projected_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lecture_id)
);
CREATE INDEX IF NOT EXISTS private_mastery_user_state_idx ON private_mastery(user_id, state);
CREATE INDEX IF NOT EXISTS private_mastery_user_subject_idx ON private_mastery(user_id, subject_id);

CREATE TABLE IF NOT EXISTS private_retention (
  user_id TEXT NOT NULL,
  lecture_id TEXT NOT NULL,
  source_mastery_revision INTEGER NOT NULL,
  source_mastery_rule_version TEXT NOT NULL,
  effective_mastery_state TEXT NOT NULL,
  retention_score INTEGER,
  review_state TEXT NOT NULL,
  review_urgency_score INTEGER NOT NULL,
  retention_anchor_at TEXT,
  next_review_at TEXT,
  next_evaluation_at TEXT,
  last_positive_memory_evidence_at TEXT,
  last_negative_memory_evidence_at TEXT,
  last_forgetting_evidence_at TEXT,
  objective_forgetting_item_count INTEGER NOT NULL,
  self_reported_forgetting_item_count INTEGER NOT NULL,
  forgetting_evidence_kind TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  revision INTEGER NOT NULL,
  projection_revision TEXT NOT NULL,
  last_evaluated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  projected_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lecture_id)
);
CREATE INDEX IF NOT EXISTS private_retention_user_review_idx
  ON private_retention(user_id, review_state, next_review_at);

CREATE TABLE IF NOT EXISTS private_mastery_projection_state (
  user_id TEXT PRIMARY KEY NOT NULL,
  mastery_watermark TEXT NOT NULL DEFAULT '0',
  retention_watermark TEXT NOT NULL DEFAULT '0',
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deletion_revision TEXT
);

CREATE TABLE IF NOT EXISTS private_mastery_projection_tombstones (
  entity TEXT NOT NULL,
  user_id TEXT NOT NULL,
  lecture_id TEXT NOT NULL,
  projection_revision TEXT NOT NULL,
  revision INTEGER NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (entity, user_id, lecture_id)
);