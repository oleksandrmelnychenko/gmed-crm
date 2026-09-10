-- Reporting-only room counts. A legacy booking keeps its identity after task migration.
-- Unknown room counts stay NULL; neither task quantity nor patient count implies rooms.
CREATE TABLE hotel_stay_statistics_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    concierge_service_id UUID UNIQUE REFERENCES concierge_services(id) ON DELETE CASCADE,
    task_id UUID UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
    room_count INTEGER CHECK (room_count BETWEEN 1 AND 1000),
    updated_by UUID NOT NULL REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((concierge_service_id IS NOT NULL)::int + (task_id IS NOT NULL)::int = 1)
);
