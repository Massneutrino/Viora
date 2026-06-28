-- Add human-readable address fields for demo-facing profiles while keeping
-- latitude/longitude for distance matching and check-in validation.
ALTER TABLE "Site" ADD COLUMN "city" TEXT;
ALTER TABLE "Site" ADD COLUMN "postcode" TEXT;

ALTER TABLE "Worker" ADD COLUMN "homeAddress" TEXT;
ALTER TABLE "Worker" ADD COLUMN "homeCity" TEXT;
ALTER TABLE "Worker" ADD COLUMN "homePostcode" TEXT;
