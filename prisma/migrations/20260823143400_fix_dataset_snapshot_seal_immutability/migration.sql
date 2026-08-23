CREATE OR REPLACE FUNCTION block_dataset_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'DatasetSnapshot cannot be deleted.';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD."status" = 'SEALED' THEN
            RAISE EXCEPTION 'SEALED DatasetSnapshot cannot be modified.';
        END IF;
        
        -- Only DRAFT -> SEALED is allowed for status transition
        IF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' THEN
            RAISE EXCEPTION 'DRAFT -> DRAFT update is not allowed.';
        END IF;
        
        IF OLD."status" = 'DRAFT' AND NEW."status" = 'SEALED' THEN
            IF NEW."id" <> OLD."id" OR
               NEW."businessKey" <> OLD."businessKey" OR
               NEW."sourceVersionId" <> OLD."sourceVersionId" OR
               NEW."rangeStart" <> OLD."rangeStart" OR
               NEW."rangeEnd" <> OLD."rangeEnd" OR
               NEW."universeDefinitionJson" <> OLD."universeDefinitionJson" OR
               NEW."universeHash" <> OLD."universeHash" OR
               NEW."dataCutoffKey" <> OLD."dataCutoffKey" OR
               NEW."dataCutoffAt" IS DISTINCT FROM OLD."dataCutoffAt" OR
               NEW."canonicalizationVersion" <> OLD."canonicalizationVersion" OR
               NEW."rowCount" <> OLD."rowCount" OR
               NEW."manifestHash" <> OLD."manifestHash" OR
               NEW."contentHash" <> OLD."contentHash" OR
               NEW."creationIdempotencyKey" <> OLD."creationIdempotencyKey" OR
               NEW."creationRequestHash" <> OLD."creationRequestHash" OR
               NEW."createdAt" <> OLD."createdAt" THEN
                RAISE EXCEPTION 'DatasetSnapshot identity/content fields are immutable.';
            END IF;
            
            -- sealedAt: null -> non-null
            IF OLD."sealedAt" IS NOT NULL OR NEW."sealedAt" IS NULL THEN
                RAISE EXCEPTION 'sealedAt must transition from NULL to NON-NULL when sealing.';
            END IF;
            
            RETURN NEW;
        END IF;
        
        RAISE EXCEPTION 'Only DRAFT -> SEALED transition is allowed.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
