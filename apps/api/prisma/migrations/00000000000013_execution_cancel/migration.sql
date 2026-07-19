-- Cancel-from-canvas: a running/paused execution can be stopped by the user.
-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction as other
-- statements that use the new value, so this migration only adds the enum
-- value; nothing else references it at migration time.
ALTER TYPE "ExecutionStatus" ADD VALUE IF NOT EXISTS 'cancelled';
