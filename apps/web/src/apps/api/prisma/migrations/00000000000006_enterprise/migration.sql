-- Step 7: Enterprise & extensibility
-- SSO/LDAP/SAML connections, instance-wide RBAC, API tokens, audit trail
-- enrichment, and locally-installed custom node packages.

-- SystemRole -----------------------------------------------------------
CREATE TYPE "SystemRole" AS ENUM ('superadmin', 'admin', 'member');

ALTER TABLE "User" ADD COLUMN "systemRole" "SystemRole" NOT NULL DEFAULT 'member';

-- SsoProtocol / SsoConnection --------------------------------------------
CREATE TYPE "SsoProtocol" AS ENUM ('saml', 'oidc', 'ldap');

CREATE TABLE "SsoConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "protocol" "SsoProtocol" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoConnection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SsoConnection_workspaceId_idx" ON "SsoConnection"("workspaceId");

ALTER TABLE "SsoConnection" ADD CONSTRAINT "SsoConnection_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ApiToken ----------------------------------------------------------------
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "rateLimit" INTEGER NOT NULL DEFAULT 600,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");
CREATE INDEX "ApiToken_prefix_idx" ON "ApiToken"("prefix");

ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CustomNodePackage ---------------------------------------------------------
CREATE TABLE "CustomNodePackage" (
    "id" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "installedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomNodePackage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomNodePackage_nodeType_key" ON "CustomNodePackage"("nodeType");

-- ActivityLog audit enrichment ---------------------------------------------
ALTER TABLE "ActivityLog" ADD COLUMN "ipAddress" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN "userAgent" TEXT;
