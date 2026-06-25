CREATE TYPE "RateMode" AS ENUM ('standard', 'dynamic');

ALTER TABLE "BookingRequest"
ADD COLUMN "rateMode" "RateMode" NOT NULL DEFAULT 'standard';
