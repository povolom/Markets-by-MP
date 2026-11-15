-- Plan details reported by the provider when a key is connected (e.g. EODHD's daily call limit), as JSON.
ALTER TABLE data_connections ADD COLUMN meta TEXT;
