-- Community/marketplace node system: tracks which third-party node
-- packages are installed on this instance.

CREATE TABLE "CommunityNode" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "author" TEXT,
  "homepage" TEXT,
  "nodeTypes" JSONB NOT NULL,
  "source" TEXT NOT NULL,
  "installedBy" TEXT NOT NULL,
  "installedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "CommunityNode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityNode_name_key" ON "CommunityNode"("name");
