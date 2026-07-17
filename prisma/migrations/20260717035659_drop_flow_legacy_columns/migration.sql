/*
  Warnings:

  - You are about to drop the column `fields` on the `Flow` table. All the data in the column will be lost.
  - You are about to drop the column `prompt` on the `Flow` table. All the data in the column will be lost.
  - You are about to drop the column `taskType` on the `Flow` table. All the data in the column will be lost.
  - Made the column `steps` on table `Flow` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Flow" DROP COLUMN "fields",
DROP COLUMN "prompt",
DROP COLUMN "taskType",
ALTER COLUMN "steps" SET NOT NULL;
