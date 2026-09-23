CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  phone_original text,
  phone_normalized text,
  email text,
  rating numeric(3,2),
  ratings_count integer,
  website text,
  whatsapp text,
  contact_status text NOT NULL DEFAULT 'novo'
    CHECK (contact_status IN ('novo', 'interessado', 'nao_respondeu', 'sem_interesse', 'convertido')),
  category text,
  types text,
  source_export_date text,
  source_export_time text,
  notes text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS contacts_phone_normalized_unique
  ON contacts (phone_normalized)
  WHERE phone_normalized IS NOT NULL AND phone_normalized <> '';
CREATE INDEX IF NOT EXISTS contacts_status_created_idx
  ON contacts (contact_status, created_at DESC);
CREATE INDEX IF NOT EXISTS contacts_name_idx ON contacts (lower(name));
