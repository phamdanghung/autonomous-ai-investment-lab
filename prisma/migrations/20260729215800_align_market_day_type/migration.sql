BEGIN;

LOCK TABLE "TradingCalendarDay"
IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "TradingCalendarDay"
    WHERE "dayType"::text IN ('CLOSED', 'SPECIAL')
  ) THEN
    RAISE EXCEPTION
      'Ambiguous legacy MarketDayType values exist; migration aborted.';
  END IF;
END
$$;

CREATE TYPE "MarketDayType_new" AS ENUM (
  'TRADING_DAY',
  'WEEKEND',
  'HOLIDAY',
  'SYSTEM_MAINTENANCE',
  'OTHER'
);

ALTER TABLE "TradingCalendarDay"
ALTER COLUMN "dayType"
TYPE "MarketDayType_new"
USING (
  CASE "dayType"::text
    WHEN 'TRADING' THEN 'TRADING_DAY'
    ELSE "dayType"::text
  END
)::"MarketDayType_new";

DROP TYPE "MarketDayType";

ALTER TYPE "MarketDayType_new"
RENAME TO "MarketDayType";

COMMIT;
