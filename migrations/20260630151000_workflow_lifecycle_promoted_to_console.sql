ALTER TABLE workflow_lifecycle_events
    DROP CONSTRAINT IF EXISTS workflow_lifecycle_events_transition_kind_check;

ALTER TABLE workflow_lifecycle_events
    ADD CONSTRAINT workflow_lifecycle_events_transition_kind_check
    CHECK (
        transition_kind IN (
            'created',
            'status_change',
            'phase_change',
            'converted',
            'archived',
            'deleted',
            'promoted_to_console'
        )
    );
