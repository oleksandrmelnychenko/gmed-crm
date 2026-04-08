ALTER TABLE appointments
    ADD COLUMN owner_user_id UUID REFERENCES users(id);

CREATE INDEX idx_apt_owner_user ON appointments(owner_user_id);
