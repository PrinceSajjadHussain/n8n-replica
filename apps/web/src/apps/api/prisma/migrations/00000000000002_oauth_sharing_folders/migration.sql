-- CreateEnum
CREATE TYPE "CredentialAuthType" AS ENUM ('apiKey', 'oauth2');

-- CreateEnum
CREATE TYPE "SharePermission" AS ENUM ('use', 'manage');

-- CreateTable
CREATE TABLE "CredentialFolder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialFolder_pkey" PRIMARY KEY ("id")
);

-- AlterTable: extend Credential with name/authType/folder/oauth/test-result columns
ALTER TABLE "Credential"
  ADD COLUMN "name" TEXT NOT NULL DEFAULT 'Untitled credential',
  ADD COLUMN "authType" "CredentialAuthType" NOT NULL DEFAULT 'apiKey',
  ADD COLUMN "folderId" TEXT,
  ADD COLUMN "oauthProvider" TEXT,
  ADD COLUMN "oauthExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastTestedAt" TIMESTAMP(3),
  ADD COLUMN "lastTestOk" BOOLEAN,
  ADD COLUMN "lastTestMessage" TEXT;

-- CreateTable
CREATE TABLE "CredentialShare" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "sharedWithUserId" TEXT NOT NULL,
    "permission" "SharePermission" NOT NULL DEFAULT 'use',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CredentialFolder_userId_idx" ON "CredentialFolder"("userId");

-- CreateIndex
CREATE INDEX "Credential_folderId_idx" ON "Credential"("folderId");

-- CreateIndex
CREATE UNIQUE INDEX "CredentialShare_credentialId_sharedWithUserId_key" ON "CredentialShare"("credentialId", "sharedWithUserId");

-- CreateIndex
CREATE INDEX "CredentialShare_sharedWithUserId_idx" ON "CredentialShare"("sharedWithUserId");

-- AddForeignKey
ALTER TABLE "CredentialFolder" ADD CONSTRAINT "CredentialFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "CredentialFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialShare" ADD CONSTRAINT "CredentialShare_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialShare" ADD CONSTRAINT "CredentialShare_sharedWithUserId_fkey" FOREIGN KEY ("sharedWithUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
