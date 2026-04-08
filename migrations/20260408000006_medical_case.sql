CREATE TABLE cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id TEXT NOT NULL UNIQUE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    manager_id UUID NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
    hauptanfragegrund TEXT,
    aktuelle_anamnese TEXT,
    zuweiser TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cases_patient ON cases(patient_id);
CREATE INDEX idx_cases_manager ON cases(manager_id);
CREATE INDEX idx_cases_status ON cases(status);
CREATE SEQUENCE case_id_seq START 1;

CREATE TRIGGER set_updated_at_cases
    BEFORE UPDATE ON cases
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE vorerkrankungen (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    erkrankung TEXT NOT NULL,
    erstdiagnose TEXT,
    notiz TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vorerkr_case ON vorerkrankungen(case_id);

CREATE TABLE allergien (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    allergie TEXT NOT NULL,
    reaktion TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_allergien_case ON allergien(case_id);

CREATE TABLE operationen (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    datum DATE,
    grund TEXT NOT NULL,
    arzt TEXT,
    notiz TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_operationen_case ON operationen(case_id);

CREATE TABLE medikamente (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    handelsname TEXT NOT NULL,
    wirkstoff TEXT,
    dosis TEXT,
    dosis_einheit TEXT,
    einnahmeschema TEXT,
    darreichungsform TEXT CHECK (darreichungsform IS NULL OR darreichungsform IN ('tablette', 'loesung', 'spray', 'pen', 'sonstige')),
    einheit TEXT,
    anmerkung TEXT,
    grund TEXT,
    seit TEXT,
    verordnender_arzt TEXT,
    med_typ TEXT NOT NULL DEFAULT 'permanent' CHECK (med_typ IN ('permanent', 'temporary')),
    expiry_date DATE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_medikamente_case ON medikamente(case_id);

CREATE TABLE pain_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    lokalisierung TEXT NOT NULL,
    seit_wann TEXT,
    ursache TEXT,
    qualitaet TEXT,
    kontinuitaet TEXT,
    entwicklung TEXT,
    nrs_aktuell INT CHECK (nrs_aktuell IS NULL OR (nrs_aktuell >= 0 AND nrs_aktuell <= 10)),
    nrs_anfang INT CHECK (nrs_anfang IS NULL OR (nrs_anfang >= 0 AND nrs_anfang <= 10)),
    dauer_anfang TEXT,
    dauer_aktuell TEXT,
    ausstrahlung TEXT,
    auftreten TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pain_case ON pain_records(case_id);

CREATE TABLE symptome (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    beschreibung TEXT NOT NULL,
    fachrichtung TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_symptome_case ON symptome(case_id);

CREATE TABLE vegetative_anamnese (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
    appetit_durst TEXT,
    koerpergroesse NUMERIC,
    gewicht NUMERIC,
    gewichtsveraenderung TEXT,
    grund TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_veg
    BEFORE UPDATE ON vegetative_anamnese
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE impfstatus (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
    status_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_impf
    BEFORE UPDATE ON impfstatus
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE case_versions (
    id BIGSERIAL PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    changed_by UUID NOT NULL REFERENCES users(id),
    section TEXT NOT NULL,
    old_value JSONB,
    new_value JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_case_versions_case ON case_versions(case_id);
