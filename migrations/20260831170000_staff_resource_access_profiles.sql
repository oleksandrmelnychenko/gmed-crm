-- Reusable, role-compatible resource access profiles for staff users.
--
-- These grants complement the existing role and field-level policies. They do
-- not replace patient assignments and they never bypass hard-coded clinical
-- sensitivity boundaries.

ALTER TABLE users
    ADD COLUMN access_revision BIGINT NOT NULL DEFAULT 0;

ALTER TABLE users
    ADD CONSTRAINT users_access_revision_nonnegative
    CHECK (access_revision >= 0);

CREATE TABLE staff_access_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    version BIGINT NOT NULL DEFAULT 1,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(btrim(name)) BETWEEN 1 AND 160),
    CHECK (description IS NULL OR length(description) <= 2000),
    CHECK (version > 0)
);

CREATE UNIQUE INDEX staff_access_profiles_name_unique
    ON staff_access_profiles (lower(btrim(name)));

CREATE INDEX staff_access_profiles_active
    ON staff_access_profiles (is_active, updated_at DESC);

CREATE TRIGGER set_updated_at_staff_access_profiles
    BEFORE UPDATE ON staff_access_profiles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE staff_access_profile_roles (
    profile_id UUID NOT NULL REFERENCES staff_access_profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    PRIMARY KEY (profile_id, role),
    CHECK (role IN (
        'ceo_assistant',
        'patient_manager',
        'teamlead_interpreter',
        'interpreter',
        'concierge',
        'billing',
        'sales',
        'it_admin'
    ))
);

CREATE TABLE staff_access_profile_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES staff_access_profiles(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL,
    scope_type TEXT NOT NULL DEFAULT 'record',
    resource_id UUID,
    capability TEXT NOT NULL,
    effect TEXT NOT NULL DEFAULT 'allow',
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (resource_type IN ('provider', 'patient', 'document')),
    CHECK (scope_type IN ('all', 'record')),
    CHECK (
        (scope_type = 'all' AND resource_id IS NULL)
        OR (scope_type = 'record' AND resource_id IS NOT NULL)
    ),
    CHECK (capability IN ('view', 'use', 'edit', 'upload', 'download')),
    CHECK (effect IN ('allow', 'deny'))
);

CREATE UNIQUE INDEX staff_access_profile_rules_record_unique
    ON staff_access_profile_rules (
        profile_id,
        resource_type,
        resource_id,
        capability
    )
    WHERE scope_type = 'record';

CREATE UNIQUE INDEX staff_access_profile_rules_all_unique
    ON staff_access_profile_rules (
        profile_id,
        resource_type,
        capability
    )
    WHERE scope_type = 'all';

CREATE INDEX staff_access_profile_rules_lookup
    ON staff_access_profile_rules (
        profile_id,
        resource_type,
        capability,
        resource_id
    );

-- One active reusable profile per user keeps the effective result explainable.
-- A reassignment revokes the old row and inserts a new one, preserving history.
CREATE TABLE staff_access_profile_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES staff_access_profiles(id) ON DELETE RESTRICT,
    assigned_for_role TEXT NOT NULL,
    assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (assigned_for_role IN (
        'ceo_assistant',
        'patient_manager',
        'teamlead_interpreter',
        'interpreter',
        'concierge',
        'billing',
        'sales',
        'it_admin'
    )),
    CHECK (valid_until IS NULL OR valid_until > valid_from),
    CHECK (
        (revoked_at IS NULL AND revoked_by IS NULL)
        OR revoked_at IS NOT NULL
    )
);

CREATE UNIQUE INDEX staff_access_profile_assignments_one_active
    ON staff_access_profile_assignments (user_id)
    WHERE revoked_at IS NULL;

CREATE INDEX staff_access_profile_assignments_profile
    ON staff_access_profile_assignments (profile_id, user_id)
    WHERE revoked_at IS NULL;

-- Direct per-user exceptions are append-only: revoke an old rule, then insert
-- its replacement. `granted_for_role` makes a role change fail closed.
CREATE TABLE staff_user_access_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_for_role TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    scope_type TEXT NOT NULL DEFAULT 'record',
    resource_id UUID,
    capability TEXT NOT NULL,
    effect TEXT NOT NULL DEFAULT 'allow',
    reason TEXT,
    granted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (granted_for_role IN (
        'ceo_assistant',
        'patient_manager',
        'teamlead_interpreter',
        'interpreter',
        'concierge',
        'billing',
        'sales',
        'it_admin'
    )),
    CHECK (resource_type IN ('provider', 'patient', 'document')),
    CHECK (scope_type IN ('all', 'record')),
    CHECK (
        (scope_type = 'all' AND resource_id IS NULL)
        OR (scope_type = 'record' AND resource_id IS NOT NULL)
    ),
    CHECK (capability IN ('view', 'use', 'edit', 'upload', 'download')),
    CHECK (effect IN ('allow', 'deny')),
    CHECK (reason IS NULL OR length(reason) <= 2000),
    CHECK (valid_until IS NULL OR valid_until > valid_from),
    CHECK (
        (revoked_at IS NULL AND revoked_by IS NULL)
        OR revoked_at IS NOT NULL
    )
);

CREATE UNIQUE INDEX staff_user_access_rules_record_active_unique
    ON staff_user_access_rules (
        user_id,
        resource_type,
        resource_id,
        capability
    )
    WHERE scope_type = 'record' AND revoked_at IS NULL;

CREATE UNIQUE INDEX staff_user_access_rules_all_active_unique
    ON staff_user_access_rules (
        user_id,
        resource_type,
        capability
    )
    WHERE scope_type = 'all' AND revoked_at IS NULL;

CREATE INDEX staff_user_access_rules_lookup
    ON staff_user_access_rules (
        user_id,
        granted_for_role,
        resource_type,
        capability,
        resource_id
    )
    WHERE revoked_at IS NULL;
