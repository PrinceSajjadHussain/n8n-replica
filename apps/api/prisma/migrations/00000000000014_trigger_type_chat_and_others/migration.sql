-- Add missing TriggerType enum values so chatTrigger and other trigger
-- kinds (already used throughout worker/API/frontend code) can actually be
-- persisted on the Execution row. Previously only 'manual' | 'webhook' |
-- 'schedule' existed, so any chatTrigger/etc. execution failed with:
--   invalid input value for enum "TriggerType": "chatTrigger"
ALTER TYPE "TriggerType" ADD VALUE IF NOT EXISTS 'chatTrigger';
ALTER TYPE "TriggerType" ADD VALUE IF NOT EXISTS 'emailTrigger';
ALTER TYPE "TriggerType" ADD VALUE IF NOT EXISTS 'fileWatcher';
ALTER TYPE "TriggerType" ADD VALUE IF NOT EXISTS 'databaseChange';
ALTER TYPE "TriggerType" ADD VALUE IF NOT EXISTS 'streamTrigger';
ALTER TYPE "TriggerType" ADD VALUE IF NOT EXISTS 'rssTrigger';
ALTER TYPE "TriggerType" ADD VALUE IF NOT EXISTS 'mqttTrigger';
ALTER TYPE "TriggerType" ADD VALUE IF NOT EXISTS 'formTrigger';
ALTER TYPE "TriggerType" ADD VALUE IF NOT EXISTS 'test';
